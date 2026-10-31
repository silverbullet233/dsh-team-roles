/** Verify the exact supported released runtime and its public APIs. */
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const project = resolve(import.meta.dirname, '../..');
export const SUPPORTED_DSH_VERSION = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).engines.dsh;
const packages = ['dsh','dsh-agent','dsh-session','dsh-session-projection','dsh-api-session-controller','dsh-experimental-agent-team','dsh-client-connection','dsh-api-gateway','dsh-typert-protocol','dsh-app-boot','dsh-web-frontend'];
export function requireSupportedVersion(actual, name = 'DSH') {
  if (actual !== SUPPORTED_DSH_VERSION) throw new Error(`${name} ${actual} is unsupported; use ${SUPPORTED_DSH_VERSION}`);
}
export function requireCapabilities({ agent, controller, team, projections, boot, reflection }) {
  const required = [
    ['agent.model.select', agent.AgentModel?.prototype?.select], ['agent.model.current', agent.AgentModel?.prototype?.current],
    ['durable model selection', agent.modelSelectionProjectionDefinition?.apply], ['Session projections', projections.SessionProjectionRegistry?.prototype?.register],
    ['native Team spawn', team.TeamService?.prototype?.spawnTeammate], ['native Team messaging', team.TeamService?.prototype?.sendMessage],
    ...['create','prompt','projections','cancel'].map(name => [`SessionController.${name}`,controller.SessionController?.prototype?.[name]]),
    ['native profile resolver',boot.createRuntimeResolution],
  ];
  for (const [name, value] of required) if (typeof value !== 'function') throw new Error(`Required ${name} API is missing`);
  if (!reflection.TYPERT?.invocations) throw new Error('Required SessionController reflection is missing');
  for (const method of ['create','prompt','projections','cancel']) if (!reflection.TYPERT.invocations.some(row=>row.namespace==='session'&&row.method===method)) throw new Error(`Required session/${method} reflection is missing`);
}
export async function verifyRuntime({ context } = {}) {
  try {
    const resolvedModules = {}, versions = {}, directories = {};
    for (const short of packages) {
      const name = `@deepseek-ai/${short}`;
      const metadataPath = realpathSync(fileURLToPath(import.meta.resolve(`${name}/package.json`)));
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
      if (metadata.name !== name) throw new Error(`Unexpected native package identity for ${name}`);
      requireSupportedVersion(metadata.version, name);
      versions[name] = metadata.version; directories[name] = dirname(metadataPath);
      if (!['dsh','dsh-web-frontend'].includes(short)) resolvedModules[short] = realpathSync(fileURLToPath(import.meta.resolve(name)));
    }
    const [agent, controller, team, projections, boot, reflection] = await Promise.all([import('@deepseek-ai/dsh-agent'),import('@deepseek-ai/dsh-api-session-controller'),import('@deepseek-ai/dsh-experimental-agent-team'),import('@deepseek-ai/dsh-session-projection'),import('@deepseek-ai/dsh-app-boot'),import('@deepseek-ai/dsh-api-session-controller/typert')]);
    requireCapabilities({agent,controller,team,projections,boot,reflection});
    resolvedModules.sessionReflection = realpathSync(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-api-session-controller/typert')));
    const frontend = directories['@deepseek-ai/dsh-web-frontend'];
    const index = join(frontend, 'dist/index.html');
    const html = readFileSync(index, 'utf8');
    const assets = [...html.matchAll(/(?:src|href)=["'](\.\/assets\/[^"']+)["']/g)].map(match => match[1]);
    if (!assets.length) throw new Error('Native Web build has no entry assets');
    for (const asset of assets) {
      const target = realpathSync(join(frontend, 'dist', asset));
      const suffix = relative(frontend, target);
      if (suffix.startsWith('..') || !existsSync(target)) throw new Error('Native Web entry asset is unavailable or outside its package');
    }
    const profile = context?.get('profileContext');
    const resolver = context?.get('pluginPackages');
    if (profile?.installAnchor) {
      const anchor = JSON.parse(readFileSync(profile.installAnchor, 'utf8'));
      if (anchor.name !== '@deepseek-ai/dsh') throw new Error('Launch the plugin through the official dsh CLI profile');
      requireSupportedVersion(anchor.version, anchor.name);
      if (!resolver?.packageOf) throw new Error('The native profile package resolver is unavailable');
      for (const [name, directory] of Object.entries(directories)) {
        const serving = resolver.packageOf(name, import.meta.url);
        if (!serving || realpathSync(serving.dir) !== directory) throw new Error(`Native package ${name} differs from the serving installation`);
      }
    }
    return Object.freeze({ packageVersion:SUPPORTED_DSH_VERSION, sourceSha:null, runtimeDirectory:directories['@deepseek-ai/dsh'], resolvedModules:Object.freeze(resolvedModules), packageVersions:Object.freeze(versions), build:Object.freeze({kind:'official-npm-release',frontend:true}), capabilities:Object.freeze({agentModelSelect:true,agentModelCurrent:true,durableModelSelection:true,nativeTeam:true,sessionController:true,generatedReflection:true}) });
  } catch (cause) {
    const error = new Error(`dsh-team-roles cannot start: ${cause.message}. Use the official @deepseek-ai/dsh@${SUPPORTED_DSH_VERSION} runtime through its native profile; no fallback was selected.`,{cause});
    error.code='DSH_RUNTIME_INCOMPATIBLE';throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyRuntime(),null,2));
