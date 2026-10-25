/** Compose role policy and IPC into an already running native Web profile. */
import Roles from './roles/index.mjs';
import * as Bridge from './bridge/index.mjs';
import { Config } from './settings/schema.mjs';
import { catalogValue, validateCatalog } from './settings/catalog.mjs';
import { TeamRoleSettings } from './settings/index.mjs';
export { Config };

export const name = 'dsh-agent-team';
export const inject = ['agents', 'sessions', 'agentTeams', 'sessionController', 'connection', 'typertGateway', 'sessionProjections', 'workspaceRegistry', 'tools', 'systemPrompt', 'llm', 'sessionPersistence', 'settings', 'typert'];

export async function apply(ctx, config) {
  const value = config.catalog.get();
  const resolved = await validateCatalog(ctx.llm, value);
  const roles = { stateDirectory: config.stateDirectory, leadRole: resolved.leadRole, roles: Object.fromEntries(Object.entries(resolved.roles).map(([name, { role, ...fields }]) => [name, fields])) };
  await ctx.plugin(Roles, roles);
  await ctx.inject(['dshRoles'], child => { child.dshRoles.catalogSource = () => catalogValue(config.catalog.get()); });
  await ctx.plugin(TeamRoleSettings, { hostContext: ctx, config });
  await ctx.plugin(Bridge, { stateDirectory: config.stateDirectory, socketPath: config.socketPath, allowedRoots: config.allowedRoots });
  if (config.validation !== undefined) {
    if (config.validation.mode !== 'live' || config.validation.allowOtherSessions !== true) throw new Error('Existing-host validation must be live, synthetic-only, and leave unrelated Sessions untouched.');
    const { default: AgentPreset } = await import('@deepseek-ai/dsh-agent-preset');
    await ctx.plugin(AgentPreset, { id: 'dsh-team-synthetic', name: 'Synthetic Team validation', plugins: [{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'You are a synthetic arithmetic fixture agent. Use only the supplied fixture tools and native Team coordination. No personal files, repository source, shell or network tools are available.', complete: true, includeRuntimeContext: false } }] });
    const validation = await import('../scripts/live/host-fixture.mjs');
    await ctx.plugin(validation, config.validation);
  }
}
