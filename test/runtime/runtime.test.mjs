import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digestFiles, inspectSourceBuild, resolveInstalledEntrypoint, sourceRelativeEntry } from '../../scripts/runtime/manifest.mjs';
import { verifyRuntime } from '../../scripts/runtime/verify.mjs';

test('the installed complete native build and matching Web verify through the actual public imports', async () => {
  const result = await verifyRuntime();
  assert.equal(result.sourceSha, '22ddee3792402c3e70ec5f86a63c3e3e895a2f60');
  assert.equal(result.build.frontend, true);
  assert.equal(result.capabilities.generatedReflection, true);
  assert.match(result.resolvedModules.sessionReflection, /packages\/api\/session-controller\/lib\/typert\.host\.js$/);
});

test('a different source commit is rejected before its missing build can be accepted', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wrong-source-'));
  try {
    execFileSync('git', ['init', '--initial-branch=fixture', '--quiet', root]);
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '--no-gpg-sign', '--quiet', '-m', 'Synthetic source'], { cwd: root });
    assert.throws(() => inspectSourceBuild(root), /DSH source SHA differs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('artifact digests are deterministic and bind filenames and file bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-artifact-digest-'));
  try {
    writeFileSync(join(root, 'first.js'), 'one');
    writeFileSync(join(root, 'second.js'), 'two');
    const before = digestFiles(root, ['first.js', 'second.js']);
    assert.deepEqual(digestFiles(root, ['second.js', 'first.js']), before);
    writeFileSync(join(root, 'first.js'), 'changed');
    assert.notEqual(digestFiles(root, ['first.js', 'second.js']).sha256, before.sha256);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an outside public import is rejected even when hidden behind a local symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-import-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'dsh-import-outside-'));
  try {
    const entry = join(outside, 'index.js');
    writeFileSync(entry, 'export {};');
    symlinkSync(entry, join(root, 'index.js'));
    assert.throws(() => sourceRelativeEntry(root, join(root, 'index.js')), /outside the verified source checkout/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('unsupported executable wrappers are rejected without running them', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-untrusted-shim-'));
  try {
    const path = join(root, 'dsh');
    writeFileSync(path, '#!/bin/sh\necho should-not-run\n');
    assert.throws(() => resolveInstalledEntrypoint(path), /not a supported verifiable pnpm shim/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
