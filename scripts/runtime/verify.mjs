/** Verify the native modules selected by the launcher's profile resolution. */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileSha256, inspectSourceBuild, manifestText, sha256, sourceRelativeEntry } from './manifest.mjs';

const project = resolve(import.meta.dirname, '../..');
const PUBLIC_IMPORTS = {
  cordis: ['@deepseek-ai/cordis', 'vendor/cordis/lib/index.js'],
  agent: ['@deepseek-ai/dsh-agent', 'packages/core/agent/lib/index.js'],
  sessionController: ['@deepseek-ai/dsh-api-session-controller', 'packages/api/session-controller/lib/index.js'],
  sessionReflection: ['@deepseek-ai/dsh-api-session-controller/typert', 'packages/api/session-controller/lib/typert.host.js'],
  team: ['@deepseek-ai/dsh-experimental-agent-team', 'packages/experimental/agent-team/lib/index.js'],
  gateway: ['@deepseek-ai/dsh-api-gateway', 'packages/api/gateway/lib/index.js'],
};

/** Source layout is verified against the actual public Agent import, never a saved workstation path. */
export function discoverRuntime({ context, runtimeDirectory } = {}) {
  const agentEntry = realpathSync(fileURLToPath(import.meta.resolve(PUBLIC_IMPORTS.agent[0])));
  const inferred = resolve(dirname(agentEntry), '../../../..');
  const root = realpathSync(runtimeDirectory ?? inferred);
  const anchor = context?.get('profileContext')?.installAnchor;
  if (anchor !== undefined && realpathSync(anchor) !== join(root, 'apps/cli/package.json')) {
    throw new Error('The native profile installation anchor differs from the Agent runtime. Launch with the compatible official source-built dsh profile; do not install another DSH runtime in the plugin.');
  }
  if (sourceRelativeEntry(root, agentEntry) !== PUBLIC_IMPORTS.agent[1]) throw new Error('Native Agent import is outside the supported official source layout.');
  return root;
}

export async function verifyRuntime(options = {}) {
  try {
    const lock = JSON.parse(readFileSync(join(project, 'runtime-lock.json'), 'utf8'));
    const runtimeDirectory = discoverRuntime(options);
    const expectedPath = join(project, lock.build.manifest);
    if (fileSha256(expectedPath) !== lock.build.manifestSha256) throw new Error('Sealed source build manifest changed');
    const resolvedModules = {};
    for (const [key, [specifier, expected]] of Object.entries(PUBLIC_IMPORTS)) {
      const entry = realpathSync(fileURLToPath(import.meta.resolve(specifier)));
      if (sourceRelativeEntry(runtimeDirectory, entry) !== expected) throw new Error(`Native import is not from the serving source build: ${specifier}`);
      resolvedModules[key] = entry;
    }
    const [agent, controller, team, reflection] = await Promise.all([import(PUBLIC_IMPORTS.agent[0]), import(PUBLIC_IMPORTS.sessionController[0]), import(PUBLIC_IMPORTS.team[0]), import(PUBLIC_IMPORTS.sessionReflection[0])]);
    if (typeof agent.AgentModel?.prototype?.select !== 'function' || typeof agent.AgentModel?.prototype?.current !== 'function' || !agent.modelSelectionProjectionDefinition || typeof controller.SessionController !== 'function' || typeof team.TeamService?.prototype?.spawnTeammate !== 'function' || !reflection.TYPERT) throw new Error('Required agent.model.select/current, durable model selection, Team spawn or SessionController reflection APIs are missing');
    const evidence = inspectSourceBuild(runtimeDirectory);
    if (evidence.sourceSha !== lock.source.commit || evidence.dependencyLockSha256 !== lock.source.pnpmLockSha256) throw new Error('Source or dependency lock differs from the supported runtime');
    if (sha256(manifestText(evidence)) !== lock.build.manifestSha256) throw new Error('Native host, dependencies or matching Web artifacts differ from the sealed source build');
    const entrypoint = join(runtimeDirectory, 'apps/cli/lib/bin.js');
    return Object.freeze({ sourceSha: evidence.sourceSha, runtimeDirectory, entrypoint, entrypointTarget: entrypoint, resolvedAgent: resolvedModules.agent, resolvedModules: Object.freeze(resolvedModules), emissionSha256: evidence.host.sha256, compilerVersion: evidence.compilerVersion, build: Object.freeze({ kind: 'official-source-build', command: 'pnpm run build', frontend: true, typechecked: true, officialBundle: false, host: evidence.host, frontendArtifacts: evidence.frontend }), capabilities: Object.freeze({ agentModelSelect: true, agentModelCurrent: true, durableModelSelection: true, nativeTeam: true, sessionController: true, generatedReflection: true }) });
  } catch (cause) {
    const error = new Error(`dsh-team-roles cannot start: ${cause.message}. Use the complete official source build at 22ddee3792402c3e70ec5f86a63c3e3e895a2f60 with matching Web artifacts through the native dsh launcher. Released rc.3 alone is insufficient; no fallback or registry runtime was selected.`, { cause });
    error.code = 'DSH_RUNTIME_INCOMPATIBLE';
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyRuntime(), null, 2));
