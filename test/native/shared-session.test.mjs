import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fixtureRoles, mountNativeHost, textChunks, toolChunks, until } from '../fixtures/native-harness.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-'));
  const { cleanup, ...mountOptions } = options;
  let host;
  t.after(async () => { await cleanup?.(); await host?.dispose(); await rm(root, { recursive: true, force: true }); });
  host = await mountNativeHost({ root, ...mountOptions });
  return host;
}
const content = (text) => [{ type: 'text', text }];
const inactiveMember = (host, lead, id) => host.ctx.agentTeams.listMembers(lead).some((member) => member.id === id && member.status === 'inactive');
const startUnreservedChild = (host, parent, childId) => host.ctx.subagents.startActivation({
  provider: 'spawn', childId, label: 'Synthetic native admission negative control.',
  request: { parent, prompt: content('Synthetic unreserved native child.'), maxDepth: 3 },
  signal: new AbortController().signal, delivery: 'caller',
});
async function executeAliasedSpawn(host, parent, callId) {
  return host.ctx.tools.execute({ agent: parent, signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id: callId, name: 'delegate_custom', arguments: JSON.stringify({ description: 'Synthetic alias negative control.', prompt: 'Synthetic aliased delegation.' }) }],
  });
}

test('native Remote submissions appear in the same native SessionController and Team projections', { timeout: 20000 }, async (t) => {
  const host = await fixture(t);
  const workspace = await host.ctx.workspaceRegistry.create(host.fixtureRoot);
  const input = { key: 'synthetic-team-one', text: 'Add the synthetic values 2 and 3.', cwd: host.fixtureRoot, workspaceId: workspace.id };
  const receipt = await host.client.request('create', input);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.sessionId, receipt.teamId);
  await until(() => host.requests.length === 1 && host.ctx.agents.get(receipt.teamId)?.status === 'idle');
  const nativeList = await host.ctx.sessionController.list({}, new AbortController().signal);
  assert(nativeList.items.some((item) => item.sessionId === receipt.teamId));
  assert(workspace.sessionIds.includes(receipt.teamId));
  const duplicate = await host.client.request('create', input);
  assert.equal(duplicate.teamId, receipt.teamId);
  assert.equal(duplicate.duplicate, true);
  assert.equal(host.requests.length, 1);
  await assert.rejects(host.client.request('create', { ...input, text: 'Changed content.' }), { code: 'CONTENT_CONFLICT' });
  const lead = host.ctx.agents.get(receipt.teamId);
  assert.deepEqual(lead.model.current(), { provider: 'fixture-lead', model: 'fixture-model', reasoningEffort: 'max' });
  const originalSpawn = await host.ctx.tools.execute({
    agent: lead, signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id: 'blocked-original-spawn', name: 'spawn_teammate', arguments: JSON.stringify({ name: 'unbound-bypass', description: 'Synthetic bypass negative control.', prompt: 'Synthetic bypass.', context: 'fresh' }) }],
  });
  assert.equal(originalSpawn.results[0].result.isError, true);
  assert.match(originalSpawn.results[0].result.error.message, /allowlisted role/u);
  assert.equal(host.ctx.agentTeams.listMembers(lead).some((item) => item.name === 'unbound-bypass'), false);
  const requestText = JSON.stringify(host.requests[0].messages);
  assert.match(requestText, /Coordinate synthetic fixture work/u);
  const projected = await host.ctx.sessionController.projections({ sessionId: receipt.teamId }, new AbortController().signal);
  assert.equal(projected.kind, 'sequenced');
  assert.equal(projected.values.agentTeam.members.find((item) => item.role === 'lead').id, receipt.teamId);
  assert.equal(projected.values.dshRoles.bound.role, 'lead');
  const result = await host.client.request('result', { teamId: receipt.teamId });
  assert.equal(result.completed, true);
  assert.equal(result.output, 'SYNTHETIC_COMPLETE');
  assert.equal(result.inputs.find((item) => item.id === receipt.inputId).processed, true);
  assert.equal(result.usage, null);
  assert.equal(result.fees, null);
  const audit = (await readFile(host.auditPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0].payload.messages, host.requests[0].messages);
});

