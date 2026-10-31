import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedTeams } from '../../src/teams/service.mjs';
import { TeamStore } from '../../src/teams/private-store.mjs';
import { foldObservation, initialObservation } from '../../src/teams/projection.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-bridge-'));
  const store = await new TeamStore(join(directory, 'metadata')).open();
  const native = {
    sessions: new Map(), calls: [], accepted: new Set(), failFlush: false,
    async projections(id) { return this.sessions.has(id) ? { kind: 'sequenced' } : null; },
    async prepareLead(id, role) { this.calls.push(['role', id, role]); },
    async create(request) {
      this.calls.push(['create', request]);
      this.sessions.set(request.sessionId, { runtimeState: 'idle', needsContinuation: false, taskState: 'idle', observation: initialObservation() });
      return { sessionId: request.sessionId };
    },
    async flush(id) { this.calls.push(['flush', id]); if (this.failFlush) throw new Error('synthetic flush failure'); },
    async snapshot(id) { return structuredClone(this.sessions.get(id)); },
    async prompt(request) { this.calls.push(['prompt', request]); this.accepted.add(request.requestId); },
    async stop(id) { return { teamId: id, accepted: true, filesRolledBack: false }; },
  };
  const bridge = new ManagedTeams({ native, store, allowedRoots: [directory] });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store, bridge, native };
}

test('create persists identity, binds lead, creates native Session and flushes before receipt', async t => {
  const { directory, bridge, native, store } = await fixture(t);
  const result = await bridge.dispatch('create', { key: 'one', cwd: directory, text: 'Synthetic 13', leadRole: 'lead' });
  assert.equal(result.accepted, true);
  assert.equal(result.processed, null);
  assert.equal(result.sessionId, result.teamId);
  assert.deepEqual(native.calls.map(call => call[0]), ['role', 'create', 'flush', 'prompt', 'flush']);
  const metadata = await store.get('team', result.teamId);
  assert.equal(metadata.sessionId, result.teamId);
  assert.equal(JSON.stringify(metadata).includes('Synthetic'), false);
  assert.equal((await store.get('input', [result.teamId, result.inputId])).accepted, true);
});

test('concurrent same-key create and cold retries never create or submit twice', async t => {
  const { directory, bridge, native } = await fixture(t);
  const params = { key: 'concurrent', cwd: directory, text: 'Synthetic 17' };
  const results = await Promise.all([bridge.dispatch('create', params), bridge.dispatch('create', params)]);
  assert.equal(results[0].teamId, results[1].teamId);
  native.sessions.get(results[0].teamId).needsContinuation = true;
  native.sessions.get(results[0].teamId).runtimeState = 'unloaded';
  const cold = await bridge.dispatch('create', params);
  assert.equal(cold.duplicate, true);
  assert.equal(native.calls.filter(call => call[0] === 'create').length, 1);
  assert.equal(native.calls.filter(call => call[0] === 'prompt').length, 1);
});

test('same create key or input id with different content rejects before native mutation', async t => {
  const { directory, bridge, native } = await fixture(t);
  const params = { key: 'conflict', cwd: directory, text: 'Synthetic 19' };
  const result = await bridge.dispatch('create', params);
  const count = native.calls.length;
  await assert.rejects(bridge.dispatch('create', { ...params, text: 'Changed' }), { code: 'CONTENT_CONFLICT' });
  await assert.rejects(bridge.dispatch('send', { teamId: result.teamId, inputId: result.inputId, text: 'Changed' }), { code: 'CONTENT_CONFLICT' });
  assert.equal(native.calls.length, count);
});

test('followup keeps one Session and requires explicit continuation from unloaded state', async t => {
  const { directory, bridge, native } = await fixture(t);
  const result = await bridge.dispatch('create', { key: 'recover', cwd: directory, text: 'Synthetic 23' });
  native.sessions.get(result.teamId).needsContinuation = true;
  const send = { teamId: result.teamId, inputId: 'followup-1', text: 'Synthetic 29' };
  await assert.rejects(bridge.dispatch('send', send), { code: 'CONTINUATION_REQUIRED' });
  await bridge.dispatch('send', { ...send, continue: true });
  assert.equal(native.calls.filter(call => call[0] === 'create').length, 1);
  assert.equal(native.calls.filter(call => call[0] === 'prompt').at(-1)[1].sessionId, result.teamId);
});

test('create recovery returns reserved IDs before explicit initial admission after a crash', async t => {
  const { directory, bridge, native, store } = await fixture(t);
  const params = { key: 'first-admission-crash', cwd: directory, text: 'Synthetic 47' };
  const snapshot = native.snapshot;
  native.snapshot = async () => { throw new Error('synthetic crash before initial admission'); };
  await assert.rejects(bridge.dispatch('create', params), /synthetic crash/);
  const reserved = await store.get('key', params.key);
  assert.equal(reserved.stage, 'created');
  assert.equal(await store.get('input', [reserved.sessionId, reserved.inputId]), undefined);
  native.snapshot = snapshot;
  native.sessions.get(reserved.sessionId).needsContinuation = true;
  native.sessions.get(reserved.sessionId).runtimeState = 'unloaded';
  const recovery = await bridge.dispatch('create', params);
  assert.equal(recovery.teamId, reserved.sessionId);
  assert.equal(recovery.sessionId, reserved.sessionId);
  assert.equal(recovery.inputId, reserved.inputId);
  assert.equal(recovery.accepted, false);
  assert.equal(recovery.requiresContinuation, true);
  assert.equal(native.calls.filter(call => call[0] === 'prompt').length, 0);
  await bridge.dispatch('send', { teamId: recovery.teamId, inputId: recovery.inputId, text: params.text, continue: true });
  const retry = await bridge.dispatch('create', params);
  assert.equal(retry.accepted, true);
  assert.equal(retry.duplicate, true);
  assert.equal(native.calls.filter(call => call[0] === 'create').length, 1);
  assert.equal(native.calls.filter(call => call[0] === 'prompt').length, 1);
});

