import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountNativeHost, textChunks, toolChunks, until } from '../fixtures/native-harness.mjs';

test('native tool receipts expose root/member cuts without payloads and survive passive cold reconstruction', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-receipts-'));
  let count = 0, entered = false, host;
  const gate = Promise.withResolvers();
  host = await mountNativeHost({ root, respond: options => options.provider === 'fixture-left' && ++count === 1
    ? toolChunks('fixture_read', { name: 'nonce.txt' }, 'blocked-call') : textChunks('SYNTHETIC_DONE') });
  t.after(async () => { gate.resolve(); await host.client.close(); await host.dispose(); await rm(root, { recursive: true, force: true }); });
  host.files.read = async () => { entered = true; await gate.promise; return 'SECRET_RESULT'; };
  const first = await host.client.request('create', { key: 'tool-receipts', cwd: host.fixtureRoot, text: 'Synthetic root.' });
  const lead = host.ctx.agents.get(first.teamId); await lead.whenIdle();
  assert((await host.client.request('health')).api.capabilities.includes('tool-call-observations'));
  const spawned = await host.ctx.dshRoles.spawn(lead, { name: 'worker', role: 'left', prompt: 'Synthetic tool call.', signal: new AbortController().signal });
  await until(() => entered);
  const status = await host.client.request('status', { teamId: first.teamId });
  const row = status.toolActivity.sessions.find(item => item.sessionId === spawned.member.id);
  assert.equal(row.available, true); assert.equal(row.turnOpen, true); assert.equal(row.unsettledCount, 1); assert.equal(row.unchangedAtCheck, true);
  assert.equal(row.unsettled[0].name, 'fixture_read'); assert.equal(row.unsettled[0].callId, 'blocked-call'); assert(row.unsettled[0].callSeq <= row.asOfSeq);
  assert.doesNotMatch(JSON.stringify(status.toolActivity), /SECRET|nonce\.txt|arguments|content|reasoning/);
  await assert.rejects(host.client.request('status', { teamId: spawned.member.id }), { code: 'UNKNOWN_TEAM' });
  gate.resolve(); await until(() => host.ctx.agents.get(spawned.member.id)?.status !== 'running');
  const result = await host.client.request('result', { teamId: first.teamId });
  const ended = result.toolActivity.sessions.find(item => item.sessionId === spawned.member.id);
  assert.equal(ended.observedCalls, 1); assert.equal(ended.observedResults, 1); assert.equal(ended.unsettledCount, 0); assert.equal(ended.lastResult.callId, 'blocked-call');
  await host.ctx.sessions.flush(lead.session); await host.client.close(); await host.dispose();
  host = await mountNativeHost({ root });
  const cold = await host.client.request('status', { teamId: first.teamId });
  const restored = cold.toolActivity.sessions.find(item => item.sessionId === spawned.member.id);
  assert.equal(restored.observedCalls, 1); assert.equal(restored.observedResults, 1); assert.equal(restored.unchangedAtCheck, null);
  assert.deepEqual(restored.lastResult, ended.lastResult); assert.equal(host.ctx.agents.list().length, 0); assert.equal(host.requests.length, 0);
});