test('concurrent native members receive their immutable roles before first inference and retain identity on follow-up', { timeout: 20000 }, async (t) => {
  const entered = new Set();
  const gate = Promise.withResolvers();
  t.after(() => gate.resolve());
  const host = await fixture(t, {
    respond: async (options) => {
      if (options.provider !== 'fixture-lead' && !entered.has(options.provider)) {
        entered.add(options.provider);
        await gate.promise;
      }
      return textChunks(`SYNTHETIC_${options.provider}`);
    },
  });
  const created = await host.client.request('create', { key: 'concurrent', text: 'Coordinate synthetic members.', cwd: host.fixtureRoot });
  const lead = host.ctx.agents.get(created.teamId);
  await lead.whenIdle();
  const signal = new AbortController().signal;
  const leftPromise = host.ctx.dshRoles.spawn(lead, { name: 'left-one', role: 'left', prompt: 'Compute synthetic left 7 plus 2.', signal });
  const rightPromise = host.ctx.dshRoles.spawn(lead, { name: 'right-one', role: 'right', prompt: 'Compute synthetic right 8 plus 3.', signal });
  const [left, right] = await Promise.all([leftPromise, rightPromise]);
  await until(() => entered.size === 2, { description: 'two simultaneously running member requests' });
  assert.equal(host.ctx.agents.get(left.member.id).status, 'running');
  assert.equal(host.ctx.agents.get(right.member.id).status, 'running');
  for (const [member, provider, instruction] of [[left, 'fixture-left', 'LEFT_ROLE_V1'], [right, 'fixture-right', 'RIGHT_ROLE_V1']]) {
    const request = host.requests.find((item) => item.sessionId === member.member.id);
    assert.equal(request.provider, provider);
    assert.equal(request.reasoningEffort, 'max');
    assert.match(JSON.stringify(request.messages), new RegExp(instruction, 'u'));
    const events = host.ctx.sessions.get(member.member.id).snapshotEvents();
    assert(events.findIndex((event) => event.type === 'plugin:dsh-agent-team/role-bound') < events.findIndex((event) => event.type === 'request/header'));
  }
  const tasks = await host.ctx.agentTeams.createTask(lead, { subject: 'Synthetic collaboration', description: 'Complete synthetic fixture work.', writeScopes: ['left-result.txt'] });
  assert.equal(tasks.status, 'pending');
  gate.resolve();
  await until(() => [left, right].every((member) => inactiveMember(host, lead, member.member.id)));
  await host.ctx.agentTeams.sendMessage(lead, { target: 'left-one', content: content('Synthetic follow-up: add 1.'), signal });
  await until(() => host.requests.filter((item) => item.sessionId === left.member.id).length === 2 && inactiveMember(host, lead, left.member.id));
  const repeated = await host.ctx.dshRoles.spawn(lead, { name: 'left-one', role: 'left', prompt: 'Compute synthetic left 7 plus 2.', signal });
  assert.equal(repeated.member.id, left.member.id);
  const secondInstance = await host.ctx.dshRoles.spawn(lead, { name: 'left-two', role: 'left', prompt: 'Compute synthetic left 3 plus 4.', signal });
  assert.notEqual(secondInstance.member.id, left.member.id);
  await until(() => inactiveMember(host, lead, secondInstance.member.id));
  const status = await host.client.request('status', { teamId: created.teamId });
  assert.equal(status.team.members.length, 4);
  assert.equal(status.team.tasks[0].subject, 'Synthetic collaboration');
  assert.equal(status.members.find((item) => item.name === 'left-one').lastRequest.provider, 'fixture-left');
  assert.equal(status.members.find((item) => item.name === 'right-one').lastRequest.provider, 'fixture-right');
});

test('a completed native Team remains completed after its child unloads and result reads do not activate it', { timeout: 20000 }, async (t) => {
  const host = await fixture(t);
  const created = await host.client.request('create', { key: 'unloaded-completion', text: 'Synthetic completed Team fixture.', cwd: host.fixtureRoot });
  const lead = host.ctx.agents.get(created.teamId);
  await lead.whenIdle();
  const member = await host.ctx.dshRoles.spawn(lead, { name: 'completed-one', role: 'left', prompt: 'Synthetic completed member.', signal: new AbortController().signal });
  await until(() => inactiveMember(host, lead, member.member.id) && host.ctx.agents.get(member.member.id) === undefined, { description: 'completed native child to unload' });
  const createdDuringReads = [];
  const stopObserving = host.ctx.on('agent/created', ({ agent }) => { createdDuringReads.push(agent.id); });
  t.after(stopObserving);
  const requestCount = host.requests.length;
  const result = await host.client.request('result', { teamId: created.teamId });
  assert.equal(result.rootTurnCompleted, true);
  assert.equal(result.completed, true);
  assert.equal(result.taskState, 'completed');
  assert.equal(result.teamActivity.pendingTasks, 0);
  const runtime = result.teamActivity.members.find((row) => row.id === member.member.id);
  assert.equal(runtime.runtimeState, 'unloaded');
  assert.equal(runtime.nativeStatus, 'inactive');
  assert.equal(runtime.pendingInputs, 0);
  assert.equal(runtime.lastTurnOutcome, 'completed');
  const status = await host.client.request('status', { teamId: created.teamId });
  const binding = status.members.find((row) => row.memberId === member.member.id);
  assert.equal(binding.selected, null);
  assert.equal(binding.lastRequest.provider, 'fixture-left');
  assert.equal(binding.lastRequest.reasoningEffort, 'max');
  assert.equal(host.ctx.agents.get(member.member.id), undefined);
  assert.deepEqual(createdDuringReads, []);
  assert.equal(host.requests.length, requestCount);
});

