import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SessionStore, { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import { z } from 'zod';
import { initialObservation, foldObservation, teamObservationProjection } from '../../src/teams/projection.mjs';

const event = (type, data, seq) => ({ type, data, seq, time: seq });
const assistant = text => ({ message: { content: text === null ? [{ type: 'tool-call', id: 'fixture' }] : [{ type: 'text', text }] } });

test('text, tool-only activity, started and ended turns have separate source identities', () => {
  let state = initialObservation();
  for (const e of [event('turn/start', { turn: 1 }, 0), event('assistant/message', assistant('T1'), 1), event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2)]) state = foldObservation(state, e);
  state = foldObservation(state, event('turn/start', { turn: 2 }, 3));
  assert.equal(state.output, ''); assert.equal(state.outputSource, null); assert.equal(state.latestAssistant, null);
  assert.equal(state.turnStartSeq, 3); assert.deepEqual(state.lastCompletedTurn, { turn: 1, endSeq: 2 });
  state = foldObservation(state, event('assistant/message', assistant(null), 4));
  assert.equal(state.output, ''); assert.deepEqual(state.latestAssistant, { turn: 2, seq: 4, hasText: false });
  state = foldObservation(state, event('assistant/message', assistant('T2 interim'), 5));
  state = foldObservation(state, event('assistant/message', assistant(null), 6));
  assert.equal(state.output, 'T2 interim');
  assert.deepEqual(state.outputSource, { turn: 2, seq: 5, truncated: false });
  assert.deepEqual(state.latestAssistant, { turn: 2, seq: 6, hasText: false });
  state = foldObservation(state, event('turn/end', { turn: 2, reason: { kind: 'error' } }, 7));
  assert.deepEqual(state.lastEnd, { turn: 2, reason: 'error', seq: 7 });
  assert.deepEqual(state.lastCompletedTurn, { turn: 1, endSeq: 2 });
});

test('preview truncation is explicit and never cuts a valid surrogate pair', () => {
  let state = foldObservation(initialObservation(), event('turn/start', { turn: 1 }, 0));
  state = foldObservation(state, event('assistant/message', assistant('x'.repeat(8191) + '🙂tail'), 1));
  assert.equal(state.output, 'x'.repeat(8191)); assert.equal(state.outputSource.truncated, true);
  assert.equal(state.output.isWellFormed(), true);
});

test('public native cache versioning discards V1 bodies and refolds V2 from full events', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry);
    await ctx.sessionProjections.register(teamObservationProjection(z));
    const old = { dshBridge: { ver: 1, seq: 5, val: { turn: 2, open: false, lastEnd: { turn: 2, reason: 'error' }, inputs: [], output: 'STALE T1', recent: [], errors: [] } } };
    const before = structuredClone(old);
    assert.deepEqual(ctx.sessionProjections.viewCheckpoint(old), {});
    assert.equal(ctx.sessionProjections.restoreFloor(old), 0);
    const events = [event('turn/start', { turn: 1 }, 0), event('assistant/message', assistant('T1'), 1), event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2),
      event('turn/start', { turn: 2 }, 3), event('assistant/message', assistant(null), 4), event('turn/end', { turn: 2, reason: { kind: 'error' } }, 5)];
    const restored = ctx.sessionProjections.restore(old, events, 0, { version: SESSION_FORMAT_VERSION, id: 'fixture-cache', createdAt: 0, isSeeded: false }, 0);
    const state = restored.snapshot.values.dshBridge;
    assert.equal(state.output, ''); assert.equal(state.outputSource, null);
    assert.deepEqual(state.latestAssistant, { turn: 2, seq: 4, hasText: false });
    assert.deepEqual(state.lastCompletedTurn, { turn: 1, endSeq: 2 });
    assert.equal(restored.checkpoint.dshBridge.ver, 2); assert.deepEqual(old, before);
  } finally { await ctx.fiber.dispose(); }
});
