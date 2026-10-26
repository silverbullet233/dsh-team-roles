import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import ReadOnlyNativeCredentials from '../../src/auth/provider.mjs';

async function fixture(run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-native-auth-')));
  const path = join(root, '.credentials.yaml');
  const initial = 'version: 1\nrefs:\n  FIXTURE_API_KEY: synthetic-value\nrecords:\n  fixture/native:\n    kind: api-key\n    key: synthetic-record\n';
  await writeFile(path, initial, { mode: 0o600 });
  const ctx = new Context();
  try {
    await ctx.plugin(ReadOnlyNativeCredentials, { path });
    await run({ ctx, path, initial });
  } finally {
    await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

test('native credential seam resolves current synthetic records without changing the file', async () => fixture(async ({ ctx, path, initial }) => {
  assert.deepEqual(await ctx.credentials.resolve('FIXTURE_API_KEY'), { value: 'synthetic-value', source: 'file' });
  assert.deepEqual(await ctx.credentials.describe('FIXTURE_API_KEY'), { configured: true, source: 'file', writable: false });
  assert.deepEqual(await ctx.credentials.readRecord('fixture/native'), { kind: 'api-key', key: 'synthetic-record' });
  assert.deepEqual(await ctx.credentials.listRecords(), [{ key: 'fixture/native', kind: 'api-key' }]);
  assert.deepEqual(await ctx.credentials.describeRecord('fixture/missing'), { configured: false, writable: false });
  assert.equal(await readFile(path, 'utf8'), initial);
  await writeFile(path, initial.replace('synthetic-value', 'synthetic-replacement'));
  assert.equal((await ctx.credentials.resolve('FIXTURE_API_KEY')).value, 'synthetic-replacement');
}));

test('credential replacement and all direct mutations reject without changing the file', async () => fixture(async ({ ctx, path, initial }) => {
  for (const operation of [
    () => ctx.credentials.set('FIXTURE_API_KEY', 'synthetic-change'),
    () => ctx.credentials.unset('FIXTURE_API_KEY'),
    () => ctx.credentials.modifyRecord('fixture/native', async () => ({ kind: 'api-key', key: 'synthetic-change' })),
    () => ctx.credentials.deleteRecord('fixture/native'),
  ]) await assert.rejects(operation, { code: 'credentials/read-only' });
  assert.equal(await readFile(path, 'utf8'), initial);
}));

test('credential record checks allow only unchanged no-op callbacks', async () => fixture(async ({ ctx, path, initial }) => {
  let callbackRecord;
  const record = await ctx.credentials.modifyRecord('fixture/native', async current => { callbackRecord = current; return undefined; });
  assert.deepEqual(record, { kind: 'api-key', key: 'synthetic-record' });
  assert.notEqual(record, callbackRecord);
  callbackRecord.key = 'late-synthetic-mutation';
  assert.equal(record.key, 'synthetic-record');
  assert.equal(await ctx.credentials.modifyRecord('fixture/missing', async () => undefined), undefined);
  await assert.rejects(ctx.credentials.modifyRecord('fixture/native', async current => { current.key = 'synthetic-change'; return undefined; }), { code: 'credentials/read-only' });
  await assert.rejects(ctx.credentials.modifyRecord('fixture/missing', async () => ({ kind: 'api-key', key: 'synthetic-new' })), { code: 'credentials/read-only' });
  assert.equal(await readFile(path, 'utf8'), initial);
}));

test('credential no-op checks reject concurrent record changes', async () => fixture(async ({ ctx, path, initial }) => {
  await assert.rejects(ctx.credentials.modifyRecord('fixture/native', async () => {
    await writeFile(path, initial.replace('synthetic-record', 'synthetic-replacement'));
    return undefined;
  }), { code: 'credentials/store-changed' });
}));

test('old flat and malformed native credential documents fail without migration or value disclosure', async () => fixture(async ({ ctx, path }) => {
  for (const document of ['FIXTURE_API_KEY: synthetic-secret-to-omit\n', 'version: 1\nrefs:\n  FIXTURE_API_KEY: [synthetic-secret-to-omit\n']) {
    await writeFile(path, document);
    await assert.rejects(ctx.credentials.resolve('FIXTURE_API_KEY'), error => error.code === 'credentials/invalid-store' && !error.message.includes('synthetic-secret'));
    assert.equal(await readFile(path, 'utf8'), document);
  }
}));

test('native Connection cannot provision a missing persistent browser signing credential', async () => fixture(async ({ ctx, path, initial }) => {
  await assert.rejects(async () => { await ctx.plugin(Connection); }, { code: 'credentials/read-only' });
  assert.equal(ctx.get('connection'), undefined);
  assert.equal(await readFile(path, 'utf8'), initial);
  assert.deepEqual(await ctx.credentials.describeRecord('client-connection/browser-session'), { configured: false, writable: false });
}));

test('native Connection reuses an existing synthetic signing record without writing', async () => fixture(async ({ ctx, path, initial }) => {
  const existing = `${initial}  client-connection/browser-session:\n    kind: grant\n    payload:\n      version: 1\n      secret: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n`;
  await writeFile(path, existing);
  await ctx.plugin(Connection);
  assert.notEqual(ctx.get('connection'), undefined);
  assert.equal(await readFile(path, 'utf8'), existing);
  assert.deepEqual(await ctx.credentials.describeRecord('client-connection/browser-session'), { configured: true, kind: 'grant', writable: false });
}));