test('cold recovery requires explicit continuation and keeps old role snapshots while new members use changed config', { timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-recovery-'));
  let host;
  t.after(async () => { await host?.dispose(); await rm(root, { recursive: true, force: true }); });
  host = await mountNativeHost({ root });
  const created = await host.client.request('create', { key: 'recovery', text: 'Synthetic recovery fixture.', cwd: host.fixtureRoot });
  const lead = host.ctx.agents.get(created.teamId);
  await lead.whenIdle();
  const signal = new AbortController().signal;
  const first = await host.ctx.dshRoles.spawn(lead, { name: 'stable-one', role: 'left', prompt: 'Synthetic first member.', signal });
  await until(() => inactiveMember(host, lead, first.member.id));
  await host.ctx.sessions.flush(lead.session);
  const liveChild = host.ctx.sessions.get(first.member.id);
  if (liveChild !== undefined) await host.ctx.sessions.flush(liveChild);
  await host.dispose();
  host = undefined;
  const changed = { ...fixtureRoles, left: { ...fixtureRoles.left, provider: 'fixture-new', instructions: 'LEFT_ROLE_V2: New synthetic members only.' } };
  host = await mountNativeHost({ root, roles: changed });
  const cold = await host.client.request('status', { teamId: created.teamId });
  assert.equal(cold.runtimeState, 'unloaded');
  const old = cold.members.find((item) => item.name === 'stable-one');
  assert.equal(old.selected, null);
  assert.equal(old.lastRequest.provider, 'fixture-left');
  await assert.rejects(host.client.request('send', { teamId: created.teamId, inputId: 'continue-one', text: 'Synthetic continue.' }), { code: 'CONTINUATION_REQUIRED' });
  await host.client.request('send', { teamId: created.teamId, inputId: 'continue-one', text: 'Synthetic continue.', continue: true });
  await until(() => host.ctx.agents.get(created.teamId)?.status === 'idle');
  const resumedLead = host.ctx.agents.get(created.teamId);
  await host.ctx.agentTeams.sendMessage(resumedLead, { target: 'stable-one', content: content('Synthetic recovered follow-up.'), signal });
  await until(() => host.requests.some((item) => item.sessionId === first.member.id) && inactiveMember(host, resumedLead, first.member.id));
  assert.equal(host.requests.find((item) => item.sessionId === first.member.id).provider, 'fixture-left');
  assert.match(JSON.stringify(host.requests.find((item) => item.sessionId === first.member.id).messages), /LEFT_ROLE_V1/u);
  const fresh = await host.ctx.dshRoles.spawn(resumedLead, { name: 'changed-two', role: 'left', prompt: 'Synthetic newly configured member.', signal });
  await until(() => host.requests.some((item) => item.sessionId === fresh.member.id) && inactiveMember(host, resumedLead, fresh.member.id));
  assert.equal(host.requests.find((item) => item.sessionId === fresh.member.id).provider, 'fixture-new');
  assert.match(JSON.stringify(host.requests.find((item) => item.sessionId === fresh.member.id).messages), /LEFT_ROLE_V2/u);
  assert.equal(host.ctx.agentTeams.listMembers(resumedLead).filter((item) => item.name === 'stable-one').length, 1);
});

test('native cancellation and missing approval answerers fail closed without rollback or owner interaction privileges', { timeout: 20000 }, async (t) => {
  const host = await fixture(t, { respond: () => 'hang' });
  const created = await host.client.request('create', { key: 'cancel', text: 'Synthetic cancellable input.', cwd: host.fixtureRoot });
  const lead = host.ctx.agents.get(created.teamId);
  await until(() => host.requests.length === 1 && lead.status === 'running');
  const approval = await host.ctx.approval.request({ agent: lead, toolName: 'fixture_write', reason: 'Synthetic approval refusal check.' });
  assert.equal(approval, 'unavailable');
  assert.equal(lead.session.snapshotEvents().findLast((event) => event.type === 'approval/decided').data.outcome, 'unavailable');
  const passive = host.ctx.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' });
  await assert.rejects(host.ctx.typertGateway.wireStream.open('$events', { args: {} }, (async function* () {})(), passive, new AbortController().signal), { code: 'gateway/interactions-forbidden' });
  await passive.dispose();
  await host.files.write('left-result.txt', 'retained');
  const stopped = await host.client.request('stop', { teamId: created.teamId });
  assert.equal(stopped.accepted, true);
  assert.equal(stopped.filesRolledBack, false);
  // Native cancel acknowledges the request before the driver and public read settle.
  const status = await until(async () => {
    const observed = await host.client.request('status', { teamId: created.teamId });
    return observed.runtimeState === 'idle' && observed.rootTurnState === 'aborted' ? observed : false;
  }, { description: 'native cancellation to reach the public aborted state' });
  assert.equal(await host.files.read('left-result.txt'), 'retained');
  assert.equal(status.rootTurnState, 'aborted');
  await assert.rejects(host.client.request('send', { teamId: created.teamId, inputId: 'after-stop', text: 'Synthetic continuation.' }), { code: 'CONTINUATION_REQUIRED' });

  await host.client.request('send', { teamId: created.teamId, inputId: 'resume-for-child', text: 'Synthetic explicit continuation.', continue: true });
  await until(() => host.requests.filter((item) => item.sessionId === created.teamId).length === 2);
  const member = await host.ctx.dshRoles.spawn(lead, { name: 'cancel-one', role: 'left', prompt: 'Synthetic cancellable member.', signal: new AbortController().signal });
  await until(() => host.requests.some((item) => item.sessionId === member.member.id));
  const stoppedTeam = await host.client.request('stop', { teamId: created.teamId });
  assert.equal(stoppedTeam.accepted, true);
  assert.equal(stoppedTeam.outcomes.find((item) => item.sessionId === member.member.id).cancellation, 'requested');
  // A native child's settlement may wake the Lead with a new result-delivery turn.
  await until(async () => {
    const current = await host.ctx.sessionController.projections({ sessionId: member.member.id }, new AbortController().signal);
    return current?.values.dshBridge.lastEnd?.reason === 'aborted' && inactiveMember(host, lead, member.member.id);
  }, { description: 'native member interruption to finish' });
  assert.equal(await host.files.read('left-result.txt'), 'retained');
});

