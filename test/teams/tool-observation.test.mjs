import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SessionStore, { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import { z } from 'zod';
import { initialTools, foldTools, toolReceiptView, toolObservationProjection, TOOL_CALL_LIMIT } from '../../src/teams/tool-observation.mjs';
const event = (type, data, seq) => ({ type, data, seq, time: seq });
const call = (id, seq, extra = {}) => event('tool/call', { turn: 1, step: 1, callId: id, name: 'fixture_read', arguments: 'SECRET_ARGUMENT', ...extra }, seq);
const result = (id, seq, extra = {}) => event('tool/result', { turn: 1, step: 1, message: { toolCallId: id, isError: false, content: [{ type: 'text', text: 'SECRET_RESULT' }] }, ...extra }, seq);
const start = () => foldTools(initialTools(), event('turn/start', { turn: 1 }, 0));

test('tool receipts distinguish requested from result-observed without retaining payloads or stale turns', () => {
  let state = foldTools(start(), call('a', 1));
  assert.equal(toolReceiptView(state).unsettledCount, 1); assert.equal(state.open, true);
  state = foldTools(state, result('a', 2, { turn: 2 }));
  assert.equal(state.unsettled.length, 1);
  state = foldTools(state, result('a', 3));
  assert.equal(state.unsettled.length, 0); assert.equal(state.observedCalls, 1); assert.equal(state.observedResults, 1);
  assert.deepEqual(state.lastResult, { callId: 'a', name: 'fixture_read', step: 1, callSeq: 1, resultSeq: 3, isError: false });
  state = foldTools(state, call('b', 4)); state = foldTools(state, event('turn/end', { turn: 1 }, 5));
  assert.equal(toolReceiptView(state).turnOpen, false); assert.equal(toolReceiptView(state).unsettledCount, 1);
  assert.doesNotMatch(JSON.stringify(state), /SECRET|arguments|content|reasoning/);
  state = foldTools(state, event('turn/start', { turn: 2 }, 6));
  assert.deepEqual(state, { ...initialTools(), turn: 2, open: true });
});

test('overflow, duplicate, unmatched and invalid identities leave correlation unknown, never a false zero', () => {
  let state = start();
  for (let i = 0; i < TOOL_CALL_LIMIT + 3; i++) state = foldTools(state, call(`c${i}`, i + 1));
  assert.equal(state.unsettled.length, TOOL_CALL_LIMIT); assert.equal(state.omittedCallEvents, 3);
  assert.equal(toolReceiptView(state).unsettledCount, null); assert.equal(toolReceiptView(state).omittedSamples, TOOL_CALL_LIMIT - 4);
  for (let i = 0; i < TOOL_CALL_LIMIT; i++) state = foldTools(state, result(`c${i}`, 50 + i));
  assert.equal(state.unsettled.length, 0); assert.equal(toolReceiptView(state).unsettledCount, null);
  for (const events of [[call('same', 1), call('same', 2)], [result('missing', 1)], [call('🙂'.repeat(100), 1)], [call('\ud800', 1)]]) {
    const bad = events.reduce(foldTools, start());
    assert.equal(toolReceiptView(bad).unsettledCount, null);
  }
  assert.deepEqual(toolReceiptView(undefined), { available: false, reason: 'PROJECTION_UNAVAILABLE' });
});

test('new public native projection refolds old checkpoints without changing existing projection versions', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
    await ctx.sessionProjections.register(toolObservationProjection(z));
    const old = { dshToolReceipts: { ver: 1, seq: 1, val: { ...start(), observedCalls: 900 } } };
    assert.deepEqual(ctx.sessionProjections.viewCheckpoint(old), {});
    assert.equal(ctx.sessionProjections.restoreFloor(old), 0);
    const events = [event('turn/start', { turn: 1 }, 0), call('restored', 1)];
    const restored = ctx.sessionProjections.restore(old, events, 0, { version: SESSION_FORMAT_VERSION, id: 'fixture-tool-cache', createdAt: 0, isSeeded: false }, 0);
    assert.equal(restored.snapshot.values.dshToolReceipts.unsettled[0].callId, 'restored');
    assert.equal(restored.checkpoint.dshToolReceipts.ver, 2);
  } finally { await ctx.fiber.dispose(); }
});

test('fork-inherited tool calls do not become child receipts while ordinary restore keeps own evidence', () => {
  let state = [event('turn/start', { turn: 1 }, 0), call('parent', 1), result('parent', 2)].reduce(foldTools, initialTools());
  assert.equal(state.observedCalls, 1);
  assert.deepEqual(foldTools(state, event('session/end-seed', {}, 3)), state);
  state = foldTools(state, event('session/end-seed', { inherited: true }, 3));
  assert.deepEqual(state, initialTools());
  state = foldTools(state, event('turn/start', { turn: 2 }, 4));
  state = foldTools(state, call('child', 5, { turn: 2 }));
  assert.equal(state.observedCalls, 1); assert.equal(state.unsettled[0].callId, 'child');
});
