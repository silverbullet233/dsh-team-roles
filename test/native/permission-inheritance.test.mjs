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
async function fixture(t) {
  const root = await mkdtemp('/tmp/dsh-profile-data-');
  const prior = process.env.DSH_AGENT_TEAM_LAUNCH_PERMISSION_BINDING;
  process.env.DSH_AGENT_TEAM_LAUNCH_PERMISSION_BINDING = binding;
  let host, port;
  t.after(async () => { await port?.close(); await host?.dispose(); await rm(root, { recursive: true, force: true }); if (prior === undefined) delete process.env.DSH_AGENT_TEAM_LAUNCH_PERMISSION_BINDING; else process.env.DSH_AGENT_TEAM_LAUNCH_PERMISSION_BINDING = prior; });
  const mount = async () => {
    host = await mountNativeHost({ root });
    host.ctx.provide('shell', { sandboxMode: 'workspace-write' });
    await host.ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: host.fixtureRoot });
    await host.ctx.plugin(PermissionPresets, {});
    port = new NativeSessionPort(host.ctx, host.ctx.dshRoles);
  };
  await mount();
  const params = { key: 'signed-profile', cwd: host.fixtureRoot, text: 'Synthetic permission policy data validation.' };
  const profile = { sandboxMode: 'workspace-write', approvalPolicy: 'ask', writableRoots: [host.fixtureRoot], networkAccess: 'restricted', binding };
  return { host, port, params, profile, restart: async () => { await port.close(); await host.dispose(); await mount(); return { host, port }; } };
}

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