test('a running native turn accepts steer and queued inputs without continuation and processes each input once', { timeout: 20000 }, async (t) => {
  const gate = Promise.withResolvers();
  t.after(() => gate.resolve());
  let calls = 0;
  const host = await fixture(t, {
    respond: async () => {
      if (++calls === 1) {
        await gate.promise;
        return toolChunks('fixture_read', { name: 'nonce.txt' }, 'steer-boundary');
      }
      return textChunks('SYNTHETIC_STEER_COMPLETE');
    },
  });
  await writeFile(join(host.fixtureRoot, 'nonce.txt'), 'nonce-29');
  const created = await host.client.request('create', { key: 'steer-queue', text: 'Read the synthetic nonce.', cwd: host.fixtureRoot });
  await until(() => host.requests.length === 1);
  const lead = host.ctx.agents.get(created.teamId);
  assert.equal(lead.status, 'running');
  const steer = { teamId: created.teamId, inputId: 'steer-one', text: 'Synthetic steer: retain nonce-29.', mode: 'steer' };
  const queued = { teamId: created.teamId, inputId: 'queue-one', text: 'Synthetic queued follow-up.', mode: 'queue' };
  assert.equal((await host.client.request('send', steer)).accepted, true);
  assert.equal((await host.client.request('send', queued)).accepted, true);
  const repeated = await host.client.request('send', queued);
  assert.equal(repeated.duplicate, true);
  await assert.rejects(host.client.request('send', { ...queued, text: 'Changed synthetic queue content.' }), { code: 'CONTENT_CONFLICT' });
  gate.resolve();
  await until(() => calls >= 3 && lead.status === 'idle' && lead.inbox.nextTurn.length === 0);
  const events = lead.session.snapshotEvents();
  for (const inputId of [created.inputId, steer.inputId, queued.inputId]) {
    assert.equal(events.filter((event) => event.type === 'user/message' && event.data.source.rpcId === inputId).length, 1);
  }
  assert.match(JSON.stringify(host.requests[1].messages), /Synthetic steer: retain nonce-29/u);
  const result = await host.client.request('result', { teamId: created.teamId });
  assert.equal(result.inputs.filter((input) => input.processed).length, 3);
  assert.equal(result.rootTurnCompleted, true);
});

test('native provisioning cannot bypass a managed Lead role reservation', { timeout: 20000 }, async (t) => {
  const host = await fixture(t);
  const created = await host.client.request('create', { key: 'native-bypass', text: 'Synthetic native provisioning check.', cwd: host.fixtureRoot });
  const lead = host.ctx.agents.get(created.teamId);
  await lead.whenIdle();
  const priorRequests = host.requests.length;
  await assert.rejects(host.ctx.agentTeams.spawnTeammate(lead, { name: 'unreserved-direct', description: 'Synthetic negative control.', prompt: content('Synthetic unreserved input.'), context: 'fresh', provider: 'spawn', signal: new AbortController().signal }), /durable role reservation/u);
  assert.equal(host.requests.length, priorRequests);
  const row = host.ctx.agentTeams.listMembers(lead).find((member) => member.name === 'unreserved-direct');
  assert(row);
  assert.equal(row.status, 'failed');
  assert.equal(host.requests.some((request) => request.sessionId === row.id), false);
});

test('aliased native delegation and direct activation cannot create unreserved children under managed Leads or members', { timeout: 20000 }, async (t) => {
  const host = await fixture(t, { managed: false, respond: (options) => options.provider === 'fixture-left' ? 'hang' : textChunks('SYNTHETIC_PARENT_COMPLETE') });
  const leadId = 'synthetic-alias-lead';
  await host.ctx.dshRoles.prepareLead(leadId);
  await host.ctx.sessionController.create({ sessionId: leadId, cwd: host.fixtureRoot });
  const lead = host.ctx.agents.get(leadId);
  const member = await host.ctx.dshRoles.spawn(lead, { name: 'protected-one', role: 'left', prompt: 'Synthetic managed member.', signal: new AbortController().signal });
  await until(() => host.requests.some((request) => request.sessionId === member.member.id));
  const child = host.ctx.agents.get(member.member.id);
  assert(child);
  const aliasPlugin = await import('@deepseek-ai/dsh-tool-subagent');
  const aliasFiber = await host.ctx.plugin(aliasPlugin, { provider: 'spawn', toolName: 'delegate_custom', maxDepth: 3 });
  assert(host.ctx.tools.get('delegate_custom', lead));
  const priorRequests = host.requests.length;
  const aliased = await executeAliasedSpawn(host, lead, 'native-alias-lead');
  assert.equal(aliased.results[0].result.isError, true);
  assert.match(aliased.results[0].result.error.message, /allowlisted role/u);
  for (const [parent, id] of [[lead, 'synthetic-unreserved-lead-child'], [child, 'synthetic-unreserved-member-child']]) {
    await assert.rejects(startUnreservedChild(host, parent, id), /durable role reservation/u);
    assert.equal(host.ctx.agents.get(id), undefined);
    assert.equal(host.requests.some((request) => request.sessionId === id), false);
  }
  assert.equal(host.requests.length, priorRequests);
  await aliasFiber.dispose();
  host.ctx.agentTeams.interrupt(lead, member.member.name);
  await until(() => inactiveMember(host, lead, member.member.id));
});

