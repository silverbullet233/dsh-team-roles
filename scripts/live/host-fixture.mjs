/** Restricted validation plugin loaded by the official native Web profile. */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { syntheticFiles } from '../../test/fixtures/synthetic-files.mjs';
import { createSyntheticAuditor } from '../../test/fixtures/audit.mjs';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';

export const name = 'dsh-team-synthetic-validation';
export const inject = ['llm', 'agents', 'sessions', 'dshRoles', 'tools', 'credentials', 'agentTeams'];

export async function apply(ctx, config) {
  const fixtureRoot = resolve(config.fixtureRoot);
  const files = await syntheticFiles(fixtureRoot);
  let existingRequests = 0;
  try { existingRequests = (await readFile(config.auditPath, 'utf8')).trim().split('\n').filter(Boolean).length; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const audit = createSyntheticAuditor({ auditPath: config.auditPath, maxRequests: config.maxRequests - existingRequests, maxPayloadBytes: 196608 });
  if (config.mode === 'keyless') {
    class KeylessAdapter extends LlmAdapter {
      async listModels() { return [{ id: 'fixture-model', name: 'Synthetic keyless model' }]; }
      async resolveModel(provider, id) { return { provider, id, name: id, defaultMaxTokens: config.maxOutputTokens, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } }; }
      async *stream(options) {
        const serialized = JSON.stringify(options.messages);
        const calls = options.messages.flatMap(message => message.content).filter(block => block.type === 'tool-call');
        let nextCalls = [];
        const agent = ctx.agents.get(options.sessionId);
        if (serialized.includes('CREATE_SYNTHETIC_TEAM')) {
          const members = ctx.agentTeams.listMembers(agent);
          if (!members.some(member => member.name === 'left-one')) nextCalls.push(['spawn_role_teammate', { name: 'left-one', role: 'left', prompt: 'Use fixture tools to read left.txt, write its sum to left-result.txt, and tell lead the result.' }]);
          if (!members.some(member => member.name === 'right-one')) nextCalls.push(['spawn_role_teammate', { name: 'right-one', role: 'right', prompt: 'Use fixture tools to read right.txt, write its sum to right-result.txt, and tell lead the result.' }]);
          if (!nextCalls.length) {
            const task = ctx.agentTeams.listTasks(agent)[0];
            if (!task) nextCalls = [['team_task_create', { subject: 'Synthetic native Team arithmetic', description: 'Read the two short fixture expressions and report 5 and 11.' }]];
            else if (task.status === 'pending') nextCalls = [['team_task_update', { task_id: task.id, expected_revision: task.revision, action: 'claim' }]];
            else if (task.status === 'in_progress') nextCalls = [['team_task_update', { task_id: task.id, expected_revision: task.revision, action: 'complete' }]];
          }
        } else if (serialized.includes('write its sum')) {
          const side = serialized.includes('Role: left') ? 'left' : 'right';
          const sum = side === 'left' ? '5' : '11';
          if (!calls.some(call => call.name === 'fixture_read')) nextCalls = [['fixture_read', { name: `${side}.txt` }]];
          else if (!calls.some(call => call.name === 'fixture_write')) nextCalls = [['fixture_write', { name: `${side}-result.txt`, text: sum }]];
          else if (!calls.some(call => call.name === 'send_message')) nextCalls = [['send_message', { target: 'lead', message: `Synthetic ${side} result: ${sum}.` }]];
        }
        if (nextCalls.length) {
          for (const [index, [name, args]] of nextCalls.entries()) {
            const argumentsText = JSON.stringify(args);
            yield { type: 'block-start', index, blockType: 'tool-call' };
            yield { type: 'tool-call-delta', index, id: `fixture-${options.sessionId}-${calls.length}-${index}`, name, argumentsDelta: argumentsText };
            yield { type: 'block-end', index, block: { type: 'tool-call', id: `fixture-${options.sessionId}-${calls.length}-${index}`, name, arguments: argumentsText } };
          }
          yield { type: 'finish', reason: { kind: 'tool-calls' } };
          return;
        }
        const value = serialized.includes('CREATE_SYNTHETIC_TEAM') ? 'KEYLESS_NATIVE_TEAM_COMPLETE: left=5, right=11.' : 'KEYLESS_NATIVE_WEB_OK';
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: value };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: value } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.effect(() => ctx.llm.registerAdapter(['fixture-native'], new KeylessAdapter()));
  }
  const installs = [];
  ctx.on('agent/created', async ({ agent }) => {
    if (agent.session.header.cwd !== fixtureRoot) return;
    agent.options.maxTokens = config.maxOutputTokens;
    installs.push(agent.ctx.tools.restrict({ allow: [] }));
    const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
    installs.push(agent.ctx.tools.register(defineTool({ name: 'fixture_read', description: 'Read one short synthetic fixture file.', parameters: { name: { type: 'string', required: true, enum: ['nonce.txt', 'left.txt', 'right.txt', 'left-result.txt', 'right-result.txt'] } }, output, execute: args => files.read(args.name) })));
    installs.push(agent.ctx.tools.register(defineTool({ name: 'fixture_write', description: 'Write at most 256 bytes to an allowlisted synthetic result file.', parameters: { name: { type: 'string', required: true, enum: ['left-result.txt', 'right-result.txt'] }, text: { type: 'string', required: true } }, output, execute: async args => JSON.stringify(await files.write(args.name, args.text)) })));
  });
  ctx.on('llm/stream', async function* (options, next) {
    const session = ctx.sessions.get(options.sessionId);
    if (!session || session.header.cwd !== fixtureRoot) {
      if (config.allowOtherSessions === true) { yield* next(); return; }
      throw new Error('Validation inference is restricted to its fresh synthetic Session.');
    }
    const exactRoute = config.mode === 'keyless'
      ? options.provider === 'fixture-native' && options.model === 'fixture-model'
      : (options.provider === 'deepseek-account' && options.model === 'deepseek-flash') || (options.provider === 'opencode-go' && options.model === 'deepseek-v4.1-flash');
    if (!exactRoute || options.reasoningEffort !== 'max') throw new Error('Validation inference route or effort differs from the authorized exact route.');
    if (!Number.isSafeInteger(options.maxTokens) || options.maxTokens > config.maxOutputTokens) throw new Error('Validation inference has no authorized output cap.');
    await audit(options);
    if (config.mode === 'live') {
      let permitted = false;
      try { permitted = JSON.parse(await readFile(join(config.stateRoot, 'inference-permission.json'), 'utf8')).syntheticPayloadReviewed === true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!permitted) throw new Error('Synthetic payload preflight recorded; inference remains disabled pending review.');
    }
    yield* next();
  });
  ctx.effect(() => () => { for (const dispose of installs.reverse()) dispose(); }, 'synthetic validation tools');
  const nativeOpenCodeEnv = launchEnvironmentOf(ctx).get('OPENCODE_API_KEY');
  const openCodeRecord = await ctx.credentials.describeRecord('llm-pi-ai/opencode-go');
  const openCodeRef = await ctx.credentials.describe('OPENCODE_API_KEY');
  await writeFile(join(config.stateRoot, 'fixture-ready.json'), JSON.stringify({ mode: config.mode, fixtureRoot, maxRequests: config.maxRequests, maxOutputTokens: config.maxOutputTokens, opencodeCredentialConfigured: openCodeRecord.configured || openCodeRef.configured || Boolean(nativeOpenCodeEnv?.value), nativeOpenCodeEnvConfigured: Boolean(nativeOpenCodeEnv?.value), nativeOpenCodeEnvSource: nativeOpenCodeEnv?.source ?? null }) + '\n', { mode: 0o600 });
}
