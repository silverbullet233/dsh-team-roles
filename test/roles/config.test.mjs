import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, roleSnapshot, routeOf } from '../../src/roles/config.mjs';

const role = { description: 'Synthetic analyst', instructions: 'Return the supplied nonce.', provider: 'fixture', model: 'fixture-model', reasoningEffort: 'max' };

test('role configuration stores registered provider routes and allows repeated role instances', () => {
  const config = resolveConfig({ stateDirectory: '/tmp/roles', leadRole: 'analyst', roles: { analyst: role } });
  assert.deepEqual(routeOf(config.roles.analyst), { provider: 'fixture', model: 'fixture-model', reasoningEffort: 'max' });
  assert.equal(Object.isFrozen(config.roles.analyst), true);
  assert.equal(config.spawnProvider, 'spawn');
});

test('role configuration refuses secrets, endpoint overrides, missing roles and alternate backends', () => {
  for (const addition of [{ apiKey: 'fixture-secret' }, { baseURL: 'https://example.invalid' }, { endpoint: 'https://example.invalid' }]) {
    assert.throws(() => roleSnapshot('analyst', { ...role, ...addition }), /unsupported field/);
  }
  assert.throws(() => roleSnapshot('analyst', { ...role, provider: 'https://example.invalid' }), /registration/);
  assert.throws(() => resolveConfig({ stateDirectory: 'relative', leadRole: 'analyst', roles: { analyst: role } }), /absolute/);
  assert.throws(() => resolveConfig({ stateDirectory: '/tmp/roles', leadRole: 'missing', roles: { analyst: role } }), /allowlisted/);
  assert.throws(() => resolveConfig({ stateDirectory: '/tmp/roles', leadRole: 'analyst', spawnProvider: 'remote', roles: { analyst: role } }), /native in-process/);
});
