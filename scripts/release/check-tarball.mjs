/** Inspect the actual archive before creating checksums; reject links and path escapes. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkPackage } from '../check-package.mjs';
import { releaseVersion } from './version.mjs';
export async function checkTarball(archive, tag) {
  archive = resolve(archive);
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert(names.length && names.every(name => name.startsWith('package/') && !name.split('/').includes('..') && !name.includes('\\')), 'Archive paths must remain inside package/');
  const details = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert(details.every(line => /^[d-]/.test(line)), 'Release archive must contain only regular files/directories, without links');
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-pack-'));
  try {
    execFileSync('tar', ['-xzf', archive, '-C', root]);
    const pkg = JSON.parse(await readFile(join(root, 'package/package.json'), 'utf8'));
    const release = releaseVersion(pkg, tag);
    assert.equal(archive, join(dirname(archive), release.tarball));
    await checkPackage(join(root, 'package'));
    assert(!names.some(name => /(?:^|\/)(?:node_modules|\.git|\.runtime)(?:\/|$)/.test(name)), 'Runtime state or dependency links must not be distributed');
    const checksum = createHash('sha256').update(await readFile(archive)).digest('hex');
    await writeFile(join(dirname(archive), 'SHA256SUMS'), `${checksum}  ${release.tarball}\n`);
    return { ...release, files: names.length, checksum };
  } finally { await rm(root, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkTarball(process.argv[2], process.env.RELEASE_TAG || undefined)));
