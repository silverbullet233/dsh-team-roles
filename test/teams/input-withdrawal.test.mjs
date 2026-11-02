import test from 'node:test';
import assert from 'node:assert/strict';
import { ManagedTeams } from '../../src/teams/service.mjs';
import { NativeSessionPort } from '../../src/teams/native-port.mjs';
import { digest } from '../../src/teams/private-store.mjs';

const request = { teamId: 'root', inputId: 'input-1', expectedMessageId: 'message-1' };
function fixture({ placement = 'nextTurn', mode = 'queue' } = {}) {
  const messages = [{ id: 'message-1', source: { kind: 'user', rpcId: 'input-1' }, content: [{ type: 'text', text: 'Synthetic pending task.' }] }];
  const calls = [], session = { header: { id: 'root' }, seq: 10 };
  const agent = { id: 'root', session, inbox: { nextTurn: placement === 'nextTurn' ? messages : [], nextStep: placement === 'nextStep' ? messages : [], remove(id) {
    calls.push(['remove', id]); const index = messages.findIndex(message => message.id === id); if (index < 0) return false;
    messages.splice(index, 1); session.seq++; return true;
  } } };
  const ctx = { connection: { createPeer: () => ({}) }, agents: { get: () => agent }, sessions: { get: () => session, async flush(value) { calls.push(['flush', value]); } },
    sessionController: { resolveAgent() { assert.fail('must never resume'); } }, typertGateway: {}, sessionProjections: {}, agentTeams: {} };
  const native = new NativeSessionPort(ctx, {});
  const saved = new Map([['input-1', { teamId: 'root', inputId: 'input-1', digest: digest({ prompt: messages[0].content[0].text, mode }), accepted: true }]]);
  const store = { get: async (kind, key) => structuredClone(kind === 'team' ? key === 'root' ? { sessionId: 'root', cwd: '/tmp' } : undefined : saved.get(key[1])),
    async set(_kind, key, value) { saved.set(key[1], structuredClone(value)); } };
  const service = new ManagedTeams({ native, store, allowedRoots: ['/tmp'] });
  return { service, native, ctx, agent, session, messages, saved, store, calls };
}

test('only the exact live queued or steer message is removed and flushed before acknowledgement', async () => {
  for (const [placement, mode] of [['nextTurn', 'queue'], ['nextStep', 'steer'], ['nextTurn', 'steer']]) {
    const f = fixture({ placement, mode });
    const result = await f.service.dispatch('withdrawInput', request);
    assert.equal(result.state, 'withdrawn'); assert.equal(result.asOfSeq, 10); assert.equal(result.filesRolledBack, false);
    assert.equal(f.messages.length, 0); assert.deepEqual(f.calls.map(call => call[0]), ['remove', 'flush']);
    assert.equal(f.calls[1][1], f.session); assert.equal(f.saved.get('input-1').withdrawal.state, 'withdrawn');
    assert.equal((await f.service.dispatch('withdrawInput', request)).duplicate, true);
    assert.equal(f.calls.length, 2);
    await assert.rejects(f.service.dispatch('withdrawInput', { ...request, expectedMessageId: 'different' }), { code: 'CONTENT_CONFLICT' });
  }
});

test('foreign roots, unknown intents, changed text, stale IDs and duplicates fail before intent/mutation', async () => {
  const f = fixture();
  await assert.rejects(f.service.dispatch('withdrawInput', { ...request, teamId: 'member' }), { code: 'UNKNOWN_TEAM' });
  await assert.rejects(f.service.dispatch('withdrawInput', { ...request, inputId: 'unknown' }), { code: 'UNKNOWN_INPUT' });
  await assert.rejects(f.service.dispatch('withdrawInput', { ...request, expectedMessageId: 'stale' }), { code: 'INPUT_NOT_PENDING' });
  f.messages[0].content[0].text = 'Changed pending task.';
  await assert.rejects(f.service.dispatch('withdrawInput', request), { code: 'INPUT_CONTENT_CHANGED' });
  f.messages.push({ ...f.messages[0], source: { kind: 'user', rpcId: 'another-input' } });
  await assert.rejects(f.service.dispatch('withdrawInput', request), { code: 'INPUT_NOT_PENDING' });
  assert.equal(f.saved.get('input-1').withdrawal, undefined); assert.deepEqual(f.calls, []);
});

