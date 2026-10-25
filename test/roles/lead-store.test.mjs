import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LeadStore } from '../../src/roles/lead-store.mjs';
import { roleSnapshot } from '../../src/roles/config.mjs';

const snapshot = roleSnapshot('lead', { description: 'Synthetic coordinator', instructions: 'Return nonce.', provider: 'fixture', model: 'one' });

test('Lead reservation survives restart and changed catalog without rewriting its snapshot', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-role-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LeadStore(root);
  const old = await store.reserve('native-session', snapshot);
  const restarted = new LeadStore(root);
  const again = await restarted.reserve('native-session', { ...snapshot, model: 'two', instructions: 'Changed.' });
  assert.deepEqual(again, old);
  assert.equal(again.model, 'one');
  assert.equal((await stat(store.path('native-session'))).mode & 0o777, 0o600);
  await assert.rejects(restarted.reserve('native-session', { ...snapshot, role: 'another' }), /conflicts/);
});

test('Lead reservation store refuses permissive directories and symlink records', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-role-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LeadStore(root);
  await store.prepare();
  await chmod(store.directory, 0o755);
  await assert.rejects(store.prepare(), /0700/);
  await chmod(store.directory, 0o700);
  await symlink('/etc/hosts', store.path('native-session'));
  await assert.rejects(store.read('native-session'));
});
