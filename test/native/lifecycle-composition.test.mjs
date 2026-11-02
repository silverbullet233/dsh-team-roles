import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebServer from '@deepseek-ai/dsh-host-webserver';
import { NativeClient } from '../fixtures/client.mjs';
import { mountNativeHost, textChunks, until } from '../fixtures/native-harness.mjs';

test('historical result, withdrawal, live stop inbox, API reconnect and explicit continuation compose', { timeout: 20000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-composition-'));
  const t1Text = 'T1:' + '中文🙂'.repeat(2200);
  let finish = false;
  let host = await mountNativeHost({ root, respond: () => host.requests.length === 1 ? textChunks(t1Text) : finish ? textChunks('SYNTHETIC_RESUMED') : 'hang' });
  let external;
  t.after(async () => { await external?.close(); await host.client.close(); await host.dispose(); await rm(root, { recursive: true, force: true }); });
  await host.ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 });
  // The launch capability remains in memory and never reaches output or logs.
  const entry = host.ctx.connection.authenticatedUrl(host.ctx.webServer.getOrigin());
  external = new NativeClient({ url: entry });
  const created = await external.request('create', { key: 'composition', cwd: host.fixtureRoot, text: 'Synthetic T1.' });
  const lead = host.ctx.agents.get(created.teamId); await lead.whenIdle();
  const original = await external.request('turnResult', { teamId: created.teamId, turn: 1, maxBytes: 100 });
  assert.equal(original.outcome, 'completed'); assert(original.page.totalBytes > 8192);
  await external.request('send', { teamId: created.teamId, inputId: 't2-active', text: 'Synthetic active T2.' });
  await until(() => host.requests.length === 2);
  const stale = { teamId: created.teamId, inputId: 'withdraw-this', text: 'SYNTHETIC_WITHDRAWN_MUST_NOT_RUN' };
  const retained = { teamId: created.teamId, inputId: 'retain-this', text: 'SYNTHETIC_RETAINED_FOR_EXPLICIT_CONTINUATION' };
  await external.request('send', stale); await external.request('send', retained);
  const queued = await external.request('input', { teamId: created.teamId, inputId: stale.inputId });
  assert.equal(queued.native.phase, 'pending');
  await external.request('withdrawInput', { teamId: created.teamId, inputId: stale.inputId, expectedMessageId: queued.native.pending.items[0].messageId });
  const stopped = await external.request('stop', { teamId: created.teamId });
  assert.equal(stopped.accepted, true); assert.equal(stopped.quiescent, false); assert.equal(stopped.pendingInputsRetained, true);
  assert.equal(stopped.execution.admissionBarrier, false); await lead.whenIdle();
  assert.equal(host.requests.length, 2);
  const afterStop = await external.request('input', { teamId: created.teamId, inputId: retained.inputId });
  assert.equal(afterStop.native.phase, 'pending');
  const messageId = afterStop.native.pending.items[0].messageId;
  await external.close(); external = new NativeClient({ url: entry });
  assert.deepEqual(await external.request('turnResult', { teamId: created.teamId, resultRef: original.resultRef, maxBytes: 100 }), original);
  assert.equal((await external.request('input', { teamId: created.teamId, inputId: 't2-active' })).native.entered.outcome, 'aborted');
  assert.equal(host.requests.length, 2);
  const read = (method, params) => external.request(method, params);
  assert.equal((await read('input', { teamId: created.teamId, inputId: retained.inputId })).native.pending.items[0].messageId, messageId);
  // Stop's live-inbox guarantee is not a record-preserving host-restart protocol.
  assert.equal((await read('prepareShutdown')).safeToStop, false);
  const continuation = { teamId: created.teamId, inputId: 'explicit-continuation', text: 'Synthetic explicit keep-and-continue decision.' };
  await assert.rejects(read('send', continuation), { code: 'CONTINUATION_REQUIRED' });
  assert.equal(host.requests.length, 2);
  finish = true;
  await read('send', { ...continuation, continue: true });
  await until(async () => {
    const states = await Promise.all([retained.inputId, continuation.inputId].map(inputId => read('input', { teamId: created.teamId, inputId })));
    return states.every(state => state.native.phase === 'turn-ended');
  });
  await lead.whenIdle();
  // Native admission may put the retained/new inputs in one or two turns.
  // Exact-once entered input identity is stronger than guessing that grouping.
  assert(host.requests.length >= 3 && host.requests.length <= 4);
  const entered = lead.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.kind === 'user').map(event => event.data.source.rpcId);
  for (const inputId of [created.inputId, 't2-active', retained.inputId, continuation.inputId]) assert.equal(entered.filter(id => id === inputId).length, 1);
  assert.equal(entered.includes(stale.inputId), false);
  for (const request of host.requests.slice(2)) assert.doesNotMatch(JSON.stringify(request.messages), /SYNTHETIC_WITHDRAWN_MUST_NOT_RUN/);
  assert.match(JSON.stringify(host.requests.at(-1).messages), /SYNTHETIC_RETAINED_FOR_EXPLICIT_CONTINUATION/);
  assert.equal((await read('input', { teamId: created.teamId, inputId: retained.inputId })).native.phase, 'turn-ended');
  assert.equal((await read('input', { teamId: created.teamId, inputId: stale.inputId })).withdrawal.state, 'withdrawn');
  await assert.rejects(read('send', stale), { code: 'INPUT_WITHDRAWN' });
  assert.deepEqual(await read('turnResult', { teamId: created.teamId, resultRef: original.resultRef, maxBytes: 100 }), original);
  assert.equal((await read('result', { teamId: created.teamId })).execution.goalAccepted, null);
  assert.equal((await read('prepareShutdown')).safeToStop, true);
  await host.ctx.sessions.flush(lead.session); await external.close(); external = undefined; await host.client.close(); await host.dispose();
  host = await mountNativeHost({ root });
  assert.deepEqual(await host.client.request('turnResult', { teamId: created.teamId, resultRef: original.resultRef, maxBytes: 100 }), original);
  assert.equal((await host.client.request('input', { teamId: created.teamId, inputId: retained.inputId })).native.phase, 'turn-ended');
  assert.equal(host.ctx.agents.list().length, 0); assert.equal(host.requests.length, 0);
});

