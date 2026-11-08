import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mountNativeHost } from '../fixtures/native-harness.mjs';

for (const phase of ['onRequest', 'respond']) test(`native fixture disposal aborts a stalled ${phase} callback`, { timeout: 10000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fixture-dispose-'));
  const entered = Promise.withResolvers();
  const host = await mountNativeHost({ root, [phase]: () => { entered.resolve(); return new Promise(() => {}); } });
  t.after(async () => { await host.dispose(); await rm(root, { recursive: true, force: true }); });
  const created = await host.client.request('create', { key: 'stalled-fixture', cwd: host.fixtureRoot, text: 'Synthetic stalled callback teardown.' });
  await entered.promise;
  assert.equal(host.ctx.agents.get(created.teamId).status, 'running');
  await host.client.close();
  await host.dispose();
  assert.equal(host.requests.length, 1);
});