test('an independent native Web fork of a managed Session remains an ordinary unmanaged Session', { timeout: 20000 }, async (t) => {
  const host = await fixture(t, { managed: false });
  const leadId = 'synthetic-web-fork-parent';
  await host.ctx.dshRoles.prepareLead(leadId);
  await host.ctx.sessionController.create({ sessionId: leadId, cwd: host.fixtureRoot });
  const lead = host.ctx.agents.get(leadId);
  await host.ctx.sessionController.prompt({ sessionId: leadId, requestId: 'synthetic-web-fork-input', mode: 'queue', content: content('Synthetic completed fork source.') }, new AbortController().signal);
  await until(() => host.requests.length === 1 && lead.status === 'idle');
  const forked = await host.ctx.sessionController.fork({ sessionId: leadId });
  const ordinary = host.ctx.agents.get(forked.sessionId);
  assert(ordinary);
  assert.notEqual(ordinary.id, lead.id);
  assert.notEqual(ordinary.session.header.origin, 'subagent');
  assert.equal(host.ctx.agents.isOwnedBy(ordinary.id, lead), false);
  assert.equal(await host.ctx.dshRoles.bindingFor(ordinary), null);
  await host.ctx.sessionController.prompt({ sessionId: ordinary.id, requestId: 'synthetic-independent-fork-input', mode: 'queue', content: content('Synthetic independent fork continuation.') }, new AbortController().signal);
  await until(() => host.requests.some((request) => request.sessionId === ordinary.id) && ordinary.status === 'idle');
});

test('managed child admission remains closed while the role service unloads and valid role provisioning resumes after reload', { timeout: 20000 }, async (t) => {
  const host = await fixture(t, { managed: false });
  const leadId = 'synthetic-role-reload-parent';
  await host.ctx.dshRoles.prepareLead(leadId);
  await host.ctx.sessionController.create({ sessionId: leadId, cwd: host.fixtureRoot });
  const lead = host.ctx.agents.get(leadId);
  const aliasPlugin = await import('@deepseek-ai/dsh-tool-subagent');
  const aliasFiber = await host.ctx.plugin(aliasPlugin, { provider: 'spawn', toolName: 'delegate_custom', maxDepth: 3 });
  await host.roleFiber.dispose();
  assert.equal(host.ctx.get('dshRoles'), undefined);
  assert.equal(host.ctx.agents.get(leadId), lead);
  assert.equal(host.ctx.tools.get('spawn_role_teammate', lead), undefined);
  const priorRequests = host.requests.length;
  const blocked = await executeAliasedSpawn(host, lead, 'synthetic-role-reload-alias');
  assert.equal(blocked.results[0].result.isError, true);
  assert.match(blocked.results[0].result.error.message, /allowlisted role/u);
  await assert.rejects(startUnreservedChild(host, lead, 'synthetic-role-gap-child'), /role service is unavailable/u);
  assert.equal(host.ctx.agents.get('synthetic-role-gap-child'), undefined);
  assert.equal(host.requests.length, priorRequests);
  await aliasFiber.dispose();
  await host.ctx.plugin(host.rolePlugin, host.roleConfig);
  assert.equal(host.ctx.dshRoles.isReady(), true);
  assert(host.ctx.tools.get('spawn_role_teammate', lead));
  const member = await host.ctx.dshRoles.spawn(lead, { name: 'after-reload-one', role: 'right', prompt: 'Synthetic role reload success.', signal: new AbortController().signal });
  await until(() => host.requests.some((request) => request.sessionId === member.member.id) && inactiveMember(host, lead, member.member.id));
  assert.equal(host.requests.find((request) => request.sessionId === member.member.id).provider, 'fixture-right');
});

