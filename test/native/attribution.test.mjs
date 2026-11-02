import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountNativeHost, textChunks, toolChunks, until } from '../fixtures/native-harness.mjs';

test('native current-turn text survives tool-only messages and cold reads preserve honest attribution', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-attribution-'));
  let requests = 0;
  const withText = [
    { type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: 'T2 interim' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'T2 interim' } },
    ...toolChunks('fixture_read', { name: 'nonce.txt' }, 'with-text').map(chunk => chunk.index === undefined ? chunk : { ...chunk, index: 1 }),
  ];
  let host = await mountNativeHost({ root, respond: () => {
    requests++;
    return requests === 1 ? textChunks('T1 done') : requests === 2 ? withText : requests === 3 ? toolChunks('fixture_read', { name: 'nonce.txt' }, 'without-text') : 'hang';
  } });
  t.after(async () => { await host.client.close(); await host.dispose(); await rm(root, { recursive: true, force: true }); });
  const created = await host.client.request('create', { key: 'attribution', cwd: host.fixtureRoot, text: 'Synthetic T1.' });
  await host.ctx.agents.get(created.teamId).whenIdle();
  const t1 = await host.client.request('result', { teamId: created.teamId });
  assert.equal(t1.output, 'T1 done'); assert.equal(t1.turns.active, null); assert.equal(t1.turns.lastCompleted.turn, 1);
  await host.client.request('send', { teamId: created.teamId, inputId: 't2', text: 'Synthetic T2.' });
  await until(() => requests === 4);
  let result = await host.client.request('result', { teamId: created.teamId });
  assert.equal(result.output, 'T2 interim'); assert.equal(result.outputSource.turn, 2);
  assert.equal(result.latestAssistant.turn, 2); assert.equal(result.latestAssistant.hasText, false);
  assert(result.outputSource.seq < result.latestAssistant.seq);
  assert.equal(result.turns.active, 2); assert.equal(result.turns.lastEnded.turn, 1); assert.equal(result.turns.lastCompleted.turn, 1);
  assert.equal(result.freshness.atomic, false); assert.equal(result.asOfSeqScope, 'root-session');
  assert.equal(result.freshness.projections[0].sessionId, created.teamId);
  assert.equal(result.freshness.projections[0].asOfSeq, result.asOfSeq);
  await host.client.request('stop', { teamId: created.teamId });
  await host.client.close(); await host.dispose();
  host = await mountNativeHost({ root });
  result = await host.client.request('result', { teamId: created.teamId });
  assert.equal(result.output, 'T2 interim'); assert.equal(result.turns.active, null);
  assert.equal(result.turns.lastEnded.turn, 2); assert.equal(result.turns.lastCompleted.turn, 1);
  assert.equal(result.freshness.projections[0].unchangedAtCheck, null);
  assert.equal(host.ctx.agents.list().length, 0); assert.equal(host.requests.length, 0);
});
