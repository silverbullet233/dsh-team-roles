import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit';
import { mountNativeHost, fixtureRoles, until } from '../fixtures/native-harness.mjs';
import { BridgeClient } from '../fixtures/client.mjs';
import { catalogFromLegacy } from '../../src/settings/catalog.mjs';
import * as Host from '../../src/host.mjs';

async function fixture(t, root, catalog) {
  const base = await mountNativeHost({ root, bridge: false });
  await base.roleFiber.dispose();
  // Actual Loader/Settings writes are tested separately; this test exercises
  // the complete native host composition and the volatile consumption seam.
  base.ctx.provide('settings', { configure: () => () => {} });
  const socketPath = join(root, 'native.sock');
  const fiber = base.ctx.plugin(Host, { stateDirectory: join(root, 'role-state'), socketPath, allowedRoots: [base.fixtureRoot], catalog });
  await fiber;
  const client = new BridgeClient({ socketPath });
  t.after(async () => { client.close(); await base.dispose(); });
  return { ...base, client, fiber };
}

test('full native host composes roles, settings Remote and IPC; catalog changes affect new reservations only', { timeout: 20000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'team-role-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = catalogFromLegacy({ leadRole: 'lead', roles: fixtureRoles });
  const host = await fixture(t, root, value);
  assert.equal((await host.client.request('health')).protocol.version, 1);
  assert(host.ctx.typert.local.get('teamRoleSettings/save'));
  const first = await host.client.request('create', { key: 'before-settings', cwd: host.fixtureRoot, text: 'Synthetic catalog baseline.' });
  const lead = host.ctx.agents.get(first.teamId); await lead.whenIdle();
  const signal = new AbortController().signal;
  const args = { name: 'retained-left', role: 'left', prompt: 'Synthetic retained role member.', signal };
  const member = await host.ctx.dshRoles.spawn(lead, args);
  await until(() => host.requests.some(request => request.sessionId === member.member.id));
  const next = structuredClone(value);
  next.roles = next.roles.filter(role => role.name !== 'left');
  next.roles[0] = { ...next.roles[0], provider: 'fixture-new', description: 'NEW_LEAD_DESCRIPTION', instructions: 'NEW_LEAD_INSTRUCTIONS: Synthetic new Lead.' };
  next.roles[1].description = 'CURRENT_CATALOG_DESCRIPTION';
  updateVolatile(host.fiber.effectiveConfig.catalog, createVolatile(next));
  assert.equal((await host.client.request('health')).roles.roles.some(role => role.name === 'left'), false);
  const same = await host.ctx.dshRoles.spawn(lead, args);
  assert.equal(same.member.id, member.member.id);
  await assert.rejects(host.ctx.dshRoles.spawn(lead, { ...args, name: 'not-bound' }), /not allowlisted/);
  await host.client.request('send', { teamId: first.teamId, inputId: 'after-settings', text: 'Synthetic current catalog follow-up.' });
  await until(() => host.requests.filter(request => request.sessionId === first.teamId).length >= 2 && lead.status === 'idle');
  const request = host.requests.findLast(request => request.sessionId === first.teamId);
  assert.equal(request.provider, 'fixture-lead');
  assert.match(JSON.stringify(request.messages), /CURRENT_CATALOG_DESCRIPTION/);
  assert.doesNotMatch(JSON.stringify(request.messages), /NEW_LEAD_INSTRUCTIONS/);
  const second = await host.client.request('create', { key: 'after-settings', cwd: host.fixtureRoot, text: 'Synthetic new Lead with saved route.' });
  await until(() => host.requests.some(request => request.sessionId === second.teamId));
  assert.equal(host.requests.find(request => request.sessionId === second.teamId).provider, 'fixture-new');
});

test('removed roles still recover bound native members from durable snapshots', { timeout: 20000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'team-role-removed-'));
  let host;
  t.after(async () => { await host?.dispose(); await rm(root, { recursive: true, force: true }); });
  host = await mountNativeHost({ root });
  const created = await host.client.request('create', { key: 'removed-recovery', cwd: host.fixtureRoot, text: 'Synthetic removal recovery.' });
  const lead = host.ctx.agents.get(created.teamId); await lead.whenIdle();
  const signal = new AbortController().signal;
  const first = await host.ctx.dshRoles.spawn(lead, { name: 'stable-left', role: 'left', prompt: 'Synthetic durable member.', signal });
  await until(() => host.requests.some(request => request.sessionId === first.member.id) && !['running','queued'].includes(host.ctx.agentTeams.listMembers(lead).find(member => member.id === first.member.id)?.status));
  await host.ctx.sessions.flush(lead.session);
  await host.dispose(); host = undefined;
  const { left, ...remaining } = fixtureRoles;
  host = await mountNativeHost({ root, roles: remaining });
  await host.client.request('send', { teamId: created.teamId, inputId: 'resume-removed', text: 'Synthetic removed role continuation.', continue: true });
  await until(() => host.ctx.agents.get(created.teamId)?.status === 'idle');
  const resumed = host.ctx.agents.get(created.teamId);
  await host.ctx.agentTeams.sendMessage(resumed, { target: 'stable-left', content: [{ type: 'text', text: 'Synthetic recovered removed-role member.' }], signal });
  await until(() => host.requests.some(request => request.sessionId === first.member.id));
  const request = host.requests.find(request => request.sessionId === first.member.id);
  assert.equal(request.provider, 'fixture-left');
  assert.match(JSON.stringify(request.messages), /LEFT_ROLE_V1/);
  assert.equal(host.ctx.agentTeams.listMembers(resumed).find(member => member.name === 'stable-left').id, first.member.id);
});