test('create recovery leaves acceptance unknown after an initial prompt with an unconfirmed receipt', async t => {
  const { directory, bridge, native, store } = await fixture(t);
  const params = { key: 'uncertain-initial', cwd: directory, text: 'Synthetic 53' };
  const flush = native.flush;
  native.flush = async function (id) {
    await flush.call(this, id);
    if (this.calls.some(call => call[0] === 'prompt')) throw new Error('synthetic crash after initial prompt');
  };
  await assert.rejects(bridge.dispatch('create', params), /synthetic crash/);
  const reserved = await store.get('key', params.key);
  assert.equal((await store.get('input', [reserved.sessionId, reserved.inputId])).accepted, false);
  assert.equal(native.accepted.has(reserved.inputId), true);
  native.flush = flush;
  native.sessions.get(reserved.sessionId).needsContinuation = true;
  const recovery = await bridge.dispatch('create', params);
  assert.equal(recovery.teamId, reserved.sessionId);
  assert.equal(recovery.inputId, reserved.inputId);
  assert.equal(recovery.accepted, null);
  assert.equal(recovery.requiresContinuation, true);
  assert.equal(native.calls.filter(call => call[0] === 'prompt').length, 1);
});

test('uncertain flush records no false acceptance and retry uses the same native request id', async t => {
  const { directory, bridge, native, store } = await fixture(t);
  const result = await bridge.dispatch('create', { key: 'flush', cwd: directory, text: 'Synthetic 31' });
  native.failFlush = true;
  const send = { teamId: result.teamId, inputId: 'durability', text: 'Synthetic 37' };
  await assert.rejects(bridge.dispatch('send', send), /synthetic flush failure/);
  assert.equal((await store.get('input', [result.teamId, 'durability'])).accepted, false);
  native.failFlush = false;
  await bridge.dispatch('send', send);
  assert.equal(native.accepted.size, 2);
  assert.deepEqual(native.calls.filter(call => call[0] === 'prompt').slice(-2).map(call => call[1].requestId), ['durability', 'durability']);
});

test('workspace escape, unknown fields, non-text and arbitrary workspace id fail closed', async t => {
  const { directory, bridge, native } = await fixture(t);
  const params = { key: 'safe', cwd: directory, text: 'Synthetic 41' };
  await assert.rejects(bridge.dispatch('create', { ...params, cwd: tmpdir() }), { code: 'WORKSPACE_DENIED' });
  await assert.rejects(bridge.dispatch('create', { ...params, endpoint: 'https://invalid.test' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(bridge.dispatch('create', { ...params, text: [{ type: 'image' }] }), { code: 'INVALID_REQUEST' });
  native.workspacePath = () => tmpdir();
  await assert.rejects(bridge.dispatch('create', { ...params, workspaceId: 'foreign' }), { code: 'WORKSPACE_DENIED' });
  assert.equal(native.calls.length, 0);
});

test('private store excludes second writer and reloads durable receipts after close', async t => {
  const { store } = await fixture(t);
  await store.set('test', 'receipt', { accepted: true });
  const other = new TeamStore(store.directory);
  await assert.rejects(other.open(), { code: 'WRITER_HELD' });
  await store.close();
  await other.open();
  assert.equal((await other.get('test', 'receipt')).accepted, true);
  await other.close();
});

test('private store refuses symlinked metadata and permissive directories', async t => {
  const { directory, store } = await fixture(t);
  await store.set('test', 'actual', { accepted: true });
  await symlink(store.path('test', 'actual'), store.path('test', 'link'));
  await assert.rejects(store.get('test', 'link'), { code: 'ELOOP' });
  await chmod(directory, 0o755);
  await assert.rejects(new TeamStore(directory).open(), { code: 'UNSAFE_DIRECTORY' });
});

test('admission closes and drains before metadata resources are released', async t => {
  const { directory, bridge, native } = await fixture(t);
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  native.prompt = async () => gate;
  const admitted = bridge.dispatch('create', { key: 'drain', cwd: directory, text: 'Synthetic draining work.' });
  while (!bridge.pending.size) await new Promise(resolve => setImmediate(resolve));
  let closed = false;
  const closing = bridge.close().then(() => { closed = true; });
  await assert.rejects(bridge.dispatch('health'), { code: 'SERVICE_CLOSING' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  finish(); await admitted; await closing;
  assert.equal(closed, true);
});

test('projection distinguishes admission, entered processing, terminal outcome and output', () => {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { source: { kind: 'user', rpcId: 'nonce' } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '43' }, { type: 'reasoning', text: 'hidden' }] } } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  let state = initialObservation();
  for (const [seq, event] of events.entries()) {
    state = foldObservation(state, { ...event, seq, time: seq });
    if (seq === 1) assert.equal(state.inputs[0].processed, false);
  }
  assert.equal(state.inputs[0].processed, true);
  assert.equal(state.inputs[0].outcome, 'completed');
  assert.equal(state.output, '43');
  assert.equal(state.open, false);
});
