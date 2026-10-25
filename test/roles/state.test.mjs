import test from 'node:test';
import assert from 'node:assert/strict';
import { RESERVED, BOUND, foldRoleEvents, needsInitialSelection } from '../../src/roles/state.mjs';

const binding = { name: 'worker-one', role: 'analyst', description: 'Synthetic analyst', instructions: 'Return nonce.', provider: 'fixture', model: 'fixture-a', reasoningEffort: 'max', inputDigest: 'abc' };
const event = (type, data, seq) => ({ type, data, seq, time: 100 + seq });

test('native member identity resolves a pre-provisioning immutable role reservation', () => {
  const state = foldRoleEvents([
    event(RESERVED, binding, 0),
    event('team/member', { member: { id: 'native-child', name: 'worker-one' } }, 1),
    event(RESERVED, { ...binding, name: 'worker-two' }, 2),
  ]);
  assert.equal(state.reservations[0].memberId, 'native-child');
  assert.equal(state.reservations[1].role, 'analyst');
  assert.equal(state.reservations[1].memberId, undefined);
  assert.throws(() => foldRoleEvents([event(RESERVED, binding, 0), event(RESERVED, { ...binding, model: 'changed' }, 1)]), /immutable/);
  assert.throws(() => foldRoleEvents([
    event(RESERVED, binding, 0), event('team/member', { member: { id: 'one', name: 'worker-one' } }, 1),
    event('team/member', { member: { id: 'two', name: 'worker-one' } }, 2),
  ]), /identity changed/);
});

test('last request evidence records actual header route independently from configured role', () => {
  const state = foldRoleEvents([
    event(BOUND, { ...binding, memberId: 'native-child' }, 0),
    event('model/selection', { provider: 'fixture', model: 'selected-next' }, 1),
    event('request/header', { header: { config: { provider: 'actual-adapter', model: 'actual-model', reasoningEffort: 'high' } } }, 2),
    event('model/selection', { provider: 'fixture', model: 'future' }, 3),
  ]);
  assert.equal(state.bound.model, 'fixture-a');
  assert.deepEqual(state.lastRequest, { provider: 'actual-adapter', model: 'actual-model', reasoningEffort: 'high', adapterDefaultEffort: false, seq: 2, time: 102 });
});

test('fork-inherited role records never grant a new Session a role', () => {
  const state = foldRoleEvents([event(BOUND, { ...binding, memberId: 'old' }, 0), event('unrelated', {}, 1)], 1);
  assert.equal(state.bound, null);
  assert.equal(state.lastRequest, null);
});

test('resume repairs a binding-before-selection crash without resetting explicit native choices', () => {
  const bound = event(BOUND, { ...binding, memberId: 'native-child' }, 0);
  assert.equal(needsInitialSelection(foldRoleEvents([])), true);
  assert.equal(needsInitialSelection(foldRoleEvents([bound])), true);
  const beforeBound = foldRoleEvents([
    event('model/selection', { provider: 'preset', model: 'before-role' }, 0),
    event('request/header', { header: { config: { provider: 'preset', model: 'before-role' } } }, 1),
    event(BOUND, { ...binding, memberId: 'native-child' }, 2),
  ]);
  assert.equal(needsInitialSelection(beforeBound), true);
  assert.equal(beforeBound.lastRequest.model, 'before-role');
  const explicit = foldRoleEvents([bound, event('model/selection', { provider: 'native-web-choice', model: 'other' }, 1)]);
  assert.equal(explicit.hasDurableSelection, true);
  assert.equal(needsInitialSelection(explicit), false);
  assert.equal(explicit.bound.model, 'fixture-a');
  const used = foldRoleEvents([bound, event('request/header', { header: { config: { provider: 'actual', model: 'used' } } }, 1)]);
  assert.equal(needsInitialSelection(used), false);
  const inherited = foldRoleEvents([event('model/selection', { provider: 'parent', model: 'parent' }, 0), event(BOUND, { ...binding, memberId: 'native-child' }, 1)], 1);
  assert.equal(needsInitialSelection(inherited), true);
});
