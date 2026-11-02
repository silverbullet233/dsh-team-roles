import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeSessionPort } from '../../src/teams/native-port.mjs';
import { initialObservation } from '../../src/teams/projection.mjs';

function fixture() {
  const calls = [];
  const roles = { async bindings() { return []; }, catalog() { return { roles: [] }; } };
  const observation = initialObservation();
  const agents = new Map();
  const children = new Map();
  const projection = { kind: 'sequenced', asOfSeq: 1, values: { dshBridge: observation, agentTeam: { members: [{ id: 'root', name: 'lead', role: 'lead' }, { id: 'child', name: 'worker', role: 'teammate' }], tasks: [] }, inbox: { 'next-turn': [], 'next-step': [] }, modelSelection: { lastUsed: { provider: 'observed', model: 'actual' } } } };
  const ctx = {
    connection: { createPeer(options) { calls.push(['peer', options]); return { dispose: async () => calls.push(['peer-disposed']) }; } },
    typertGateway: { invoke(request) {
      calls.push([request.method, request.args.request]);
      if (request.method === 'cancel') agents.get(request.args.request.sessionId).status = 'idle';
      return request.method === 'projections' ? structuredClone(request.args.request.sessionId === 'root' ? projection : children.get(request.args.request.sessionId) ?? null) : { accepted: true };
    } },
    sessionController: {}, sessions: { get() { return {}; }, async flush() { calls.push(['flush']); } },
    agents: { get(id) { return agents.get(id); } }, sessionProjections: {},
    agentTeams: {
      listMembers() { return projection.values.agentTeam.members.map(member => ({ ...member, status: member.phase === 'provisioning' ? 'provisioning' : agents.get(member.id)?.status === 'running' ? 'running' : 'inactive' })); },
      interrupt(lead, name) { calls.push(['interrupt', lead.id, name]); agents.get('child').status = 'idle'; },
    },
  };
  return { ctx, port: new NativeSessionPort(ctx, roles), calls, agents, children, observation, projection };
}

test('healthy active native turn accepts queue/steer without explicit continuation', async () => {
  const { port, agents, observation } = fixture();
  observation.open = true;
  observation.lastEnd = { turn: 1, reason: 'interrupted' };
  agents.set('root', { id: 'root', status: 'running', model: { current: () => ({ provider: 'configured', model: 'next' }) } });
  const status = await port.snapshot('root');
  assert.equal(status.taskState, 'running');
  assert.equal(status.needsContinuation, false);
  assert.deepEqual(status.route.lastUsed, { provider: 'observed', model: 'actual' });
  assert.deepEqual(status.route.selected, { provider: 'configured', model: 'next' });
});

test('cold and interrupted inactive states need continuation; selected route remains unknown when unloaded', async () => {
  const { port, agents, observation } = fixture();
  let status = await port.snapshot('root');
  assert.equal(status.needsContinuation, true);
  assert.equal(status.route.selected, null);
  agents.set('root', { id: 'root', status: 'idle', model: { current: () => undefined } });
  observation.open = true;
  status = await port.snapshot('root');
  assert.equal(status.needsContinuation, true);
  assert.equal(status.rootTurnState, 'interrupted');
});

test('Lead completion does not claim Team completion while a child runs, provisions or shared tasks remain', async () => {
  const { port, agents, observation, projection } = fixture();
  observation.lastEnd = { turn: 1, reason: 'completed' };
  agents.set('root', { id: 'root', status: 'idle', model: { current: () => undefined } });
  agents.set('child', { id: 'child', status: 'running' });
  let status = await port.snapshot('root');
  assert.equal(status.rootTurnCompleted, true);
  assert.equal(status.taskState, 'running');
  assert.equal(status.teamCompleted, false);
  agents.delete('child');
  projection.values.agentTeam.members[1].phase = 'provisioning';
  status = await port.snapshot('root');
  assert.equal(status.taskState, 'provisioning');
  assert.equal(status.teamCompleted, false);
  projection.values.agentTeam.members[1].phase = 'active';
  projection.values.agentTeam.tasks.push({ id: 'task-1', status: 'pending' });
  status = await port.snapshot('root');
  assert.equal(status.taskState, 'pending');
  assert.equal(status.teamCompleted, false);
  projection.values.agentTeam.tasks[0].status = 'completed';
  status = await port.snapshot('root');
  assert.equal(status.taskState, 'unknown');
  assert.equal(status.teamCompleted, null);
  assert.equal(status.teamActivity.members.find(member => member.id === 'child').runtimeState, 'unloaded');
});

