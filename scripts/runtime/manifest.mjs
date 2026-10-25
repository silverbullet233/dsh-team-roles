import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { globSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const PINNED_SOURCE_SHA = '22ddee3792402c3e70ec5f86a63c3e3e895a2f60';
export const CLIENT_ARTIFACT_PATTERNS = ['apps/web/dist/**/*', 'packages/*/*/lib/client.js', 'packages/*/*/lib/client.js.map', 'packages/*/*/lib/client.*.js', 'packages/*/*/lib/client.*.js.map', 'packages/*/*/lib/assets/**/*'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const fileSha256 = path => sha256(readFileSync(path));

/** Match the pinned source's complete client-artifact digest algorithm. */
export function digestFiles(root, paths) {
  const digest = createHash('sha256');
  for (const path of [...paths].sort()) {
    const content = readFileSync(resolve(root, path));
    digest.update(`${Buffer.byteLength(path)}:`);
    digest.update(path);
    digest.update(`${content.byteLength}:`);
    digest.update(content);
  }
  return { fileCount: paths.length, sha256: digest.digest('hex') };
}

/** Read and verify a complete source build without modifying the checkout or starting DSH. */
export function inspectSourceBuild(directory) {
  const root = realpathSync(directory);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  if (commit !== PINNED_SOURCE_SHA) throw new Error(`DSH source SHA differs: ${commit}`);
  if (git(['status', '--porcelain=v1', '--untracked-files=no'])) throw new Error('DSH tracked worktree must be clean');
  const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const sourcePackage = json('package.json');
  const compiler = json('node_modules/typescript/package.json');
  if (compiler.version !== '6.0.3') throw new Error('DSH source build requires the pinned TypeScript 6.0.3 dependency');
  const record = json('.dsh-build/client-build-environment.json');
  if (record.formatVersion !== 1 || record.environment.DSH_CLIENT_COMMIT_HASH !== commit.slice(0, 7) || record.environment.DSH_CLIENT_VERSION !== sourcePackage.version || record.environment.DSH_CLIENT_GIT_DIRTY) throw new Error('Native Web build metadata does not match the clean pinned source');
  const clientPaths = globSync(CLIENT_ARTIFACT_PATTERNS, { cwd: root }).map(path => path.replaceAll('\\', '/')).filter(path => !/\/lib\/client\.node(?:\.|$)/.test(path) && statSync(join(root, path)).isFile());
  const client = digestFiles(root, clientPaths);
  if (client.fileCount === 0 || client.fileCount !== record.artifacts.fileCount || client.sha256 !== record.artifacts.sha256) throw new Error('Native Web artifacts do not match their complete source build record');
  const paths = globSync(['vendor/*/lib/**/*', 'packages/*/*/lib/**/*', 'apps/cli/lib/**/*', 'apps/desktop-host/lib/**/*'], { cwd: root }).map(path => path.replaceAll('\\', '/')).filter(path => statSync(join(root, path)).isFile()).sort();
  for (const required of ['vendor/cordis/lib/index.js', 'packages/core/agent/lib/index.js', 'packages/api/session-controller/lib/index.js', 'packages/api/session-controller/lib/typert.host.js', 'packages/experimental/agent-team/lib/index.js', 'apps/cli/lib/bin.js']) if (!paths.includes(required)) throw new Error(`Complete native source build is missing ${required}`);
  const host = digestFiles(root, paths);
  const patchPaths = globSync('patches/*.patch', { cwd: root }).sort();
  const piRoot = realpathSync(join(root, 'packages/llm/llm-pi-ai/node_modules/@earendil-works/pi-ai'));
  const piPackage = JSON.parse(readFileSync(join(piRoot, 'package.json'), 'utf8'));
  if (piPackage.version !== '1.3.0') throw new Error('Native source pi-ai dependency differs from version 1.3.0');
  const piPatch = 'patches/@earendil-works__pi-ai@1.3.0.patch';
  const patchedFiles = [...readFileSync(join(root, piPatch), 'utf8').matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match => match[1]).sort();
  return {
    schemaVersion: 2,
    sourceSha: commit,
    version: sourcePackage.version,
    packageManager: sourcePackage.packageManager,
    compilerVersion: compiler.version,
    compilerEntrySha256: fileSha256(join(root, 'node_modules/typescript/lib/typescript.js')),
    dependencyLockSha256: fileSha256(join(root, 'pnpm-lock.yaml')),
    installedDependencyLockSha256: fileSha256(join(root, 'node_modules/.pnpm/lock.yaml')),
    installationMetadataSha256: fileSha256(join(root, 'node_modules/.modules.yaml')),
    workspaceConfigSha256: fileSha256(join(root, 'pnpm-workspace.yaml')),
    patches: patchPaths.map(path => ({ path, sha256: fileSha256(join(root, path)) })),
    piAi: { version: piPackage.version, patchSha256: fileSha256(join(root, piPatch)), files: patchedFiles.map(path => ({ path, sha256: fileSha256(join(piRoot, path)) })) },
    host,
    frontend: { ...client, environment: record.environment, recordSha256: fileSha256(join(root, '.dsh-build/client-build-environment.json')) },
    artifacts: [...new Set([...paths, ...clientPaths])].sort().map(path => ({ path, sha256: fileSha256(join(root, path)) })),
  };
}

/** Render a portable manifest with no machine paths or timestamps. */
export const manifestText = manifest => JSON.stringify(manifest, null, 2) + '\n';

/** Resolve a source package's relative entry for evidence without leaking other paths. */
export function sourceRelativeEntry(root, entry) {
  const path = relative(realpathSync(root), realpathSync(entry)).replaceAll('\\', '/');
  if (path === '..' || path.startsWith('../') || path.startsWith('/')) throw new Error('Native public import resolves outside the verified source checkout');
  return path;
}

/** Inspect a direct CLI entry or the pinned pnpm command shim without executing it. */
export function resolveInstalledEntrypoint(path) {
  if (lstatSync(path).isSymbolicLink()) return realpathSync(path);
  const target = readFileSync(path, 'utf8').match(/^# cmd-shim-target=(.+)$/m)?.[1];
  if (!target) throw new Error('Native DSH entrypoint is not a supported verifiable pnpm shim');
  return realpathSync(target);
}
