import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeSessionPort } from '../../src/bridge/native-port.mjs';
import { initialBridgeState } from '../../src/bridge/projection.mjs';

function fixture() {
  const calls = [];
  const roles = { async bindings() { return []; }, catalog() { return { roles: [] }; } };
  const observation = initialBridgeState();
  const agents = new Map();
  const children = new Map();
  const projection = { kind: 'sequenced', asOfSeq: 1, values: { dshBridge: observation, agentTeam: { members: [{ id: 'root', name: 'lead', role: 'lead' }, { id: 'child', name: 'worker', role: 'teammate' }], tasks: [] }, inbox: { 'next-turn': [], 'next-step': [] }, modelSelection: { lastUsed: { provider: 'observed', model: 'actual' } } } };
  const ctx = {
    connection: { createPeer(options) { calls.push(['peer', options]); return { dispose: async () => calls.push(['peer-disposed']) }; } },
    typertGateway: { invoke(request) {
      calls.push([request.method, request.args.request]);
      return request.method === 'projections' ? structuredClone(request.args.request.sessionId === 'root' ? projection : children.get(request.args.request.sessionId) ?? null) : { accepted: true };
    } },
    sessionController: {}, sessions: { get() { return {}; }, async flush() { calls.push(['flush']); } },
    agents: { get(id) { return agents.get(id); } }, sessionProjections: {},
    agentTeams: {
      listMembers() { return projection.values.agentTeam.members.map(member => ({ ...member, status: member.phase === 'provisioning' ? 'provisioning' : agents.get(member.id)?.status === 'running' ? 'running' : 'inactive' })); },
      interrupt(lead, name) { calls.push(['interrupt', lead.id, name]); },
    },
  };
  return { port: new NativeSessionPort(ctx, roles), calls, agents, children, observation, projection };
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
  assert.deepEqual(calls.filter(call => call[0] === 'cancel'), [['cancel', { sessionId: 'root' }]]);
  assert.deepEqual(calls.filter(call => call[0] === 'interrupt'), [['interrupt', 'root', 'worker']]);
  assert.equal(result.filesRolledBack, false);
  assert.equal(result.pendingInputsRetained, true);
  assert.deepEqual(calls[0], ['peer', { principal: { kind: 'owner' }, interactions: 'none' }]);
});

test('native inactive unloaded children with durable completion and empty inbox allow Team completion without activation', async () => {
  const { port, agents, children, observation, calls } = fixture();
  observation.lastEnd = { turn: 1, reason: 'completed' };
  agents.set('root', { id: 'root', status: 'idle', model: { current: () => undefined } });
  children.set('child', { kind: 'sequenced', asOfSeq: 7, values: {
    dshBridge: { ...initialBridgeState(), lastEnd: { turn: 1, reason: 'completed' } },
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
    dshBridge: { ...initialBridgeState(), turn: 2, open: true, lastEnd: { turn: 1, reason: 'completed' } },
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