test('stop interrupts native children through Team authority and cancels lead through Session API', async () => {
  const { port, agents, calls } = fixture();
  agents.set('root', { id: 'root', status: 'running', model: { current: () => undefined } });
  agents.set('child', { id: 'child', status: 'running' });
  const result = await port.stop('root');
  assert.equal(result.accepted, true);
  assert.equal(result.quiescent, true);
  assert.deepEqual(calls.filter(call => call[0] === 'cancel'), [['cancel', { sessionId: 'root' }]]);
  assert.deepEqual(calls.filter(call => call[0] === 'interrupt'), [['interrupt', 'root', 'worker']]);
  assert.equal(result.filesRolledBack, false);
  assert.equal(result.pendingInputsRetained, true);
  assert.deepEqual(calls[0], ['peer', { principal: { kind: 'owner' }, interactions: 'none' }]);
});

test('freshness exposes per-Session cuts, unknown cold checks and changed member samples', async () => {
  const { port, ctx, agents, children, observation } = fixture();
  observation.lastEnd = { turn: 1, reason: 'completed' };
  agents.set('root', { id: 'root', status: 'idle', model: { current: () => undefined } });
  agents.set('child', { id: 'child', status: 'idle' });
  children.set('child', { kind: 'sequenced', asOfSeq: 7, values: { dshBridge: { ...initialObservation(), lastEnd: { turn: 1, reason: 'completed' } }, inbox: { 'next-turn': [], 'next-step': [] } } });
  const seq = { root: 2, child: 8 }; ctx.sessions.get = id => ({ seq: seq[id] });
  let status = await port.snapshot('root');
  assert.equal(status.asOfSeq, 1); assert.equal(status.asOfSeqScope, 'root-session');
  assert.deepEqual(status.freshness, { atomic: false, projections: [{ sessionId: 'root', asOfSeq: 1, unchangedAtCheck: true }, { sessionId: 'child', asOfSeq: 7, unchangedAtCheck: true }] });
  port.roles.bindings = async () => { seq.child = 9; return []; };
  status = await port.snapshot('root');
  assert.equal(status.consistent, false); assert.equal(status.freshness.projections[1].unchangedAtCheck, false);
  port.roles.bindings = async () => []; children.delete('child'); agents.delete('child');
  status = await port.snapshot('root');
  assert.equal(status.freshness.projections[1].asOfSeq, null); assert.equal(status.freshness.projections[1].unchangedAtCheck, null);
});

test('member runtime replacement cannot reuse the same sequence as unchanged evidence', async () => {
  const { port, ctx, agents, children } = fixture();
  agents.set('root', { id: 'root', status: 'idle', model: { current: () => undefined } }); agents.set('child', { id: 'child', status: 'idle' });
  children.set('child', { kind: 'sequenced', asOfSeq: 1, values: { dshBridge: initialObservation(), inbox: { 'next-turn': [], 'next-step': [] } } });
  ctx.sessions.get = () => ({ seq: 2 });
  port.roles.bindings = async () => { agents.set('child', { id: 'child', status: 'idle' }); return []; };
  const status = await port.snapshot('root');
  assert.equal(status.consistent, false); assert.equal(status.freshness.projections[1].unchangedAtCheck, false);
});

test('native inactive unloaded children with durable completion and empty inbox allow Team completion without activation', async () => {
  const { port, agents, children, observation, calls } = fixture();
  observation.lastEnd = { turn: 1, reason: 'completed' };
  agents.set('root', { id: 'root', status: 'idle', model: { current: () => undefined } });
  children.set('child', { kind: 'sequenced', asOfSeq: 7, values: {
    dshBridge: { ...initialObservation(), lastEnd: { turn: 1, reason: 'completed' } },
    inbox: { 'next-turn': [], 'next-step': [] },
  } });
  const status = await port.snapshot('root');
  assert.equal(status.teamCompleted, true);
  assert.equal(status.taskState, 'completed');
  const child = status.teamActivity.members.find(member => member.id === 'child');
  assert.equal(child.runtimeState, 'unloaded');
  assert.equal(child.nativeStatus, 'inactive');
  assert.equal(child.lastTurnOutcome, 'completed');
  assert.equal(child.openTurn, false);
  assert.equal(child.observationAvailable, true);
  assert.equal(agents.has('child'), false);
  assert.deepEqual(calls.filter(call => call[0] !== 'peer').map(call => call[0]), ['projections', 'projections']);
  agents.delete('root');
  const cold = await port.snapshot('root');
  assert.equal(cold.teamCompleted, null);
  assert.equal(cold.taskState, 'unknown');
});

