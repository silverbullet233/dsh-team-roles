/** Admission policy for native creation tools, independent of their configured names. */

const TEAM_CREATION_NAMES = new Set(['spawn_teammate', 'spawn_agent', 'fork_agent', 'subagent', 'subagent_fork', 'activate_agent', 'resume_agent']);
const DENIAL = 'This Team requires an allowlisted role through spawn_role_teammate.';

/** Recognize the pinned native tool-subagent's normalized activation output schema. */
export function isNativeActivationTool(definition) {
  const schema = definition?.output?.schema;
  return schema?.type === 'object'
    && schema.properties?.kind?.const === 'activation'
    && schema.properties?.subagentId?.type === 'string'
    && Array.isArray(schema.required)
    && schema.required.includes('kind')
    && schema.required.includes('subagentId');
}

/** Refuse native activation dispatch before a local or external backend can start. */
export function creationGuard(exec) {
  if (TEAM_CREATION_NAMES.has(exec.name)) return DENIAL;
  const agent = exec.agent;
  if (agent === undefined) return undefined;
  const definition = agent.ctx.tools.get(exec.name, agent, exec.toolSet);
  return isNativeActivationTool(definition) ? DENIAL : undefined;
}
