import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { createSyntheticAuditor } from './audit.mjs';
import { syntheticFiles } from './synthetic-files.mjs';

export const fixtureRoles = {
  lead: { description: 'Coordinate synthetic fixture work.', instructions: 'Use only synthetic text and native Team coordination. Preserve member identity on follow-up.', provider: 'fixture-lead', model: 'fixture-model', reasoningEffort: 'max' },
  left: { description: 'Compute the left synthetic fixture.', instructions: 'LEFT_ROLE_V1: Process only the synthetic left fixture.', provider: 'fixture-left', model: 'fixture-model', reasoningEffort: 'max' },
  right: { description: 'Compute the right synthetic fixture.', instructions: 'RIGHT_ROLE_V1: Process only the synthetic right fixture.', provider: 'fixture-right', model: 'fixture-model', reasoningEffort: 'max' },
};

export function textChunks(text) {
  return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }];
}

export function toolChunks(name, args, id = 'synthetic-call') {
  const serialized = JSON.stringify(args);
  return [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: serialized }, { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: serialized } }, { type: 'finish', reason: { kind: 'tool-calls' } }];
}

/** Wait for a native condition; the timer bounds a state observation rather than deciding it. */
export async function until(check, { timeout = 10000, description = 'native state' } = {}) {
  const deadline = Date.now() + timeout;
  while (true) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Keyless actual released native stack. Only browser credentials are deterministic in-memory fixtures. */
export async function mountNativeHost({ root, roles = fixtureRoles, respond = () => textChunks('SYNTHETIC_COMPLETE'), maxRequests = 40, onRequest, managed = true } = {}) {
  const [cordis, testkit, agentLoop, persistence, query, subagent, spawn, team, teamTools, typert, gateway, access, connection, storage, storageJson, storageDomain, workspace, approval, llm, tools, rolesPlugin, teamPlugin] = await Promise.all([
    import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-agent-loop-testkit'), import('@deepseek-ai/dsh-agent-loop'), import('@deepseek-ai/dsh-session-persistence-jsonl'), import('@deepseek-ai/dsh-session-query'), import('@deepseek-ai/dsh-subagent'), import('@deepseek-ai/dsh-subagent-spawn-in-process'), import('@deepseek-ai/dsh-experimental-agent-team'), import('@deepseek-ai/dsh-experimental-tool-agent-team'), import('@deepseek-ai/dsh-typert-registry'), import('@deepseek-ai/dsh-api-gateway'), import('@deepseek-ai/dsh-api-remote-access'), import('@deepseek-ai/dsh-client-connection'), import('@deepseek-ai/dsh-storage'), import('@deepseek-ai/dsh-storage-json'), import('@deepseek-ai/dsh-storage-domain'), import('@deepseek-ai/dsh-workspace'), import('@deepseek-ai/dsh-user-approval'), import('@deepseek-ai/dsh-llm'), import('@deepseek-ai/dsh-tools'), import('../../src/roles/index.mjs'), import('../../src/teams/index.mjs'),
  ]);
  await mkdir(root, { recursive: true, mode: 0o700 });
  root = await realpath(root);
  const fixtureRoot = join(root, 'fixture');
  const files = await syntheticFiles(fixtureRoot);
  const requests = [];
  const auditPath = join(root, 'audit.jsonl');
  const audit = createSyntheticAuditor({ auditPath, maxRequests });
  const ctx = new cordis.Context();
  try {
    await ctx.plugin(typert.TypertRegistry);
    await testkit.mountAgentLoopTestDependencies(ctx, { workingDirectory: true, systemPrompt: { personaPrefix: 'You are a synthetic arithmetic fixture agent. No personal data, repository source, shell or network operations are available.' } });
    await ctx.plugin(persistence, { root: join(root, 'sessions'), compression: 'none' });
    class PointQuery extends query.default {
      async searchSessions() { throw new Error('Search is not part of the synthetic fixture.'); }
      async searchEvents() { throw new Error('Search is not part of the synthetic fixture.'); }
    }
    await ctx.plugin(PointQuery);
    await ctx.plugin(agentLoop.default, { agents: [] });
    await ctx.plugin(subagent.default);
    await ctx.plugin(spawn, { providerName: 'spawn' });
    await ctx.plugin(team.default);
    await ctx.plugin(teamTools, { interrupt: false, freshProvider: 'spawn', forkProvider: 'fork' });
    await ctx.plugin(approval.default, { policy: 'ask' });
    class FixtureAdapter extends llm.LlmAdapter {
      async listModels(provider) { return ['fixture-model', 'fixture-alternate'].map(id => ({ provider, id, name: id })); }
      async resolveModel(provider, model) { return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultEffort: 'max' } }; }
      async *stream(options) {
        await audit(options);
        requests.push(options);
        await onRequest?.(options, ctx);
        const response = await respond(options, ctx);
        if (response === 'hang') {
          if (options.signal?.aborted) throw options.signal.reason;
          await once(options.signal, 'abort');
          throw options.signal.reason ?? new Error('Synthetic call aborted.');
        }
        for await (const chunk of response) { options.signal?.throwIfAborted(); yield chunk; }
      }
    }
    ctx.effect(() => ctx.llm.registerAdapter(['fixture-lead', 'fixture-left', 'fixture-right', 'fixture-new'], new FixtureAdapter()));
    const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
    ctx.effect(() => ctx.tools.register(tools.defineTool({ name: 'fixture_read', description: 'Read one allowlisted short synthetic fixture file.', parameters: { name: { type: 'string', required: true, enum: ['nonce.txt', 'left.txt', 'right.txt', 'left-result.txt', 'right-result.txt'] } }, output, execute: (args) => files.read(args.name) })));
    ctx.effect(() => ctx.tools.register(tools.defineTool({ name: 'fixture_write', description: 'Write at most 256 bytes to one allowlisted synthetic result file.', parameters: { name: { type: 'string', required: true, enum: ['left-result.txt', 'right-result.txt'] }, text: { type: 'string', required: true } }, output, execute: async (args) => JSON.stringify(await files.write(args.name, args.text)) })));
    const roleConfig = { stateDirectory: join(root, 'role-state'), leadRole: 'lead', spawnProvider: 'spawn', roles };
    const roleFiber = await ctx.plugin(rolesPlugin.default, roleConfig);
    await ctx.plugin(storage.default);
    await ctx.plugin(storageJson, { root: join(root, 'storage') });
    await ctx.plugin(storageDomain, { backend: 'json', routes: {} });
    await ctx.plugin(workspace.default);
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture-lead', model: 'fixture-model', reasoningEffort: 'max' }), saveSelection: () => { throw new Error('Role routing must not save a global default.'); } });
    ctx.provide('attachments', { imageLimits: { maxImageBytes: 1024, maxImagesPerMessage: 1, maxMessageImageBytes: 1024, maxImagePixels: 1024, maxImageDimension: 32, mediaTypes: ['image/png'] }, admitPromptContent: async (content) => { if (content.some((part) => part.type !== 'text')) throw new Error('Synthetic fixture is text-only.'); return content; } });
    ctx.provide('fileUploads', { registerAgentResolver: () => () => {}, resolve: () => undefined, bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }), retirePrompt() {} });
    // This fixed record is confined to memory and is never exported, persisted or used in a browser.
    const existingFixtureRecord = { kind: 'grant', payload: { version: 1, secret: Buffer.alloc(32, 19).toString('base64url') } };
    ctx.provide('credentials', { modifyRecord: async (_key, mutate) => { if (await mutate(existingFixtureRecord) !== undefined) throw new Error('Fixture credentials are read-only.'); return existingFixtureRecord; } });
    await ctx.plugin(access.default);
    await ctx.plugin(connection);
    await ctx.plugin(gateway.default);
    const controller = await import('@deepseek-ai/dsh-api-session-controller');
    const metadata = await import('@deepseek-ai/dsh-api-session-controller/typert');
    ctx.effect(() => ctx.typert.register(metadata.TYPERT));
    await ctx.plugin(controller.default, { nativeOpen: false });
    if (managed) await ctx.plugin(teamPlugin, { stateDirectory: join(root, 'bridge-state'), allowedRoots: [fixtureRoot] });
    else {
      const [{ z }, { teamObservationProjection }] = await Promise.all([import('zod'), import('../../src/teams/projection.mjs')]);
      await ctx.sessionProjections.register(teamObservationProjection(z));
    }
    const clientModule = await import('./client.mjs');
    return { ctx, root, fixtureRoot, files, auditPath, requests, roleFiber, rolePlugin: rolesPlugin.default, roleConfig, client: new clientModule.NativeClient({ ctx }), dispose: () => ctx.fiber.dispose() };
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}
