/** Prepare nonsecret configuration and reversible profile backups before official CLI installation. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { resolveConfig } from '../src/roles/config.mjs';
import { assertNonsecretBackup } from './profile-backup-safety.mjs';

const project = resolve(import.meta.dirname, '..');
const nativeHome = join(homedir(), '.dsh');
const profile = join(nativeHome, 'profiles/web');
const directory = join(nativeHome, 'dsh-agent-team');
await mkdir(directory, { recursive: true, mode: 0o700 });
const backup = join(directory, `install-backup-${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(backup, { mode: 0o700 });
for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
  try {
    const contents = await readFile(join(profile, name), 'utf8');
    assertNonsecretBackup(contents, { kind: name === 'package.json' ? 'package' : name === 'pnpm-lock.yaml' ? 'lock' : name === 'cordis.patch.yml' ? 'profile' : 'workspace' });
    await writeFile(join(backup, name), contents, { mode: 0o600, flag: 'wx' });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const examples = JSON.parse(await readFile(join(project, 'examples/roles.json'), 'utf8'));
const validationFile = process.argv[2];
const validationRun = validationFile === undefined ? null : JSON.parse(await readFile(resolve(validationFile), 'utf8'));
const config = {
  stateDirectory: join(directory, 'state'), socketPath: `/tmp/dsh-agent-team-${process.getuid()}/native.sock`,
  allowedRoots: [project, ...(validationRun === null ? [] : [validationRun.fixtureRoot])], leadRole: examples.leadRole, roles: examples.roles,
  ...(validationRun === null ? {} : { validation: { mode: 'live', allowOtherSessions: true, fixtureRoot: validationRun.fixtureRoot, stateRoot: validationRun.root, auditPath: join(validationRun.root, 'model-audit.jsonl'), maxRequests: 24, maxOutputTokens: 4096 } }),
};
resolveConfig({ stateDirectory: config.stateDirectory, leadRole: config.leadRole, roles: config.roles });
const configPath = join(nativeHome, 'dsh-agent-team.json');
try { await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const original = await readFile(configPath, 'utf8');
  assertNonsecretBackup(original, { kind: 'profile' });
  await writeFile(join(backup, 'dsh-agent-team.json'), original, { mode: 0o600, flag: 'wx' });
  const existing = JSON.parse(original);
  resolveConfig({ stateDirectory: existing.stateDirectory, leadRole: existing.leadRole, roles: existing.roles });
  if (validationRun !== null && (!existing.validation?.allowOtherSessions || existing.validation.fixtureRoot !== config.validation.fixtureRoot)) throw new Error('Existing user configuration differs; it was preserved.');
}
await writeFile(join(backup, 'installation.json'), JSON.stringify({ package: 'dsh-team-roles', source: project, configPath, socketPath: config.socketPath, command: ['/Users/mxr/.local/bin/dsh', 'plugin', '--profile', 'web', 'add', `link:${project}`, '--offline', '--ignore-scripts'] }) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ package: 'dsh-team-roles', entrypoint: join(project, 'src/host.mjs'), configPath, socketPath: config.socketPath, backup, existingCredentialsChanged: false }));
