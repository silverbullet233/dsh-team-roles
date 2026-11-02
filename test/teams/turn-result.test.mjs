import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readTurnResult } from '../../src/teams/turn-result.mjs';
import { ManagedTeams } from '../../src/teams/service.mjs';
import { NativeSessionPort } from '../../src/teams/native-port.mjs';

const event = (type, data, seq, extra = {}) => ({ type, seq, time: seq, data, ...extra });
function history(text = 'first') {
  return [event('turn/start', { turn: 1 }, 0),
    event('user/message', { source: { kind: 'user', rpcId: 'input-1' } }, 1),
    event('assistant/message', { message: { content: [{ type: 'text', text }, { type: 'reasoning', text: 'excluded fixture reasoning' }] } }, 2, { surfaceOp: 'append' }),
    event('assistant/message', { message: { content: [{ type: 'text', text: 'replacement' }] } }, 3, { surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 } }),
    event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4),
    event('turn/start', { turn: 2 }, 5)];
}
function reader(events) {
  const calls = [];
  const read = async request => {
    calls.push(request);
    const cut = request.throughSeq ?? events.length - 1;
    if (cut >= events.length) throw new Error('unavailable');
    const high = request.beforeSeq ?? cut + 1, low = Math.max(0, high - 3);
    return { cursor: cut, hasMore: low > 0, records: events.slice(low, high).map(event => ({ type: 'event', event })) };
  };
  return { read, calls };
}

test('T1 remains exactly rereadable while later turns append and references pin native cuts', async () => {
  const events = history(), { read, calls } = reader(events);
  const first = await readTurnResult({ teamId: 'root', turn: 1 }, read);
  assert.equal(first.outcome, 'completed'); assert.deepEqual(first.inputIds, ['input-1']);
  assert.equal(first.startSeq, 0); assert.equal(first.endSeq, 4);
  assert.equal(first.coverage.canonicalConversation, false); assert.equal(first.coverage.goalAccepted, null);
  const lines = first.page.text.trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map(line => line.text), [['first'], ['replacement']]);
  assert.deepEqual(lines[1].surfaceOp, { op: 'replace', startSeq: 2, endSeq: 2 });
  assert.doesNotMatch(first.page.text, /excluded fixture reasoning/);
  events.push(event('turn/end', { turn: 2, reason: { kind: 'error' } }, 6));
  calls.length = 0;
  const again = await readTurnResult({ teamId: 'root', resultRef: first.resultRef }, read);
  assert.deepEqual(again, first); assert(calls.every(call => call.throughSeq === 4));
  assert(calls.every(call => call.address.kind === 'session' && call.address.sessionId === 'root'));
});

test('huge multilingual single messages reconstruct exactly through scalar-safe byte pages', async () => {
  const original = 'x'.repeat(8191) + '🙂中文'.repeat(2000), { read } = reader(history(original));
  let page = await readTurnResult({ teamId: 'root', turn: 1, maxBytes: 997 }, read), combined = '';
  const ref = page.resultRef;
  for (;;) {
    assert(Buffer.byteLength(page.page.text) <= 997); assert.doesNotMatch(page.page.text, /\uFFFD/);
    combined += page.page.text;
    if (page.page.nextOffset === null) break;
    page = await readTurnResult({ teamId: 'root', resultRef: ref, offset: page.page.nextOffset, maxBytes: 997 }, read);
    assert.equal(page.resultRef, ref);
  }
  assert.equal(Buffer.byteLength(combined), page.page.totalBytes);
  assert.equal(createHash('sha256').update(combined).digest('hex'), page.page.sha256);
  assert.equal(JSON.parse(combined.split('\n')[0]).text[0], original);
  const utf8 = Buffer.from(combined), continuation = utf8.findIndex(byte => (byte & 0xc0) === 0x80);
  await assert.rejects(readTurnResult({ teamId: 'root', resultRef: ref, offset: continuation }, read), { code: 'INVALID_OFFSET' });
  await assert.rejects(readTurnResult({ teamId: 'root', resultRef: ref, offset: utf8.length + 1 }, read), { code: 'INVALID_OFFSET' });
});

test('missing/open/error turns and no-text output remain distinct', async () => {
  const events = history();
  await assert.rejects(readTurnResult({ teamId: 'root', turn: 2 }, reader(events).read), { code: 'TURN_NOT_ENDED' });
  await assert.rejects(readTurnResult({ teamId: 'root', turn: 3 }, reader(events).read), { code: 'TURN_NOT_FOUND' });
  events[2].data.message.content = [{ type: 'tool-call', id: 'fixture' }]; events[3].data.message.content = [];
  events[4].data.reason.kind = 'error';
  const result = await readTurnResult({ teamId: 'root', turn: 1 }, reader(events).read);
  assert.equal(result.outcome, 'error'); assert.equal(result.coverage.assistantMessages, 2);
  assert(result.page.text.split('\n').filter(Boolean).every(line => JSON.parse(line).text.length === 0));
});