test('cold/replaced/member runtimes and already claimed messages are never activated or treated as withdrawn', async () => {
  for (const change of [f => { f.ctx.agents.get = () => undefined; }, f => { f.ctx.sessions.get = () => ({}); }, f => { f.session.header.parentSession = 'parent'; }, f => { f.messages.length = 0; }]) {
    const f = fixture(); change(f);
    await assert.rejects(f.service.dispatch('withdrawInput', request), error => ['LIVE_INPUT_REQUIRED', 'INPUT_NOT_PENDING'].includes(error.code));
    assert.equal(f.saved.get('input-1').withdrawal, undefined); assert.deepEqual(f.calls, []);
  }
});

test('claim during intent persistence is rechecked, preserves uncertainty and prevents resubmission', async () => {
  const f = fixture(), set = f.store.set;
  f.store.set = async (...args) => { await set(...args); f.messages.length = 0; };
  await assert.rejects(f.service.dispatch('withdrawInput', request), { code: 'WITHDRAWAL_UNCERTAIN' });
  assert.equal(f.saved.get('input-1').withdrawal.state, 'unconfirmed'); assert.deepEqual(f.calls, []);
  f.service.workspace = async () => '/tmp';
  await assert.rejects(f.service.dispatch('send', { teamId: 'root', inputId: 'input-1', text: 'Synthetic pending task.' }), { code: 'WITHDRAWAL_UNCERTAIN' });
});

test('flush or receipt failure cannot produce a false acknowledgement or inferred successful retry', async () => {
  for (const failure of ['flush', 'receipt']) {
    const f = fixture();
    if (failure === 'flush') f.ctx.sessions.flush = async () => { throw new Error('excluded fixture failure'); };
    else { const set = f.store.set; f.store.set = async (...args) => { if (args[2].withdrawal.state === 'withdrawn') throw new Error('excluded fixture failure'); await set(...args); }; }
    await assert.rejects(f.service.dispatch('withdrawInput', request), error => error.code === 'WITHDRAWAL_UNCERTAIN' && !error.message.includes('excluded'));
    assert.equal(f.messages.length, 0); assert.equal(f.saved.get('input-1').withdrawal.state, 'unconfirmed');
    await assert.rejects(f.service.dispatch('withdrawInput', request), { code: 'WITHDRAWAL_UNCERTAIN' });
    assert.equal(f.calls.filter(call => call[0] === 'remove').length, 1);
  }
});

test('uncertain intent can be explicitly retried only for the same still-pending identity', async () => {
  const f = fixture(); f.saved.get('input-1').withdrawal = { messageId: 'message-1', state: 'unconfirmed' };
  assert.equal((await f.service.dispatch('withdrawInput', request)).state, 'withdrawn');
  f.service.workspace = async () => '/tmp';
  await assert.rejects(f.service.dispatch('send', { teamId: 'root', inputId: 'input-1', text: 'Synthetic pending task.' }), { code: 'INPUT_WITHDRAWN' });
});

test('concurrent identical withdrawals serialize to one native removal', async () => {
  const f = fixture();
  const replies = await Promise.all([f.service.dispatch('withdrawInput', request), f.service.dispatch('withdrawInput', request)]);
  assert.deepEqual(replies.map(reply => reply.duplicate), [false, true]);
  assert.equal(f.calls.filter(call => call[0] === 'remove').length, 1);
});

test('runtime replacement during persistence and a failed intent write cannot mutate an unchecked Agent', async () => {
  for (const failure of ['replacement', 'write', 'paired-replacement', 'same-agent-new-session']) {
    const f = fixture(), set = f.store.set;
    f.store.set = async (...args) => {
      if (failure === 'write') throw new Error('excluded fixture failure');
      await set(...args);
      if (failure === 'replacement') f.ctx.sessions.get = () => ({});
      else {
        const session = { header: { id: 'root' }, seq: f.session.seq };
        const agent = failure === 'same-agent-new-session' ? f.agent : { ...f.agent, inbox: { nextTurn: structuredClone(f.messages), nextStep: [], remove(id) { f.calls.push(['replacement-remove', id]); return true; } } };
        agent.session = session;
        f.ctx.sessions.get = () => session; f.ctx.agents.get = () => agent;
      }
    };
    await assert.rejects(f.service.dispatch('withdrawInput', request), { code: 'WITHDRAWAL_UNCERTAIN' });
    assert.equal(f.messages.length, 1); assert.deepEqual(f.calls, []);
  }
});