test('structural native teardown is not a supported retained-input restart and absence stays inconclusive', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-structural-teardown-'));
  let host = await mountNativeHost({ root, respond: () => 'hang' });
  t.after(async () => { await host.client.close(); await host.dispose(); await rm(root, { recursive: true, force: true }); });
  const created = await host.client.request('create', { key: 'teardown-boundary', cwd: host.fixtureRoot, text: 'Synthetic active turn.' });
  await until(() => host.requests.length === 1);
  await host.client.request('send', { teamId: created.teamId, inputId: 'retained', text: 'Synthetic pending input.' });
  await host.client.request('stop', { teamId: created.teamId });
  assert.equal((await host.client.request('input', { teamId: created.teamId, inputId: 'retained' })).native.phase, 'pending');
  assert.equal((await host.client.request('prepareShutdown')).safeToStop, false);
  // Deliberate isolated structural owner teardown to characterize the pinned
  // native boundary, never the plugin's supported shutdown path or live data.
  await host.client.close(); await host.dispose(); host = await mountNativeHost({ root });
  const evidence = await host.client.request('input', { teamId: created.teamId, inputId: 'retained' });
  assert.equal(evidence.admission.state, 'acknowledged'); assert.equal(evidence.native.phase, 'not-observed');
  assert.equal(evidence.native.coverage.absenceIsConclusive, false); assert.equal(evidence.withdrawal, null); assert.equal(evidence.goalAccepted, null);
  await assert.rejects(host.client.request('send', { teamId: created.teamId, inputId: 'new-continuation', text: 'Synthetic new input.' }), { code: 'CONTINUATION_REQUIRED' });
  assert.equal(host.requests.length, 0); assert.equal(host.ctx.agents.list().length, 0);
});
