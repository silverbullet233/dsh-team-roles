import test from 'node:test';
import assert from 'node:assert/strict';
import { observeInput } from '../../src/teams/input-observation.mjs';
import { INPUT_LIMIT } from '../../src/teams/projection.mjs';
import { ManagedTeams } from '../../src/teams/service.mjs';
import { NativeSessionPort } from '../../src/teams/native-port.mjs';

const queued = (id = 'message-1', inputId = 'input-1') => ({ id, source: { kind: 'user', rpcId: inputId }, content: [{ type: 'text', text: 'excluded fixture content' }] });
const projection = (nextTurn = [], nextStep = [], inputs = []) => ({ kind: 'sequenced', asOfSeq: 42, values: { inbox: { 'next-turn': nextTurn, 'next-step': nextStep }, dshBridge: { inputs } } });
const entry = (processed = false, outcome = null) => ({ id: 'input-1', turn: 3, seq: 40, processed, outcome });

test('pending native message IDs and placements are exact, bounded and content-free', () => {
  for (const placement of ['next-turn', 'next-step']) {
    const result = observeInput(projection(placement === 'next-turn' ? [queued()] : [], placement === 'next-step' ? [queued()] : []), 'input-1');
    assert.equal(result.phase, 'pending'); assert.equal(result.asOfSeq, 42);
    assert.deepEqual(result.pending, { count: 1, items: [{ messageId: 'message-1', placement }], truncated: false });
    assert.equal(result.entered, null); assert.doesNotMatch(JSON.stringify(result), /excluded fixture content/);
  }
  const ambiguous = observeInput(projection([queued('one'), queued('two')], [queued('three')]), 'input-1');
  assert.equal(ambiguous.phase, 'ambiguous'); assert.equal(ambiguous.pending.count, 3);
  assert.equal(ambiguous.pending.items.length, 2); assert.equal(ambiguous.pending.truncated, true);
});

test('entered and ended turns retain native outcomes without claiming implementation', () => {
  const running = observeInput(projection([], [], [entry()]), 'input-1');
  assert.equal(running.phase, 'entered-turn');
  assert.deepEqual(running.entered, { turn: 3, seq: 40, outcome: null, turnEnded: false });
  for (const outcome of ['completed', 'error', 'aborted']) {
    const ended = observeInput(projection([], [], [entry(true, outcome)]), 'input-1');
    assert.equal(ended.phase, 'turn-ended'); assert.equal(ended.entered.outcome, outcome);
    assert.equal(ended.entered.turnEnded, true);
  }
  assert.equal(observeInput(projection([queued()], [], [entry()]), 'input-1').phase, 'ambiguous');
});

test('absence, bounded retention and unavailable projections never assert withdrawal or rejection', () => {
  const result = observeInput(projection([queued('other', 'another-input')], [], Array.from({ length: INPUT_LIMIT }, (_, id) => ({ ...entry(true, 'completed'), id: String(id) }))), 'input-1');
  assert.equal(result.phase, 'not-observed');
  assert.deepEqual(result.coverage, { source: 'native-projections', retainedInputEntries: INPUT_LIMIT, inputRetentionLimit: INPUT_LIMIT, absenceIsConclusive: false });
  for (const [value, reason] of [[null, 'SESSION_MISSING'], [{ kind: 'migration-required' }, 'MIGRATION_REQUIRED'], [projection(undefined), 'PROJECTION_MISSING']]) {
    if (value?.values) delete value.values.inbox;
    const unavailable = observeInput(value, 'input-1');
    assert.equal(unavailable.phase, 'unavailable'); assert.equal(unavailable.reason, reason);
    assert.equal(unavailable.coverage.absenceIsConclusive, false);
  }
  for (const id of ['', '中'.repeat(86)]) assert.equal(observeInput(projection([queued(id)]), 'input-1').reason, 'INVALID_MESSAGE_ID');
});

test('known admission receipts and managed-root scope are required before native observation', async () => {
  let reads = 0;
  const receipts = new Map([['input-1', { accepted: true }], ['uncertain', { accepted: false }]]);
  const service = new ManagedTeams({ allowedRoots: ['/tmp'], store: { get: async (type, id) => type === 'team' ? id === 'root' ? { sessionId: 'root' } : undefined : receipts.get(id[1]) }, native: { inputState: async (_teamId, inputId) => { reads++; return observeInput(projection(), inputId); } } });
  for (const teamId of ['member', 'unmanaged']) await assert.rejects(service.dispatch('input', { teamId, inputId: 'input-1' }), { code: 'UNKNOWN_TEAM' });
  await assert.rejects(service.dispatch('input', { teamId: 'root', inputId: 'unknown' }), { code: 'UNKNOWN_INPUT' });
  for (const params of [{ teamId: 'root', inputId: '' }, { teamId: 'root', inputId: '中'.repeat(86) }, { teamId: 'root', inputId: 'input-1', memberId: 'bypass' }]) await assert.rejects(service.dispatch('input', params), { code: 'INVALID_REQUEST' });
  assert.equal(reads, 0);
  for (const [inputId, state] of [['input-1', 'acknowledged'], ['uncertain', 'unconfirmed']]) {
    const result = await service.dispatch('input', { teamId: 'root', inputId });
    assert.deepEqual(result.admission, { state }); assert.equal(result.native.phase, 'not-observed'); assert.equal(result.goalAccepted, null);
  }
  assert.equal(reads, 2);
});

test('cold input queries use only public projection reads and sanitize native failures', async () => {
  const calls = [];
  let fail = false;
  const ctx = { connection: { createPeer: () => ({}) }, typertGateway: { invoke: async request => { calls.push(request.method); if (fail) throw new Error('excluded fixture secret'); return projection([queued()]); } },
    sessionController: { resolveAgent() { assert.fail('must not activate'); } }, sessions: {}, agents: {}, sessionProjections: {}, agentTeams: {} };
  const port = new NativeSessionPort(ctx, {});
  assert.equal((await port.inputState('root', 'input-1')).phase, 'pending');
  fail = true;
  const result = await port.inputState('root', 'input-1');
  assert.equal(result.reason, 'NATIVE_READ_FAILED'); assert.doesNotMatch(JSON.stringify(result), /secret/);
  assert.deepEqual(calls, ['projections', 'projections']);
});