test('an inactive child open turn cannot reuse an earlier completed outcome as Team completion', async () => {
  const { port, agents, children, observation } = fixture();
  observation.lastEnd = { turn: 1, reason: 'completed' };
  agents.set('root', { id: 'root', status: 'idle', model: { current: () => undefined } });
  children.set('child', { kind: 'sequenced', asOfSeq: 9, values: {
    dshBridge: { ...initialObservation(), turn: 2, open: true, lastEnd: { turn: 1, reason: 'completed' } },
    inbox: { 'next-turn': [], 'next-step': [] },
  } });
  const status = await port.snapshot('root');
  assert.equal(status.rootTurnCompleted, true);
  assert.equal(status.teamCompleted, false);
  assert.equal(status.taskState, 'interrupted');
  const child = status.teamActivity.members.find(member => member.id === 'child');
  assert.equal(child.nativeStatus, 'inactive');
  assert.equal(child.openTurn, true);
  assert.equal(child.lastTurnOutcome, 'completed');
});

test('a Lead waking during awaited child reads cannot be reported as completed', async () => {
  const { port, ctx, agents, children, observation } = fixture();
  observation.lastEnd = { turn: 1, reason: 'completed' };
  const root = { id: 'root', status: 'idle', model: { current: () => undefined } };
  agents.set('root', root);
  children.set('child', { kind: 'sequenced', asOfSeq: 7, values: { dshBridge: { ...initialObservation(), lastEnd: { turn: 1, reason: 'completed' } }, inbox: { 'next-turn': [], 'next-step': [] } } });
  const invoke = ctx.typertGateway.invoke;
  ctx.typertGateway.invoke = request => {
    if (request.args.request.sessionId === 'child') root.status = 'running';
    return invoke(request);
  };
  const result = await port.snapshot('root');
  assert.equal(result.runtimeState, 'running');
  assert.equal(result.taskState, 'running');
  assert.equal(result.teamCompleted, false);
});

function permissionFixture() {
  const value = fixture(), { ctx, agents, projection, calls } = value;
  const session = { id: 'root', header: { cwd: '/synthetic', isSeeded: false }, firstLiveSeq: 0, seq: 0, preset: 'read-only', mode: 'read-only', approval: 'ask', snapshotEvents: () => [] };
  const specs = { 'read-only': { sandbox: 'read-only', approval: 'ask' }, 'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' } };
  const latest = (s, type, key, fallback) => s.snapshotEvents().findLast(event => event.type === type)?.data[key] ?? fallback;
  ctx.permissionPresets = { catalog: () => ({ options: Object.keys(specs).map(value => ({ value, name: value })), defaultPreset: 'read-only' }), resolve: name => { calls.push(['resolve', name]); return specs[name]; }, current: s => latest(s, 'permission/preset', 'preset', s.preset), set: (s, name) => { calls.push(['set', name]); s.preset = name; s.mode = specs[name].sandbox; s.approval = specs[name].approval; s.seq += 3; } };
  ctx.sandboxPolicy = { resolve: ({ session: s }) => ({ mode: latest(s, 'sandbox/mode', 'mode', s.mode), workspaceRoot: s.header.cwd, sessionId: s.id }) };
  ctx.approval = { config: { policy: 'ask' }, overrideOf: s => latest(s, 'approval/policy', 'policy', s.approval) };
  ctx.sessions.get = () => session;
  agents.set('root', { id: 'root', session, status: 'idle', inbox: { nextTurn: [], nextStep: [] } });
  projection.values.agentTeam.members.length = 1;
  return { ...value, session, specs };
}

test('native permission names are catalog-validated and reported using actual configured bundles', async () => {
  const { port, calls, specs } = permissionFixture();
  for (const name of ['missing', 'constructor', '__proto__', 'custom']) assert.throws(() => port.resolvePermissionPreset(name), { code: 'PERMISSION_PRESET_UNAVAILABLE' });
  assert.equal(calls.some(call => call[0] === 'resolve'), false);
  specs['danger-full-access'] = { sandbox: 'workspace-write', approval: 'ask' };
  assert.deepEqual(port.resolvePermissionPreset('danger-full-access'), { preset: 'danger-full-access', sandboxMode: 'workspace-write', approvalPolicy: 'ask' });
  assert.equal(port.permissionCatalog().options[1].sandboxMode, 'workspace-write');
});

