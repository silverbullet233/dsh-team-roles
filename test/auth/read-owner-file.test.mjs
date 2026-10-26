import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOwnerFile, resolveReadOnlyConfig } from '../../src/auth/read-owner-file.mjs';
import { registeredRouteCatalog, nativeCredentialPresence } from '../../src/auth/catalog.mjs';

async function fixture(run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-readonly-auth-')));
  const path = join(root, '.credentials.yaml');
  await writeFile(path, 'version: 1\nrefs:\n  FIXTURE_API_KEY: synthetic-value\n', { mode: 0o600 });
  try { await run({ root, path }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('owner credential reads are bounded and leave the source unchanged', async () => fixture(async ({ path }) => {
  const before = await readFile(path, 'utf8');
  assert.equal(await readOwnerFile({ path }), before);
  assert.equal(await readFile(path, 'utf8'), before);
  await assert.rejects(readOwnerFile({ path, maxDocumentBytes: 4 }), { code: 'credentials/oversize' });
}));

test('missing, permissive, directory, symlink and noncanonical credential paths fail before returning values', async () => fixture(async ({ root, path }) => {
  await assert.rejects(readOwnerFile({ path: join(root, 'missing') }), { code: 'credentials/missing-store' });
  await chmod(path, 0o644);
  await assert.rejects(readOwnerFile({ path }), { code: 'credentials/unsafe-mode' });
  await chmod(path, 0o600);
  const link = join(root, 'credential-link');
  await symlink(path, link);
  await assert.rejects(readOwnerFile({ path: link }), { code: 'credentials/symlink' });
  const directory = join(root, 'directory');
  await mkdir(directory, { mode: 0o700 });
  await assert.rejects(readOwnerFile({ path: directory }), { code: 'credentials/not-regular' });
  const parent = join(root, 'parent-link');
  await symlink(root, parent);
  await assert.rejects(readOwnerFile({ path: join(parent, '.credentials.yaml') }), { code: 'credentials/symlink' });
  assert.throws(() => resolveReadOnlyConfig({ path: `${root}/./.credentials.yaml` }), { code: 'credentials/invalid-path' });
}));

test('invalid byte limits and non-UTF-8 documents are refused without echoing bytes', async () => fixture(async ({ path }) => {
  for (const maxDocumentBytes of [0, -1, 1.5, Infinity, 67_108_865]) assert.throws(() => resolveReadOnlyConfig({ path, maxDocumentBytes }), { code: 'credentials/invalid-limit' });
  await writeFile(path, Buffer.from([0xff, 0xfe]));
  await assert.rejects(readOwnerFile({ path }), { code: 'credentials/invalid-encoding', message: 'The native credential document must be valid UTF-8.' });
}));

test('route inspection reports exact registered models and efforts without exposing endpoints', async () => {
  const ctx = { llm: {
    listProviders: () => [{ id: 'opencode-go', name: 'OpenCode Go', baseURL: 'https://synthetic.invalid/private' }],
    listModels: async () => [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek Flash' }],
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultEffort: 'high' }, secret: 'synthetic-private-value' }),
  } };
  const routes = await registeredRouteCatalog(ctx, [{ provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, { provider: 'missing', model: 'missing' }]);
  assert.deepEqual(routes, [{ provider: 'opencode-go', providerName: 'OpenCode Go', model: 'deepseek-v4.1-flash', modelName: 'DeepSeek Flash', registered: true, available: true, reasoningEfforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultReasoningEffort: 'high' }, { provider: 'missing', model: 'missing', registered: false, available: false }]);
  assert.doesNotMatch(JSON.stringify(routes), /synthetic-private|https:/);
  await assert.rejects(registeredRouteCatalog(ctx, [{ provider: 'opencode-go', model: 'deepseek-v4.1-flash', endpoint: 'https://synthetic.invalid' }]));
});

test('credential presence returns only native descriptor metadata', async () => {
  const result = await nativeCredentialPresence({ credentials: {
    describeRecord: async () => ({ configured: false, writable: false }),
    describe: async () => ({ configured: true, source: 'file', writable: false }),
  } }, ['FIXTURE_API_KEY']);
  assert.deepEqual(result, { browserSessionConfigured: false, writable: false, references: [{ ref: 'FIXTURE_API_KEY', configured: true, source: 'file', writable: false }] });
});
