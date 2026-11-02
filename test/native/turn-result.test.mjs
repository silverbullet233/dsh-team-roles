import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountNativeHost, textChunks, toolChunks, until } from '../fixtures/native-harness.mjs';

test('ended-turn reference survives active T2, disconnect and native cold restart without activation', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-turn-results-'));
  const full = 'first:' + '中文🙂'.repeat(2500);
  let count = 0;
  let host = await mountNativeHost({ root, respond: () => ++count === 1 ? toolChunks('fixture_read', { name: 'nonce.txt' }) : count === 2 ? textChunks(full) : 'hang' });
  t.after(async () => { await host.client.close(); await host.dispose(); await rm(root, { recursive: true, force: true }); });
  const created = await host.client.request('create', { key: 'history', cwd: host.fixtureRoot, text: 'Synthetic T1.' });
  await host.ctx.agents.get(created.teamId).whenIdle();
  assert.equal(count, 2);
  const first = await host.client.request('turnResult', { teamId: created.teamId, turn: 1, maxBytes: 101 });
  assert.equal(first.outcome, 'completed'); assert.deepEqual(first.inputIds, [created.inputId]);
  assert(first.page.totalBytes > 8192); assert(first.page.nextOffset !== null);
  await host.client.request('send', { teamId: created.teamId, inputId: 't2', text: 'Synthetic running T2.' });
  await until(() => count === 3);
  await host.client.close();
  const repeated = await host.client.request('turnResult', { teamId: created.teamId, resultRef: first.resultRef, maxBytes: 101 });
  assert.deepEqual(repeated, first); assert.equal(count, 3);
  assert.equal(host.ctx.agents.get(created.teamId).status, 'running');
  await assert.rejects(host.client.request('turnResult', { teamId: created.teamId, turn: 2 }), { code: 'TURN_NOT_ENDED' });
  await assert.rejects(host.client.request('turnResult', { teamId: 'foreign-root', turn: 1 }), { code: 'UNKNOWN_TEAM' });
  await host.ctx.sessions.flush(host.ctx.agents.get(created.teamId).session);
  await host.client.close(); await host.dispose();
  host = await mountNativeHost({ root });
  assert.equal(host.ctx.agents.list().length, 0);
  let part = await host.client.request('turnResult', { teamId: created.teamId, resultRef: first.resultRef, maxBytes: 4093 }), assembled = '';
  for (;;) {
    assembled += part.page.text;
    if (part.page.nextOffset === null) break;
    part = await host.client.request('turnResult', { teamId: created.teamId, resultRef: first.resultRef, offset: part.page.nextOffset, maxBytes: 4093 });
  }
  const records = assembled.trim().split('\n').map(JSON.parse);
  assert(records.some(record => record.text.includes(full)));
  assert.equal(host.requests.length, 0); assert.equal(host.ctx.agents.list().length, 0);
  assert.equal(part.resultRef, first.resultRef);
});
