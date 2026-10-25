import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileSha256, inspectSourceBuild, manifestText, resolveInstalledEntrypoint, sha256, sourceRelativeEntry } from './manifest.mjs';

const project = resolve(import.meta.dirname, '../..');
const PUBLIC_IMPORTS = {
  cordis: ['@deepseek-ai/cordis', 'vendor/cordis/lib/index.js'],
  agent: ['@deepseek-ai/dsh-agent', 'packages/core/agent/lib/index.js'],
  sessionController: ['@deepseek-ai/dsh-api-session-controller', 'packages/api/session-controller/lib/index.js'],
  sessionReflection: ['@deepseek-ai/dsh-api-session-controller/typert', 'packages/api/session-controller/lib/typert.host.js'],
  team: ['@deepseek-ai/dsh-experimental-agent-team', 'packages/experimental/agent-team/lib/index.js'],
  gateway: ['@deepseek-ai/dsh-api-gateway', 'packages/api/gateway/lib/index.js'],
};

/** Verify the actual source-built native ESM imports and matching native Web before opening IPC. */
export async function verifyRuntime(options = {}) {
  const lock = JSON.parse(readFileSync(join(project, 'runtime-lock.json'), 'utf8'));
  const runtimeDirectory = realpathSync(options.runtimeDirectory ?? process.env.DSH_SOURCE_ROOT ?? lock.source.directory);
  const expectedPath = join(project, lock.build.manifest);
  if (fileSha256(expectedPath) !== lock.build.manifestSha256) throw new Error('Sealed source build manifest changed');
  const evidence = inspectSourceBuild(runtimeDirectory);
  if (evidence.sourceSha !== lock.source.commit || evidence.dependencyLockSha256 !== lock.source.pnpmLockSha256) throw new Error('Source or dependency lock differs from the pinned runtime');
  if (sha256(manifestText(evidence)) !== lock.build.manifestSha256) throw new Error('Native host, dependencies or matching Web artifacts differ from the sealed source build');
  const entrypoint = options.entrypoint ?? lock.entrypoint;
  const entrypointTarget = resolveInstalledEntrypoint(entrypoint);
  if (sourceRelativeEntry(runtimeDirectory, entrypointTarget) !== 'apps/cli/lib/bin.js') throw new Error('Installed DSH entrypoint differs from the verified source runtime');
  const resolvedModules = {};
  for (const [key, [specifier, expected]] of Object.entries(PUBLIC_IMPORTS)) {
    const entry = realpathSync(fileURLToPath(import.meta.resolve(specifier)));
    if (sourceRelativeEntry(runtimeDirectory, entry) !== expected) throw new Error(`Native import is not from the verified source build: ${specifier}`);
    resolvedModules[key] = entry;
  }
  const [agent, controller, team, reflection] = await Promise.all([import(PUBLIC_IMPORTS.agent[0]), import(PUBLIC_IMPORTS.sessionController[0]), import(PUBLIC_IMPORTS.team[0]), import(PUBLIC_IMPORTS.sessionReflection[0])]);
  if (typeof agent.AgentModel?.prototype?.select !== 'function' || typeof agent.AgentModel?.prototype?.current !== 'function' || !agent.modelSelectionProjectionDefinition || typeof controller.SessionController !== 'function' || typeof team.TeamService?.prototype?.spawnTeammate !== 'function' || !reflection.TYPERT) throw new Error('Required pinned native Agent/Team/SessionController APIs are unavailable');
  return Object.freeze({ sourceSha: evidence.sourceSha, runtimeDirectory, entrypoint, entrypointTarget, resolvedAgent: resolvedModules.agent, resolvedModules: Object.freeze(resolvedModules), emissionSha256: evidence.host.sha256, compilerVersion: evidence.compilerVersion, build: Object.freeze({ kind: 'official-source-build', command: 'pnpm run build', frontend: true, typechecked: true, officialBundle: false, host: evidence.host, frontendArtifacts: evidence.frontend }), capabilities: Object.freeze({ agentModelSelect: true, agentModelCurrent: true, durableModelSelection: true, nativeTeam: true, sessionController: true, generatedReflection: true }) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyRuntime(), null, 2));