test('aliased native external activation is denied before provider start while unmanaged native dispatch remains available', { timeout: 20000 }, async (t) => {
  const outcome = Promise.withResolvers();
  const host = await fixture(t, { managed: false, cleanup: () => { outcome.resolve({ output: [], stopReason: 'aborted' }); } });
  const managedId = 'synthetic-external-managed-parent';
  await host.ctx.dshRoles.prepareLead(managedId);
  await host.ctx.sessionController.create({ sessionId: managedId, cwd: host.fixtureRoot });
  const managed = host.ctx.agents.get(managedId);
  let startCalls = 0;
  let disposeCalls = 0;
  host.ctx.subagents.registerProvider({
    name: 'fixture-external', capabilities: {}, inheritsParentContext: false,
    async start(request) {
      startCalls++;
      assert.equal(request.parent.id, 'synthetic-external-unmanaged-parent');
      assert.deepEqual(request.prompt, content('Synthetic external fixture task.'));
      return { id: 'synthetic-external-run', result: outcome.promise, async dispose() { disposeCalls++; outcome.resolve({ output: [], stopReason: 'aborted' }); } };
    },
  });
  const aliasPlugin = await import('@deepseek-ai/dsh-tool-subagent');
  const aliasFiber = await host.ctx.plugin(aliasPlugin, { provider: 'fixture-external', toolName: 'remote_custom', maxDepth: 'provider-managed' });
  const definition = host.ctx.tools.get('remote_custom', managed);
  assert.equal(definition.output.schema.properties.kind.const, 'activation');
  assert(definition.output.schema.required.includes('subagentId'));
  const localIds = host.ctx.agents.list().map((agent) => agent.id);
  const invoke = (parent, toolSet) => host.ctx.tools.execute({ agent: parent, ...(toolSet === undefined ? {} : { toolSet }), signal: new AbortController().signal,
    calls: [{ type: 'tool-call', id: `synthetic-external-${toolSet === undefined ? 'plain' : 'admitted'}`, name: 'remote_custom', arguments: JSON.stringify({ description: 'Synthetic external test.', prompt: 'Synthetic external fixture task.' }) }],
  });
  const plain = await invoke(managed);
  assert.equal(plain.results[0].result.isError, true);
  assert.match(plain.results[0].result.error.message, /allowlisted role/u);
  const admitted = await host.ctx.tools.resolve({ agent: managed, modelSelection: managed.model.current(), signal: new AbortController().signal });
  try {
    assert.equal(admitted.view(managed).get('remote_custom'), definition);
    const selected = await invoke(managed, admitted);
    assert.equal(selected.results[0].result.isError, true);
    assert.match(selected.results[0].result.error.message, /allowlisted role/u);
  } finally { admitted.dispose(); }
  assert.equal(startCalls, 0);
  assert.equal(host.requests.length, 0);
  assert.deepEqual(host.ctx.agents.list().map((agent) => agent.id), localIds);
  await host.roleFiber.dispose();
  assert.equal(host.ctx.get('dshRoles'), undefined);
  assert.equal(host.ctx.agents.get(managedId), managed);
  const whileUnloaded = await invoke(managed);
  assert.equal(whileUnloaded.results[0].result.isError, true);
  assert.match(whileUnloaded.results[0].result.error.message, /allowlisted role/u);
  const unloadedToolSet = await host.ctx.tools.resolve({ agent: managed, modelSelection: managed.model.current(), signal: new AbortController().signal });
  try {
    const selectedWhileUnloaded = await invoke(managed, unloadedToolSet);
    assert.equal(selectedWhileUnloaded.results[0].result.isError, true);
    assert.match(selectedWhileUnloaded.results[0].result.error.message, /allowlisted role/u);
  } finally { unloadedToolSet.dispose(); }
  assert.equal(startCalls, 0);
  assert.equal(host.requests.length, 0);
  await host.ctx.sessionController.create({ sessionId: 'synthetic-external-unmanaged-parent', cwd: host.fixtureRoot });
  const ordinary = host.ctx.agents.get('synthetic-external-unmanaged-parent');
  const control = await invoke(ordinary);
  assert.equal(control.results[0].result.isError, false);
  assert.equal(control.results[0].result.value.subagentId, 'synthetic-external-run');
  assert.equal(startCalls, 1);
  assert.equal(host.ctx.agents.get('synthetic-external-run'), undefined);
  await aliasFiber.dispose();
  outcome.resolve({ output: content('Synthetic external fixture complete.'), stopReason: 'completed' });
  await until(() => disposeCalls === 1 && host.requests.length === 1 && ordinary.status === 'idle');
  assert.equal(host.requests[0].sessionId, ordinary.id);
});

test('ordinary native Web Sessions and Teams retain native provisioning without a managed role binding', { timeout: 20000 }, async (t) => {
  const host = await fixture(t, { managed: false });
  const created = await host.ctx.sessionController.create({ cwd: host.fixtureRoot });
  const lead = host.ctx.agents.get(created.sessionId);
  await host.ctx.sessionController.prompt({ sessionId: created.sessionId, requestId: 'native-web-input', mode: 'queue', content: content('Synthetic native Web control input.') }, new AbortController().signal);
  await until(() => host.requests.length === 1 && lead.status === 'idle');
  const member = await host.ctx.agentTeams.spawnTeammate(lead, { name: 'native-unmanaged', description: 'Synthetic ordinary native teammate.', prompt: content('Synthetic ordinary native child.'), context: 'fresh', provider: 'spawn', signal: new AbortController().signal });
  await until(() => host.requests.some((request) => request.sessionId === member.member.id) && inactiveMember(host, lead, member.member.id));
  assert.equal((await host.ctx.dshRoles.bindings(lead.id)).length, 0);
  assert.equal(host.ctx.agentTeams.listMembers(lead).find((row) => row.name === 'native-unmanaged').id, member.member.id);
});

