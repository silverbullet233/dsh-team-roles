import { existsSync, globSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileSha256, inspectSourceBuild, manifestText, sha256 } from './manifest.mjs';

/** Connect plugin-local imports to one already built source installation; never build or install. */
export function connectRuntime(directory) {
  const project = resolve(import.meta.dirname, '../..');
  const lock = JSON.parse(readFileSync(join(project, 'runtime-lock.json'), 'utf8'));
  const source = realpathSync(directory ?? process.env.DSH_SOURCE_ROOT ?? lock.source.directory);
  if (fileSha256(join(project, lock.build.manifest)) !== lock.build.manifestSha256 || sha256(manifestText(inspectSourceBuild(source))) !== lock.build.manifestSha256) throw new Error('Source installation differs from the sealed complete native build');
  const names = new Set(['zod', 'js-yaml', 'esbuild', 'react']);
  for (const path of globSync(['vendor/*/package.json', 'packages/*/*/package.json', 'apps/cli/package.json'], { cwd: source })) {
    const value = JSON.parse(readFileSync(join(source, path), 'utf8'));
    if (value.name?.startsWith('@deepseek-ai/')) names.add(value.name);
  }
  const changes = [];
  const managedRoots = [join(project, '.runtime/dsh-source'), resolve(lock.source.directory), source];
  for (const name of [...names].sort()) {
    const path = join(project, 'node_modules', name);
    const target = [join(source, 'node_modules', name), join(source, 'node_modules/.pnpm/node_modules', name)].find(existsSync);
    if (!target) throw new Error(`Built source dependency is unavailable: ${name}`);
    let previous = null;
    try {
      const stat = lstatSync(path);
      if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace an existing plugin dependency: ${path}`);
      previous = resolve(dirname(path), readlinkSync(path));
      if (!managedRoots.some(root => previous === root || previous.startsWith(root + '/'))) throw new Error(`Refusing to replace an unmanaged plugin symlink: ${path}`);
      if (existsSync(path) && realpathSync(path) === realpathSync(target)) continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    changes.push({ path, target, previous });
  }
  // Preflight every existing path before changing any plugin-local import.
  for (const { path, target, previous } of changes) {
    mkdirSync(dirname(path), { recursive: true });
    if (previous !== null) unlinkSync(path);
    symlinkSync(target, path, 'dir');
  }
  return { sourceSha: lock.source.commit, runtimeDirectory: source, changedLinks: changes.length, installedEntrypoint: lock.entrypoint };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(connectRuntime(process.argv[2]), null, 2));