test('native preset writes are restricted to fresh blank roots and return effective knobs', async () => {
  const { port, calls } = permissionFixture();
  port.applyPermissionPreset('root', port.resolvePermissionPreset('danger-full-access'));
  const actual = await port.permissionSnapshot('root');
  assert.equal(actual.sandbox.mode, 'danger-full-access'); assert.equal(actual.approvalPolicy, 'never'); assert.equal(actual.asOfSeq, 2);
  assert.equal(calls.filter(call => call[0] === 'set').length, 1);
  for (const condition of ['running', 'inbox', 'seeded', 'restored', 'member', 'turn']) {
    const { port, calls, session, agents, projection } = permissionFixture();
    if (condition === 'running') agents.get('root').status = 'running';
    if (condition === 'inbox') agents.get('root').inbox.nextTurn.push({});
    if (condition === 'seeded') session.header.isSeeded = true;
    if (condition === 'restored') session.firstLiveSeq = 3;
    if (condition === 'member') projection.values.agentTeam.members.push({ id: 'child' });
    if (condition === 'turn') session.snapshotEvents = () => [{ type: 'turn/start' }];
    assert.throws(() => port.applyPermissionPreset('root', port.resolvePermissionPreset('danger-full-access')), { code: 'PERMISSION_INITIALIZATION_INCOMPLETE' });
    assert.equal(calls.some(call => call[0] === 'set'), false);
  }
});

test('cold permission verification replays a detached native Session without applying presets or activating it', async () => {
  const { port, ctx, calls, agents } = permissionFixture();
  agents.clear(); ctx.sessions.get = () => undefined;
  ctx.sessionQuery = { readSession: async () => ({ session: { version: 4, id: 'root', createdAt: 0, cwd: '/synthetic', isSeeded: false }, inheritedEventCount: 0, events: [
    { type: 'permission/preset', seq: 0, time: 0, data: { preset: 'danger-full-access' } },
    { type: 'sandbox/mode', seq: 1, time: 0, data: { mode: 'danger-full-access' } },
    { type: 'approval/policy', seq: 2, time: 0, data: { policy: 'never' } },
  ] }) };
  const snapshot = await port.permissionSnapshot('root');
  assert.equal(snapshot.preset, 'danger-full-access'); assert.equal(snapshot.sandbox.mode, 'danger-full-access'); assert.equal(snapshot.approvalPolicy, 'never');
  assert.equal(snapshot.asOfSeq, 2);
  assert.equal(calls.some(call => call[0] === 'set'), false); assert.equal(agents.size, 0);
});

test('optional Cordis services are read through get without undeclared property access', async () => {
  const { ctx, port } = fixture();
  ctx.get = () => undefined;
  Object.defineProperty(ctx, 'permissionPresets', { get() { throw new Error('Undeclared injected property'); } });
  assert.equal(port.permissionCatalog(), null); assert.equal(await port.permissionSnapshot('root'), null);
  assert.throws(() => port.resolvePermissionPreset('danger-full-access'), { code: 'CAPABILITY_MISSING' });
});

test('guarded native prompts check after attachment/binding awaits, then enqueue synchronously and deduplicate', async () => {
  for (const change of ['attachments', 'binding', 'none']) {
    const { port, ctx, session, agents } = permissionFixture(), queued = [];
    const agent = agents.get('root');
    agent.followup = message => { queued.push(message); agent.inbox.nextTurn.push(message); };
    agent.steer = agent.followup;
    ctx.sessionController.resolveAgent = async () => ({ agent });
    ctx.get = name => ({ attachments: { admitPromptContent: async content => { if (change === 'attachments') session.mode = 'danger-full-access'; return content; } },
      fileUploads: { bindPrompt() { if (change === 'binding') session.mode = 'danger-full-access'; return { commit() {}, [Symbol.dispose]() {} }; } } }[name] ?? ctx[name]);
    const request = { sessionId: 'root', requestId: 'safe-input', content: [{ type: 'text', text: 'Synthetic input.' }] };
    const verify = actual => { if (actual.sandbox.mode !== 'read-only') throw Object.assign(new Error('Changed permissions'), { code: 'PERMISSION_MISMATCH' }); };
    if (change !== 'none') {
      await assert.rejects(port.prompt(request, verify), { code: 'PERMISSION_MISMATCH' }); assert.equal(queued.length, 0);
    } else {
      await port.prompt(request, verify); await port.prompt(request, verify);
      assert.equal(queued.length, 1); assert.equal(queued[0].source.rpcId, request.requestId);
    }
  }
});
