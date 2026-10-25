/** Refuse a release archive missing generated assets or a declared entry point. */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkPackage(root) {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (pkg.private === true) throw new Error('Release packaging requires private to be unset in package.json.');
  const required = new Set([
    ...Object.values(pkg.exports), pkg.dsh.bundle.patch,
    'runtime-lock.json', 'scripts/runtime/source-build-manifest.json',
  ]);
  for (const file of required) {
    let info;
    try { info = await stat(resolve(root, file)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Missing release file ${file}. Connect the pinned native runtime and run npm run build before packing.`);
    }
    if (!info.isFile()) throw new Error(`Release entry ${file} must be a file.`);
  }
  const client = await readFile(resolve(root, pkg.exports['./client']), 'utf8');
  if (!client.includes('window.__ModuleLoader__.load(') || !client.includes("id: 'dsh-team-roles'")) throw new Error('Native Web client is not a dsh-team-roles module-loader artifact; rebuild before packing.');
  return { name: pkg.name, version: pkg.version, checkedFiles: required.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error(JSON.stringify(await checkPackage(resolve(import.meta.dirname, '..'))));
}
