import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkPackage } from '../../scripts/check-package.mjs';

test('release packaging refuses a source-only checkout and a wrong native client artifact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'team-role-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = { name: 'dsh-team-roles', version: '0.2.0', exports: { './client': './lib/client.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } } };
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await assert.rejects(checkPackage(root), /Missing release file.*lib\/client\.js.*npm run build/);
  await mkdir(join(root, 'lib'));
  await writeFile(join(root, 'lib/client.js'), 'export {};');
  await mkdir(join(root, 'scripts/runtime'), { recursive: true });
  for (const file of ['cordis.patch.yml', 'runtime-lock.json', 'scripts/runtime/source-build-manifest.json']) await writeFile(join(root, file), '{}');
  await assert.rejects(checkPackage(root), /not a dsh-team-roles module-loader artifact/);
  await writeFile(join(root, 'lib/client.js'), "window.__ModuleLoader__.load({id: 'dsh-team-roles', factory: () => ({})});");
  assert.equal((await checkPackage(root)).version, '0.2.0');
  await writeFile(join(root, 'package.json'), JSON.stringify({ ...pkg, dependencies: { fixture: 'file:../local-checkout' } }));
  await assert.rejects(checkPackage(root), /must not reference a checkout path/);
  await writeFile(join(root, 'fixture.mjs'), "const source = '/home/synthetic/development-checkout/';");
  await writeFile(join(root, 'package.json'), JSON.stringify({ ...pkg, files: ['fixture.mjs'] }));
  await assert.rejects(checkPackage(root), /workstation-specific path/);
  await writeFile(join(root, 'package.json'), JSON.stringify({ ...pkg, private: true }));
  await assert.rejects(checkPackage(root), /private to be unset/);
});


test('release package has no workstation paths or checkout dependency specs', async () => {
  const result = await checkPackage(new URL('../..', import.meta.url).pathname);
  assert.equal(result.version, '0.3.0');
});
