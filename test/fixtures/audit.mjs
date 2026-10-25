import { appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const nativeTeamTools = new Set(['spawn_teammate', 'spawn_role_teammate', 'list_agents', 'send_message', 'wait_agent', 'interrupt_agent', 'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update']);
export const fixtureTools = new Set(['fixture_read', 'fixture_write']);

/** Persist the entire model-visible payload before permitting a synthetic call. */
export function createSyntheticAuditor({ auditPath, maxRequests = 24, maxPayloadBytes = 131072, inspect }) {
  let requests = 0;
  return async (options) => {
    if (++requests > maxRequests) throw new Error('Synthetic request limit exceeded.');
    const declaredTools = [...(options.tools ?? []), ...(options.toolHistory?.tools ?? []), ...(options.toolHistory?.updates ?? []).flatMap((update) => update.additions)];
    const toolNames = declaredTools.map((tool) => tool.name);
    const denied = toolNames.filter(name => !nativeTeamTools.has(name) && !fixtureTools.has(name));
    if (denied.length) throw new Error(`A non-allowlisted tool reached the synthetic model payload: ${[...new Set(denied)].join(', ')}`);
    const payload = { system: options.system, messages: options.messages, tools: options.tools, toolHistory: options.toolHistory, temperature: options.temperature, maxTokens: options.maxTokens, stop: options.stop };
    for (const message of payload.messages) {
      for (const block of message.content) {
        if (!['text', 'reasoning', 'tool-call', 'tool-result'].includes(block.type)) throw new Error('Only text and native tool protocol blocks are allowed in synthetic requests.');
      }
    }
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > maxPayloadBytes) throw new Error('Synthetic payload exceeds its audited byte limit.');
    if (/\/Users\//u.test(serialized)) throw new Error('A user-home path reached the synthetic model payload.');
    await inspect?.(structuredClone(payload));
    const record = { request: requests, provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort ?? null, sha256: createHash('sha256').update(serialized).digest('hex'), payload: JSON.parse(serialized) };
    await appendFile(auditPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    return record;
  };
}