test('forged/cross-Team references and changed source never return latest', async () => {
  const events = history(), { read } = reader(events);
  const first = await readTurnResult({ teamId: 'root', turn: 1 }, read);
  await assert.rejects(readTurnResult({ teamId: 'other', resultRef: first.resultRef }, read), { code: 'INVALID_RESULT_REF' });
  const ref = JSON.parse(Buffer.from(first.resultRef, 'base64url'));
  ref.sha256 = '0'.repeat(64);
  await assert.rejects(readTurnResult({ teamId: 'root', resultRef: Buffer.from(JSON.stringify(ref)).toString('base64url') }, read), { code: 'RESULT_CHANGED' });
  events[1].data.source.rpcId = 'changed';
  await assert.rejects(readTurnResult({ teamId: 'root', resultRef: first.resultRef }, read), { code: 'RESULT_CHANGED' });
  await assert.rejects(readTurnResult({ teamId: 'root', resultRef: 'invalid' }, read), { code: 'INVALID_RESULT_REF' });
});

test('invalid selectors and page bounds reject before native I/O', async () => {
  let calls = 0; const read = async () => { calls++; };
  for (const params of [{}, { turn: 0 }, { turn: 1, resultRef: 'both' }, { turn: 1, offset: 1 }, { turn: 1, maxBytes: 3 }, { turn: 1, maxBytes: 32769 }]) {
    await assert.rejects(readTurnResult({ teamId: 'root', ...params }, read), { code: 'INVALID_REQUEST' });
  }
  assert.equal(calls, 0);
});

test('history gaps, missing start, oversized fetched pages and native failures are explicit', async () => {
  const { read } = reader(history());
  await assert.rejects(readTurnResult({ teamId: 'root', turn: 1 }, async request => {
    const page = await read(request); page.records[0].event = { ...page.records[0].event, seq: 99 }; return page;
  }), { code: 'HISTORY_INCOMPLETE' });
  await assert.rejects(readTurnResult({ teamId: 'root', turn: 1 }, reader(history('x'.repeat(8 * 1024 * 1024))).read), { code: 'HISTORY_LIMIT' });
  await assert.rejects(readTurnResult({ teamId: 'root', turn: 1 }, async () => { throw new Error('must not disclose fixture secret'); }), error => error.code === 'HISTORY_UNAVAILABLE' && !error.message.includes('secret'));
  const events = history(); events[0] = event('unrelated', {}, 0);
  await assert.rejects(readTurnResult({ teamId: 'root', turn: 1 }, reader(events).read), { code: 'HISTORY_INCOMPLETE' });
});

test('only an owned managed root can reach historical native reads', async () => {
  let reads = 0;
  const service = new ManagedTeams({ allowedRoots: ['/tmp'], store: { get: async (_type, id) => id === 'root' ? { sessionId: 'root' } : undefined }, native: { turnResult: async params => { reads++; return params; } } });
  for (const teamId of ['member', 'unmanaged']) await assert.rejects(service.dispatch('turnResult', { teamId, turn: 1 }), { code: 'UNKNOWN_TEAM' });
  assert.equal(reads, 0);
  assert.equal((await service.dispatch('turnResult', { teamId: 'root', turn: 1 })).teamId, 'root'); assert.equal(reads, 1);
});

test('missing or migration-only cold projections refuse history without Agent activation', async () => {
  for (const baseline of [null, { kind: 'migration-required' }]) {
    const calls = [];
    const ctx = { connection: { createPeer: () => ({}) }, typertGateway: { invoke: async request => { calls.push(request.method); return baseline; } },
      sessionController: { resolveAgent() { assert.fail('must not activate'); } }, sessions: {}, agents: {}, sessionProjections: {}, agentTeams: {} };
    const port = new NativeSessionPort(ctx, {});
    await assert.rejects(port.turnResult({ teamId: 'root', turn: 1 }), { code: baseline === null ? 'SESSION_MISSING' : 'MIGRATION_REQUIRED' });
    assert.deepEqual(calls, ['projections']);
  }
});

test('scan page bounds and a changed native cut never silently truncate results', async () => {
  const events = Array.from({ length: 200 }, (_, seq) => event('unrelated', {}, seq));
  await assert.rejects(readTurnResult({ teamId: 'root', turn: 1 }, reader(events).read), { code: 'HISTORY_LIMIT' });
  const { read } = reader(history()); let calls = 0;
  await assert.rejects(readTurnResult({ teamId: 'root', turn: 1 }, async request => {
    const page = await read(request); if (++calls > 1) page.cursor++; return page;
  }), { code: 'HISTORY_INCOMPLETE' });
});

test('input identity metadata is bounded in UTF-8 bytes, not code units', async () => {
  const events = history(); events[1].data.source.rpcId = '中'.repeat(86);
  await assert.rejects(readTurnResult({ teamId: 'root', turn: 1 }, reader(events).read), { code: 'HISTORY_LIMIT' });
});
