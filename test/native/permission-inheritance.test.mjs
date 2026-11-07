/** Actual native data services, synthetic adapters only; no shell, listener or security setting changes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import PermissionPresets from '@deepseek-ai/dsh-permission-presets';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork';
import { NativeSessionPort } from '../../src/teams/native-port.mjs';
import { mountNativeHost, until } from '../fixtures/native-harness.mjs';

const binding = 'a'.repeat(64);
async function fixture(t, execution, { emptyCatalog = false, onRequest } = {}) {
  const root = await mkdtemp('/tmp/dsh-profile-data-');
  const prior = process.env.DSH_AGENT_TEAM_LAUNCH_PERMISSION_BINDING;
  const priorExecution = process.env.DSH_AGENT_TEAM_LAUNCH_EXECUTION;
  if (execution !== undefined) process.env.DSH_AGENT_TEAM_LAUNCH_EXECUTION = JSON.stringify(execution);
  process.env.DSH_AGENT_TEAM_LAUNCH_PERMISSION_BINDING = binding;
  let host, port;
  t.after(async () => { await port?.close(); await host?.dispose(); await rm(root, { recursive: true, force: true }); if (prior === undefined) delete process.env.DSH_AGENT_TEAM_LAUNCH_PERMISSION_BINDING; else process.env.DSH_AGENT_TEAM_LAUNCH_PERMISSION_BINDING = prior; if (priorExecution === undefined) delete process.env.DSH_AGENT_TEAM_LAUNCH_EXECUTION; else process.env.DSH_AGENT_TEAM_LAUNCH_EXECUTION = priorExecution; });
  const mount = async () => {
    host = await mountNativeHost({ root, onRequest });
    if (emptyCatalog) host.ctx.dshRoles.catalogSource = () => ({ leadRole: '', roles: {} });
    await host.ctx.plugin(await import('@deepseek-ai/dsh-subagent-fork-in-process'), { providerName: 'fork' });
    host.ctx.provide('shell', { sandboxMode: 'workspace-write' });
    await host.ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: host.fixtureRoot });
    await host.ctx.plugin(PermissionPresets, {});
    host.ctx.subagents.registerProvider({ name: 'empty-fork', capabilities: { agentOptions: true, depthLimit: true }, inheritsParentContext: true,
      prepareContinuable: async () => ({ seed: [] }) });
    port = new NativeSessionPort(host.ctx, host.ctx.dshRoles);
  };
  await mount();
  const params = { key: 'signed-profile', cwd: host.fixtureRoot, text: 'Synthetic permission policy data validation.' };
  const profile = { sandboxMode: 'workspace-write', approvalPolicy: 'ask', writableRoots: [host.fixtureRoot], networkAccess: 'restricted', binding };
  return { host, port, params, profile, restart: async () => { await port.close(); await host.dispose(); await mount(); return { host, port }; } };
}

test('health reports captured execution intent separately from native settings and later env changes', async t => {
  const execution = { backend: 'codex-sandbox-host-v1', scope: 'entire-native-host', approval: 'native-ask', filesystem: 'launcher-required', network: 'opaque-state-only' };
  const { host } = await fixture(t, execution);
  assert.deepEqual((await host.client.request('health')).host.permissionExecution, execution);
  process.env.DSH_AGENT_TEAM_LAUNCH_EXECUTION = JSON.stringify({ backend: 'native' });
  assert.deepEqual((await host.client.request('health')).host.permissionExecution, execution);
});

test('exact inherited native policy is applied before first input and members retain parent approval instead of native never', async t => {
  const { host, port, params, profile } = await fixture(t);
  const created = await host.client.request('create', { ...params, permissionProfile: profile });
  assert.equal(created.permissions.approvalPolicy, 'ask'); assert.deepEqual(created.permissionProfile, profile);
  const lead = host.ctx.agents.get(created.teamId); await lead.whenIdle();
  const member = await host.ctx.dshRoles.spawn(lead, { name: 'worker', role: 'left', prompt: 'Synthetic member policy validation.', signal: new AbortController().signal });
  await until(() => host.requests.some(request => request.sessionId === member.member.id));
  await host.ctx.agents.get(member.member.id)?.whenIdle();
  const child = await port.permissionSnapshot(member.member.id);
  assert.equal(child.sandbox.mode, 'workspace-write'); assert.equal(child.approvalPolicy, 'ask');
  const events = (await host.ctx.sessionQuery.readSession(member.member.id)).events;
  const marker = events.find(event => event.type === 'plugin:dsh-team-roles/permission-profile');
  assert(marker); assert(marker.seq < events.find(event => event.type === 'turn/start').seq);
  assert.equal((await host.client.request('create', { ...params, permissionProfile: profile })).duplicate, true);
  host.ctx.sessions.get(created.teamId).append('approval/policy', { policy: 'never' });
  const observed = await host.client.request('status', { teamId: created.teamId });
  assert.equal(observed.permissions.approvalPolicy, 'never');
  assert.equal(observed.permissionProfile.approvalPolicy, 'ask');
  await assert.rejects(host.client.request('send', { teamId: created.teamId, inputId: 'changed', text: 'Must not run' }), error => error.code.endsWith('PERMISSION_MISMATCH'));
});

test('full-access fallback and outer-launcher projection preserve their exact approval before member work', async t => {
  for (const [mode, approvalPolicy] of [['read-only', 'ask'], ['danger-full-access', 'ask'], ['danger-full-access', 'never']]) await t.test(`${mode}/${approvalPolicy}`, async t => {
    const { host, port, params, profile } = await fixture(t);
    const requested = { ...profile, sandboxMode: mode, approvalPolicy, writableRoots: [], networkAccess: 'unknown' };
    const created = await host.client.request('create', { ...params, permissionProfile: requested });
    assert.equal(created.permissionProfile.networkAccess, 'unknown');
    const lead = host.ctx.agents.get(created.teamId); await lead.whenIdle();
    const member = await host.ctx.dshRoles.spawn(lead, { name: 'worker', role: 'left', prompt: 'Synthetic unknown-network inherited policy.', signal: new AbortController().signal });
    await until(() => host.requests.some(request => request.sessionId === member.member.id));
    await host.ctx.agents.get(member.member.id)?.whenIdle();
    const actual = await port.permissionSnapshot(member.member.id);
    assert.equal(actual.sandbox.mode, mode);
    assert.equal(actual.approvalPolicy, approvalPolicy);
    const events = (await host.ctx.sessionQuery.readSession(member.member.id)).events;
    assert(events.find(event => event.type === 'plugin:dsh-team-roles/permission-profile').seq < events.find(event => event.type === 'turn/start').seq);
  });
});

test('an independent native Web fork of a profiled Team stays ordinary through creation and cold activation', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const created = await f.host.client.request('create', { ...f.params, permissionProfile: f.profile });
  const lead = f.host.ctx.agents.get(created.teamId); await lead.whenIdle();
  const forked = await f.host.ctx.sessionController.fork({ sessionId: lead.id });
  const fork = f.host.ctx.agents.get(forked.sessionId);
  assert(fork); assert.equal(fork.session.header.parentSession, undefined);
  assert.notEqual(fork.session.header.origin, 'subagent');
  assert.equal(f.host.ctx.agents.isOwnedBy(fork.id, lead), false);
  assert.equal(f.host.ctx.agentTeams.tryMembership(fork)?.role, 'lead');
  assert.equal(await f.host.ctx.dshRoles.bindingFor(fork), null);
  const marker = 'plugin:dsh-team-roles/permission-profile';
  const ownMarkers = agent => agent.session.snapshotEvents().filter(event => event.seq >= agent.session.inheritedEventCount && event.type === marker);
  assert.deepEqual(ownMarkers(fork), []);
  await f.host.ctx.sessionController.prompt({ sessionId: fork.id, requestId: 'independent-fork', mode: 'queue', content: [{ type: 'text', text: 'Synthetic ordinary fork continuation.' }] }, new AbortController().signal);
  await until(() => f.host.requests.some(request => request.sessionId === fork.id) && fork.status === 'idle');
  await f.host.ctx.sessions.flush(fork.session);
  // Also cover an independent seeded Session retaining ancestry metadata.
  // The pinned SessionController.fork above clears parentSession; ancestry by
  // itself must still never be treated as Team/delegation ownership.
  const events = lead.session.snapshotEvents(), boundary = events.at(-1).seq;
  const independentId = 'synthetic-seeded-ancestry';
  await f.host.ctx.agents.create({ sessionId: independentId,
    seed: buildForkSeed(events, boundary), inheritedEventCount: boundary + 1,
    meta: { parentSession: lead.id, cwd: f.host.fixtureRoot, isSeeded: true },
    agentOptions: { provider: 'fixture-lead', model: 'fixture-model' } });
  const independent = f.host.ctx.agents.get(independentId);
  assert(independent); assert.equal(independent.session.header.parentSession, lead.id);
  assert.equal(f.host.ctx.agents.isOwnedBy(independent.id, lead), false);
  assert.equal(await f.host.ctx.dshRoles.bindingFor(independent), null);
  assert.deepEqual(ownMarkers(independent), []);
  await f.host.ctx.sessions.flush(independent.session);
  const next = await f.restart();
  const resumed = await next.host.ctx.sessionController.resolveAgent(fork.id);
  assert(resumed.agent); assert.equal(await next.host.ctx.dshRoles.bindingFor(resumed.agent), null);
  assert.deepEqual(ownMarkers(resumed.agent), []);
  const retainedAncestry = await next.host.ctx.sessionController.resolveAgent(independentId);
  assert(retainedAncestry.agent); assert.deepEqual(ownMarkers(retainedAncestry.agent), []);
});

test('unknown or mismatching host launch bindings and writable roots are rejected before any native work', async t => {
  const { host, params, profile } = await fixture(t);
  for (const bad of [{ ...profile, binding: 'b'.repeat(64) }, { ...profile, writableRoots: ['/extra'] }, { ...profile, approvalPolicy: 'on-failure' }]) {
    await assert.rejects(host.client.request('create', { ...params, permissionProfile: bad }));
  }
  assert.equal(host.requests.length, 0);
});

test('YOLO policy data uses full-access and never only for that exact profile, and retains idempotent intent', async t => {
  const { host, params, profile } = await fixture(t);
  const full = { ...profile, sandboxMode: 'danger-full-access', approvalPolicy: 'never', writableRoots: [], networkAccess: 'enabled' };
  const result = await host.client.request('create', { ...params, permissionProfile: full });
  assert.equal(result.permissions.sandbox.mode, 'danger-full-access'); assert.equal(result.permissions.approvalPolicy, 'never');
  await assert.rejects(host.client.request('create', { ...params, permissionProfile: profile }), error => error.code.endsWith('CONTENT_CONFLICT'));
});

test('restored profile roots and members are verified without reapplying saved permissions', async t => {
  const f = await fixture(t);
  const input = { ...f.params, permissionProfile: f.profile };
  const created = await f.host.client.request('create', input);
  const lead = f.host.ctx.agents.get(created.teamId); await lead.whenIdle();
  const child = await f.host.ctx.dshRoles.spawn(lead, { name: 'retained', role: 'left', prompt: 'Synthetic durable permissions.', signal: new AbortController().signal });
  await until(() => f.host.requests.some(request => request.sessionId === child.member.id));
  await f.host.ctx.agents.get(child.member.id)?.whenIdle();
  const before = (await f.host.ctx.sessionQuery.readSession(child.member.id)).events.filter(event => ['sandbox/mode', 'approval/policy', 'plugin:dsh-team-roles/permission-profile'].includes(event.type));
  const next = await f.restart();
  assert.equal((await next.host.client.request('create', input)).duplicate, true);
  assert.equal(next.host.ctx.agents.get(created.teamId), undefined);
  assert.equal((await next.port.permissionSnapshot(child.member.id)).approvalPolicy, 'ask');
  await next.host.client.request('send', { teamId: created.teamId, inputId: 'resume', text: 'Synthetic continuation', continue: true });
  await until(() => next.host.ctx.agents.get(created.teamId)?.status === 'idle');
  await next.host.ctx.agentTeams.sendMessage(next.host.ctx.agents.get(created.teamId), { target: 'retained', content: [{ type: 'text', text: 'Synthetic restored member' }], signal: new AbortController().signal });
  await until(() => next.host.requests.some(request => request.sessionId === child.member.id));
  await next.host.ctx.agents.get(child.member.id)?.whenIdle();
  const after = (await next.host.ctx.sessionQuery.readSession(child.member.id)).events.filter(event => ['sandbox/mode', 'approval/policy', 'plugin:dsh-team-roles/permission-profile'].includes(event.type));
  assert.deepEqual(after, before);
});

test('explicit preset must agree with the authorized exact native profile', async t => {
  const { host, params, profile } = await fixture(t);
  const full = { ...profile, sandboxMode: 'danger-full-access', approvalPolicy: 'never', writableRoots: [] };
  await assert.rejects(host.client.request('create', { ...params, permissionProfile: profile, permissionPreset: 'danger-full-access' }), error => error.code.endsWith('PERMISSION_MISMATCH'));
  const created = await host.client.request('create', { ...params, permissionProfile: full, permissionPreset: 'danger-full-access' });
  assert.equal(created.permissions.preset, 'danger-full-access'); assert.equal(created.permissions.approvalPolicy, 'never');
});

const permissionMarker = 'plugin:dsh-team-roles/permission-profile';
const ownPolicy = session => session.snapshotEvents().filter(event => event.seq >= session.inheritedEventCount
  && ['sandbox/mode', 'approval/policy', permissionMarker].includes(event.type));
async function policySession(host, id) {
  // The production hook flushes policy before model work. SessionQuery owns
  // live/cold observation; a borrowed live handle can already be closing after
  // whenIdle(), so an extra consumer flush races native child disposal.
  const saved = await host.ctx.sessionQuery.readSession(id);
  return { inheritedEventCount: saved.inheritedEventCount, snapshotEvents: () => saved.events };
}
const startDelegated = (host, parent, childId, provider) => host.ctx.subagents.startActivation({
  provider, childId, label: 'Synthetic permission inheritance regression.',
  request: { parent, prompt: [{ type: 'text', text: 'Synthetic delegated work.' }], maxDepth: 4 },
  signal: new AbortController().signal, delivery: 'caller',
});
for (const [mode, approvalPolicy] of [['read-only', 'ask'], ['danger-full-access', 'never']])
for (const provider of ['spawn', 'fork', 'empty-fork']) test(`empty catalog ${provider} ${mode}/${approvalPolicy} delegation verifies first and recursive children before work and on cold activation`, { timeout: 20000 }, async t => {
  const seen = [];
  const execution = { backend: 'native', source: mode === 'danger-full-access' ? 'full-access-fallback' : 'explicit-configuration', ...(mode === 'danger-full-access' ? { fallbackReason: 'sandbox-metadata-unavailable' } : {}), filesystem: 'native-policy', network: 'unverified', approval: 'native-policy' };
  const f = await fixture(t, execution, { emptyCatalog: true, onRequest: (request, ctx) => {
    const session = ctx.sessions.get(request.sessionId);
    assert.equal(ctx.approval.overrideOf(session), approvalPolicy);
    assert.equal(ctx.sandboxPolicy.resolve({ session }).mode, mode);
    if (session.header.origin !== 'subagent') return;
    const own = ownPolicy(session);
    assert.equal(own.filter(event => event.type === permissionMarker).length, 1);
    seen.push(request.sessionId);
  } });
  const profile = { ...f.profile, sandboxMode: mode, approvalPolicy, writableRoots: [], networkAccess: 'unknown' };
  const created = await f.host.client.request('create', { ...f.params, permissionProfile: profile });
  let lead = f.host.ctx.agents.get(created.teamId); await lead.whenIdle();
  const firstId = `synthetic-${provider}-first`, secondId = `synthetic-${provider}-second`;
  await startDelegated(f.host, lead, firstId, provider);
  await f.host.ctx.agents.get(firstId).whenIdle();
  assert(f.host.requests.some(request => request.sessionId === firstId), JSON.stringify(f.host.ctx.sessions.get(firstId).snapshotEvents().slice(-5)));
  assert(seen.includes(firstId), JSON.stringify(ownPolicy(f.host.ctx.sessions.get(firstId))));
  let first = f.host.ctx.agents.get(firstId);
  assert.equal(first.session.header.isSeeded, provider !== 'spawn');
  await startDelegated(f.host, first, secondId, provider);
  await f.host.ctx.agents.get(secondId).whenIdle();
  assert(f.host.requests.some(request => request.sessionId === secondId), JSON.stringify(f.host.ctx.sessions.get(secondId).snapshotEvents().slice(-5)));
  assert(seen.includes(secondId), JSON.stringify(ownPolicy(f.host.ctx.sessions.get(secondId))));
  const before = new Map();
  for (const id of [firstId, secondId]) {
    const session = await policySession(f.host, id);
    const own = ownPolicy(session); before.set(id, own);
    assert.deepEqual(own.find(event => event.type === permissionMarker).data, profile);
    assert(own.find(event => event.type === permissionMarker).seq < session.snapshotEvents().find(event => event.seq >= session.inheritedEventCount && event.type === 'turn/start').seq);
  }
  const next = await f.restart();
  assert.deepEqual((await next.host.client.request('health')).host.permissionExecution, execution);
  lead = (await next.host.ctx.sessionController.resolveAgent(created.teamId)).agent;
  assert(lead);
  const resume = async (parent, id) => {
    await next.host.ctx.subagents.prompt({ parentSessionId: parent.id, childSessionId: id, mode: 'continuable', requestId: `resume-${id}`, delivery: 'queue', content: [{ type: 'text', text: 'Synthetic cold continuation.' }] }, new AbortController().signal);
    await next.host.ctx.agents.get(id)?.whenIdle();
    assert(next.host.requests.some(request => request.sessionId === id), JSON.stringify(next.host.ctx.sessions.get(id)?.snapshotEvents().slice(-5)));
    const session = await policySession(next.host, id);
    assert.deepEqual(ownPolicy(session), before.get(id));
    return next.host.ctx.agents.get(id) ?? (await next.host.ctx.sessionController.resolveAgent(id)).agent;
  };
  first = await resume(lead, firstId);
  await resume(first, secondId);
  await next.host.ctx.subagents.drainChildren(first, [secondId]);
  await next.host.ctx.subagents.drainChildren(lead, [firstId]);
});