test('verified native host identity refuses replacement service facades', { timeout: 20000 }, async (t) => {
  const host = await fixture(t, { managed: false });
  const { assertNativeHost } = await import('../../src/teams/index.mjs');
  const names = ['agents', 'sessions', 'sessionController', 'agentTeams', 'connection', 'typertGateway'];
  const actual = Object.fromEntries(names.map((name) => [name, host.ctx[name]]));
  await assertNativeHost(actual);
  for (const name of names) await assert.rejects(assertNativeHost({ ...actual, [name]: {} }), { code: 'HOST_RUNTIME_MISMATCH' });
});

test('durable admission metadata reconciles native create and prompt reply-loss windows without duplicate input', { timeout: 20000 }, async (t) => {
  let store;
  let port;
  const host = await fixture(t, { managed: false, cleanup: async () => { await port?.close(); await store?.close(); } });
  const [{ NativeSessionPort }, { ManagedTeams }, { TeamStore }] = await Promise.all([import('../../src/teams/native-port.mjs'), import('../../src/teams/service.mjs'), import('../../src/teams/private-store.mjs')]);
  const statePath = join(host.root, 'admission-crash');
  store = await new TeamStore(statePath).open();
  let createCalls = 0;
  class LostCreateReply extends NativeSessionPort {
    async create(request) {
      createCalls++;
      const result = await super.create(request);
      await super.flush(request.sessionId);
      throw new Error('SYNTHETIC_LOST_CREATE_REPLY');
    }
  }
  port = new LostCreateReply(host.ctx, host.ctx.dshRoles);
  let bridge = new ManagedTeams({ native: port, store, allowedRoots: [host.fixtureRoot] });
  const first = { key: 'create-window', text: 'Synthetic create crash window.', cwd: host.fixtureRoot };
  await assert.rejects(bridge.create(first), /SYNTHETIC_LOST_CREATE_REPLY/u);
  const reserved = await store.get('key', first.key);
  assert.equal(reserved.stage, 'reserved');
  assert(host.ctx.agents.get(reserved.sessionId));
  assert.equal(host.requests.length, 0);
  await port.close();
  await store.close();
  store = await new TeamStore(statePath).open();
  port = new NativeSessionPort(host.ctx, host.ctx.dshRoles);
  bridge = new ManagedTeams({ native: port, store, allowedRoots: [host.fixtureRoot] });
  const recovered = await bridge.create(first);
  assert.equal(recovered.teamId, reserved.sessionId);
  await until(() => host.requests.length === 1 && host.ctx.agents.get(recovered.teamId)?.status === 'idle');
  assert.equal(createCalls, 1);
  await port.close();
  class LostPromptReply extends NativeSessionPort {
    async prompt(request) {
      await super.prompt(request);
      await super.flush(request.sessionId);
      throw new Error('SYNTHETIC_LOST_PROMPT_REPLY');
    }
  }
  port = new LostPromptReply(host.ctx, host.ctx.dshRoles);
  bridge = new ManagedTeams({ native: port, store, allowedRoots: [host.fixtureRoot] });
  const followup = { teamId: recovered.teamId, inputId: 'prompt-window', text: 'Synthetic prompt crash window.' };
  await assert.rejects(bridge.send(followup), /SYNTHETIC_LOST_PROMPT_REPLY/u);
  assert.equal((await store.get('input', [recovered.teamId, followup.inputId])).accepted, false);
  await until(() => host.requests.length === 2 && host.ctx.agents.get(recovered.teamId)?.status === 'idle');
  await port.close();
  await store.close();
  store = await new TeamStore(statePath).open();
  port = new NativeSessionPort(host.ctx, host.ctx.dshRoles);
  bridge = new ManagedTeams({ native: port, store, allowedRoots: [host.fixtureRoot] });
  assert.equal((await bridge.send(followup)).accepted, true);
  assert.equal(host.requests.length, 2);
  const logged = host.ctx.sessions.get(recovered.teamId).snapshotEvents().filter((event) => event.type === 'user/message' && event.data.source.rpcId === followup.inputId);
  assert.equal(logged.length, 1);
  const listed = await host.ctx.sessionController.list({}, new AbortController().signal);
  assert.equal(listed.items.filter((item) => item.sessionId === reserved.sessionId).length, 1);
});

