/** Refuse a release archive missing generated assets or a declared entry point. */
import { readFile, stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkPackage(root) {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (pkg.private === true) throw new Error('Release packaging requires private to be unset in package.json.');
  const required = new Set([
    ...Object.values(pkg.exports), pkg.dsh.bundle.patch,
    'scripts/runtime/verify.mjs',
  ]);
  for (const file of required) {
    let info;
    try { info = await stat(resolve(root, file)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`Missing release file ${file}. Run npm run build from a prepared development checkout before packing.`);
    }
    if (!info.isFile()) throw new Error(`Release entry ${file} must be a file.`);
  }
  const client = await readFile(resolve(root, pkg.exports['./client']), 'utf8');
  if (!client.includes('window.__ModuleLoader__.load(') || !client.includes("id: 'dsh-team-roles'")) throw new Error('Native Web client is not a dsh-team-roles module-loader artifact; rebuild before packing.');
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (/^(?:file:|link:|\.\.?[\/])/.test(version)) throw new Error(`Release dependency ${name} must not reference a checkout path.`);
  }
  const inspect = async file => {
    const info = await stat(resolve(root, file));
    if (info.isDirectory()) {
      for (const entry of await readdir(resolve(root, file))) await inspect(`${file}/${entry}`);
    } else if (/\.(?:m?js|jsx|json|md|ya?ml)$/.test(file)) {
      const contents = await readFile(resolve(root, file), 'utf8');
      if (/(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|\/opt\/homebrew\/)/u.test(contents)) throw new Error(`Release file ${file} contains a workstation-specific path.`);
    }
  };
  for (const file of pkg.files ?? []) await inspect(file);
  return { name: pkg.name, version: pkg.version, checkedFiles: required.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error(JSON.stringify(await checkPackage(resolve(import.meta.dirname, '..'))));
}
