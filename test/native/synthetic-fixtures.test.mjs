import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticFiles } from '../fixtures/synthetic-files.mjs';
import { createSyntheticAuditor } from '../fixtures/audit.mjs';

test('synthetic tools reject traversal, symlinks, outside files and oversized content', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-synthetic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = await syntheticFiles(join(root, 'fixture'));
  await writeFile(join(root, 'fixture', 'nonce.txt'), 'nonce-17');
  assert.equal(await files.read('nonce.txt'), 'nonce-17');
  assert.deepEqual(await files.write('left-result.txt', '23'), { name: 'left-result.txt', bytes: 2 });
  for (const name of ['../outside.txt', '/etc/passwd', 'nested/nonce.txt', 'unknown.txt']) await assert.rejects(files.read(name), /allowlisted/u);
  await assert.rejects(files.write('nonce.txt', 'override'), /allowlisted/u);
  await assert.rejects(files.write('right-result.txt', 'x'.repeat(257)), /256/u);
  await writeFile(join(root, 'outside.txt'), 'outside');
  await symlink(join(root, 'outside.txt'), join(root, 'fixture', 'right.txt'));
  await assert.rejects(files.read('right.txt'), /symlink/u);
  await symlink(join(root, 'outside.txt'), join(root, 'fixture', 'right-result.txt'));
  await assert.rejects(files.write('right-result.txt', 'overwrite'), /symlink/u);
  await unlink(join(root, 'fixture', 'right-result.txt'));
  await link(join(root, 'outside.txt'), join(root, 'fixture', 'right-result.txt'));
  await assert.rejects(files.write('right-result.txt', 'overwrite'), /unlinked elsewhere/u);
  await unlink(join(root, 'fixture', 'right.txt'));
  await link(join(root, 'outside.txt'), join(root, 'fixture', 'right.txt'));
  await assert.rejects(files.read('right.txt'), /unlinked elsewhere/u);
  assert.equal(await readFile(join(root, 'outside.txt'), 'utf8'), 'outside');
});

test('synthetic auditing checks historical tool declarations and one-shot system input', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-audit-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const audit = createSyntheticAuditor({ auditPath: join(root, 'audit.jsonl') });
  const options = { provider: 'fixture', model: 'fixture', system: 'Synthetic.', messages: [{ role: 'user', content: [{ type: 'text', text: '17' }] }], tools: [] };
  await assert.rejects(audit({ ...options, toolHistory: { tools: [{ name: 'shell' }], updates: [] } }), /non-allowlisted/u);
  await assert.rejects(audit({ ...options, toolHistory: { tools: [], updates: [{ messageId: 'one', additions: [{ name: 'web_fetch' }] }] } }), /non-allowlisted/u);
  await assert.rejects(audit({ ...options, system: 'Read /Users/example/private.txt' }), /user-home path/u);
  const recorded = await audit({ ...options, messages: [{ role: 'assistant', content: [{ type: 'reasoning', text: 'Synthetic arithmetic.' }] }] });
  assert.equal(recorded.payload.system, 'Synthetic.');
});

test('every accepted synthetic request is fully audited before its adapter can run', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const auditPath = join(root, 'audit.jsonl');
  const audit = createSyntheticAuditor({ auditPath, maxRequests: 3 });
  const options = { provider: 'fixture-left', model: 'fixture-model', reasoningEffort: 'max', system: 'Synthetic only.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Add 2 and 3.' }] }], tools: [{ name: 'fixture_read', description: 'Read a synthetic fixture.' }] };
  const record = await audit(options);
  assert.deepEqual(JSON.parse((await readFile(auditPath, 'utf8')).trim()), record);
  assert.deepEqual(record.payload.messages, options.messages);
  await assert.rejects(audit({ ...options, tools: [{ name: 'bash' }] }), /non-allowlisted/u);
  await assert.rejects(audit({ ...options, messages: [{ role: 'user', content: [{ type: 'image', data: 'no' }] }] }), /Only text/u);
  await assert.rejects(audit(options), /limit/u);
});
