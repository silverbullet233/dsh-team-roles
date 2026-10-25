/** Generate a local overlay for the verified native DSH Web profile. No host is started. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveConfig } from '../src/roles/config.mjs';

const project = resolve(import.meta.dirname, '..');
const [configPath, outputPath] = process.argv.slice(2);
if (!configPath || !outputPath) throw new Error('Usage: node scripts/overlay.mjs /absolute/roles.json /absolute/plugin-overlay.yml');
if (!isAbsolute(configPath) || !isAbsolute(outputPath)) throw new Error('Configuration and output paths must be absolute.');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const allowed = ['stateDirectory', 'socketPath', 'allowedRoots', 'leadRole', 'roles', 'nativeTeam', 'readOnlyCredentialsPath'];
if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => !allowed.includes(key))) throw new Error('Unsupported overlay configuration field.');
resolveConfig({ stateDirectory: config.stateDirectory, leadRole: config.leadRole, roles: config.roles });
if (!isAbsolute(config.socketPath ?? '') || !Array.isArray(config.allowedRoots) || !config.allowedRoots.length || config.allowedRoots.some(path => typeof path !== 'string' || !isAbsolute(path))) throw new Error('socketPath and nonempty allowedRoots must be absolute.');
if (config.nativeTeam !== undefined && !['add', 'existing'].includes(config.nativeTeam)) throw new Error('nativeTeam must be add or existing.');
const rows = [];
if (config.readOnlyCredentialsPath !== undefined) {
  if (!isAbsolute(config.readOnlyCredentialsPath)) throw new Error('readOnlyCredentialsPath must be absolute.');
  rows.push({ id: 'credentials', name: pathToFileURL(join(project, 'src/auth/provider.mjs')).href, config: { path: config.readOnlyCredentialsPath } });
}
const insert = [];
if (config.nativeTeam !== 'existing') {
  rows.push(...['tool-subagent-control', 'tool-subagent', 'tool-subagent-fork'].map(id => ({ id, disabled: true })));
  insert.push(
    { id: 'agent-team', name: '@deepseek-ai/dsh-experimental-agent-team' },
    { id: 'tool-agent-team', name: '@deepseek-ai/dsh-experimental-tool-agent-team', config: { freshProvider: 'spawn', forkProvider: 'fork', interrupt: true } },
    { id: 'ui-agent-team', name: '@deepseek-ai/dsh-experimental-client-ui-agent-team' },
  );
}
insert.push(
  { id: 'dsh-team-roles', name: pathToFileURL(join(project, 'src/roles/index.mjs')).href, config: { stateDirectory: config.stateDirectory, leadRole: config.leadRole, roles: config.roles } },
  { id: 'dsh-team-bridge', name: pathToFileURL(join(project, 'src/bridge/index.mjs')).href, config: { stateDirectory: config.stateDirectory, socketPath: config.socketPath, allowedRoots: config.allowedRoots } },
);
rows.push({ insert });
await writeFile(outputPath, `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ overlayPath: outputPath, runtimeCommand: '/Users/mxr/.local/bin/dsh', arguments: ['web', '--patch', outputPath, '--no-open'], cwd: '/Users/mxr/github/deepseek/deepseek-harness', socketParent: dirname(config.socketPath) }));
