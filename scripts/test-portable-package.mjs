/** Install a built tarball into a fresh native profile and exercise it keylessly. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [runtimeArg, tarballArg, homeArg] = process.argv.slice(2);
if (!runtimeArg || !tarballArg) throw new Error('Usage: node scripts/test-portable-package.mjs <released-cli-package-directory> <built-tarball> [new-temporary-home]');
const runtime = await realpath(runtimeArg);
const tarball = await realpath(tarballArg);
const home = homeArg ? resolve(homeArg) : await mkdtemp('/tmp/dsh-packed-');
if (homeArg) await mkdir(home); // Refuse to overwrite an existing test profile.
const profileName = 'role-package';
const profileDir = join(home, 'profiles', profileName);
const nativeRequire = createRequire(join(runtime, 'package.json'));
const app = await import(pathToFileURL(nativeRequire.resolve('@deepseek-ai/dsh-app-boot')).href);
app.initProfile(profileDir, []);
await writeFile(join(profileDir, 'cordis.yml'), '[]\n');
const fixtures = join(profileDir, 'fixture-code');
await mkdir(fixtures);
const project = resolve(import.meta.dirname, '..');
for (const file of ['portable-runner.mjs', 'portable-stack.mjs', 'audit.mjs', 'synthetic-files.mjs']) await copyFile(join(project, 'test/fixtures', file), join(fixtures, file));
const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
env.DSH_HOME = home;
const run = async (name, args) => {
  const logPath = join(home, `${name}.log`);
  const log = createWriteStream(logPath);
  const child = spawn(process.execPath, args, { cwd: dirname(profileDir), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  await new Promise(resolve => log.end(resolve));
  if (code !== 0) throw new Error(`${name} exited ${code}; see ${logPath}\n${(await readFile(logPath, 'utf8')).slice(-6000)}`);
  return await readFile(logPath, 'utf8');
};
await run('install', [join(runtime, 'lib/bin.js'), 'plugin', '--profile', profileName, 'add', tarball, '--ignore-scripts', '--registry=https://registry.npmjs.org']);
const runner = join(fixtures, 'portable-runner.mjs');
await run('positive', [runner, runtime, home, profileName]);
await run('missing-api', [runner, runtime, home, profileName, 'missing-api']);
const outside = await run('outside-launcher', ['--input-type=module', '-e', `try { await import(${JSON.stringify(pathToFileURL(join(profileDir, 'node_modules/dsh-team-roles/src/host.mjs')).href)}); throw new Error('Unexpected plain-Node activation'); } catch (error) { if (error.code !== 'DSH_NATIVE_PEERS_UNAVAILABLE') throw error; console.log(error.code); }`]);
assert.match(outside, /DSH_NATIVE_PEERS_UNAVAILABLE/);
const evidence = JSON.parse(await readFile(join(home, 'evidence.json'), 'utf8'));
assert.equal(evidence.nativeEmptyTeamCreated, true);
assert.equal(evidence.existingManagedBindingRetained, true);
console.log(JSON.stringify({ ...evidence, missingApiRejected: true, outsideLauncherRejected: true, home }, null, 2));