test('a flushed process crash recovers the same native member and immutable role with explicit continuation', { timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-crash-'));
  const child = spawn(process.execPath, ['test/fixtures/crash-host.mjs', root], { cwd: new URL('../..', import.meta.url), env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let host;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    await host?.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const readyLine = await lines.next();
  assert.equal(readyLine.done, false, stderr);
  const ready = JSON.parse(readyLine.value);
  assert.equal(ready.ready, true);
  const { NativeClient } = await import('../fixtures/client.mjs');
  const client = new NativeClient({ url: ready.url });
  t.after(() => client.close());
  const originalInput = { key: 'hard-crash', text: 'Synthetic crash: start the left role.', cwd: ready.fixtureRoot };
  const created = await client.request('create', originalInput);
  let before;
  await until(async () => {
    before = await client.request('status', { teamId: created.teamId });
    return before.members.some((member) => member.name === 'crash-one' && member.lastRequest?.provider === 'fixture-left');
  }, { description: 'native child first request before crash' });
  const childId = before.members.find((member) => member.name === 'crash-one').memberId;
  child.stdin.write('flush\n');
  const flushed = await lines.next();
  assert.deepEqual(JSON.parse(flushed.value), { flushed: true });
  child.kill('SIGKILL');
  assert.deepEqual(await exited, [null, 'SIGKILL']);
  client.close();
  const changed = { ...fixtureRoles, left: { ...fixtureRoles.left, provider: 'fixture-new', instructions: 'LEFT_ROLE_V2: Only new members use this profile.' } };
  host = await mountNativeHost({ root, roles: changed });
  const cold = await host.client.request('status', { teamId: created.teamId });
  assert.equal(cold.runtimeState, 'unloaded');
  assert.equal(cold.members.find((member) => member.name === 'crash-one').memberId, childId);
  assert.equal(cold.members.find((member) => member.name === 'crash-one').selected, null);
  const repeatedCreate = await host.client.request('create', originalInput);
  assert.equal(repeatedCreate.teamId, created.teamId);
  assert.equal(host.requests.length, 0);
  await assert.rejects(host.client.request('send', { teamId: created.teamId, inputId: 'after-crash', text: 'Synthetic explicit recovery.' }), { code: 'CONTINUATION_REQUIRED' });
  await host.client.request('send', { teamId: created.teamId, inputId: 'after-crash', text: 'Synthetic explicit recovery.', continue: true });
  await until(() => host.ctx.agents.get(created.teamId)?.status === 'idle');
  const lead = host.ctx.agents.get(created.teamId);
  await host.ctx.agentTeams.sendMessage(lead, { target: 'crash-one', content: content('Synthetic same-member recovery follow-up.'), signal: new AbortController().signal });
  await until(() => host.requests.some((request) => request.sessionId === childId) && inactiveMember(host, lead, childId));
  assert(host.requests.filter((request) => request.sessionId === childId).every((request) => request.provider === 'fixture-left'));
  assert.match(JSON.stringify(host.requests.find((request) => request.sessionId === childId).messages), /LEFT_ROLE_V1/u);
  assert.equal(host.ctx.agentTeams.listMembers(lead).filter((member) => member.name === 'crash-one').length, 1);
});

test('a native member model selection survives cold recovery independently of its immutable configured role', { timeout: 20000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-selection-'));
  const gate = Promise.withResolvers();
  let host;
  t.after(async () => { gate.resolve(); await host?.dispose(); await rm(root, { recursive: true, force: true }); });
  host = await mountNativeHost({ root, managed: false, respond: async (options) => { if (options.provider === 'fixture-left') await gate.promise; return textChunks('SYNTHETIC_SELECTION_COMPLETE'); } });
  const rootId = 'synthetic-native-selection';
  await host.ctx.dshRoles.prepareLead(rootId);
  await host.ctx.sessionController.create({ sessionId: rootId, cwd: host.fixtureRoot });
  const lead = host.ctx.agents.get(rootId);
  const member = await host.ctx.dshRoles.spawn(lead, { name: 'selected-one', role: 'left', prompt: 'Synthetic durable selection.', signal: new AbortController().signal });
  await until(() => host.requests.some((request) => request.sessionId === member.member.id));
  const child = host.ctx.agents.get(member.member.id);
  child.model.select({ provider: 'fixture-new', model: 'fixture-model', reasoningEffort: 'max' });
  await host.ctx.sessions.flush(child.session);
  gate.resolve();
  await until(() => inactiveMember(host, lead, member.member.id));
  const initial = (await host.ctx.dshRoles.bindings(rootId)).find((binding) => binding.name === 'selected-one');
  assert.equal(initial.configured.provider, 'fixture-left');
  assert.equal(initial.lastRequest.provider, 'fixture-left');
  await host.dispose();
  host = undefined;
  const changed = { ...fixtureRoles, left: { ...fixtureRoles.left, provider: 'fixture-right', instructions: 'LEFT_ROLE_V2: This changed role is only for new members.' } };
  host = await mountNativeHost({ root, managed: false, roles: changed });
  const resumed = await host.ctx.sessionController.resolveAgent(rootId);
  assert(resumed.agent);
  await host.ctx.agentTeams.sendMessage(resumed.agent, { target: 'selected-one', content: content('Synthetic selected-route recovery.'), signal: new AbortController().signal });
  await until(() => host.requests.some((request) => request.sessionId === member.member.id)
    && inactiveMember(host, resumed.agent, member.member.id)
    && host.ctx.agents.get(member.member.id) === undefined, { description: 'recovered native member to unload' });
  const request = host.requests.find((item) => item.sessionId === member.member.id);
  assert.equal(request.provider, 'fixture-new');
  assert.equal(request.reasoningEffort, 'max');
  assert.match(JSON.stringify(request.messages), /LEFT_ROLE_V1/u);
  const recovered = (await host.ctx.dshRoles.bindings(rootId)).find((binding) => binding.name === 'selected-one');
  assert.equal(recovered.configured.provider, 'fixture-left');
  assert.equal(recovered.lastRequest.provider, 'fixture-new');
  assert.equal(recovered.selected, null);
});
