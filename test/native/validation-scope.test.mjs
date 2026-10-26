import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountNativeHost, textChunks, until } from '../fixtures/native-harness.mjs';
import { nativeTeamTools, fixtureTools } from '../fixtures/audit.mjs';

test('native validation confines tool visibility and output caps to its synthetic directory while ordinary Web Sessions bypass its auditor', { timeout: 20000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-validation-scope-'));
  let host;
  t.after(async () => { await host?.dispose(); await rm(root, { recursive: true, force: true }); });
  const roles = Object.fromEntries(['lead', 'left', 'right'].map((role) => [role, {
    description: `Synthetic validation ${role}.`, instructions: `Use the synthetic ${role} role only.`, provider: 'fixture-native', model: 'fixture-model', reasoningEffort: 'max',
  }]));
  host = await mountNativeHost({ root, roles });
  const [{ defineTool }, { LlmAdapter }, { createLaunchEnvironmentSnapshot }, validation, aliasPlugin] = await Promise.all([
    import('@deepseek-ai/dsh-tools'), import('@deepseek-ai/dsh-llm'), import('@deepseek-ai/dsh-launch-environment'), import('../../scripts/live/host-fixture.mjs'), import('@deepseek-ai/dsh-tool-subagent'),
  ]);
  host.ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([]));
  Object.assign(host.ctx.credentials, {
    describe: async () => ({ configured: false }),
    describeRecord: async () => ({ configured: false }),
  });
  let forbiddenCalls = 0;
  host.ctx.tools.register(defineTool({
    name: 'forbidden_global', description: 'Synthetic global tool visibility negative control.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { forbiddenCalls++; return 'SYNTHETIC_GLOBAL_TOOL_OK'; },
  }));
  await host.ctx.plugin(aliasPlugin, { provider: 'spawn', toolName: 'delegate_custom', maxDepth: 3 });
  const validationAuditPath = join(host.root, 'validation-audit.jsonl');
  await host.ctx.plugin(validation, { mode: 'keyless', allowOtherSessions: true, fixtureRoot: host.fixtureRoot, stateRoot: host.root, auditPath: validationAuditPath, maxRequests: 8, maxOutputTokens: 4096 });
  const receipt = await host.client.request('create', { key: 'synthetic-scope', text: 'SYNTHETIC_VALIDATION_SCOPE', cwd: host.fixtureRoot });
  const agent = host.ctx.agents.get(receipt.teamId);
  await until(() => agent.status === 'idle' && agent.session.snapshotEvents().some((event) => event.type === 'request/header'));
  const result = await host.client.request('result', { teamId: receipt.teamId });
  assert.equal(result.output, 'KEYLESS_NATIVE_WEB_OK');
  assert.equal(agent.options.maxTokens, 4096);
  const firstHeader = agent.session.snapshotEvents().find((event) => event.type === 'request/header');
  assert.equal(firstHeader.data.header.config.maxTokens, 4096);
  assert.equal(host.ctx.tools.get('forbidden_global', agent), undefined);
  assert.equal(host.ctx.tools.get('delegate_custom', agent), undefined);
  const hiddenExecution = await host.ctx.tools.execute({ agent, signal: new AbortController().signal, calls: [{ type: 'tool-call', id: 'synthetic-hidden-global', name: 'forbidden_global', arguments: '{}' }] });
  assert.equal(hiddenExecution.results[0].result.isError, true);
  assert.equal(forbiddenCalls, 0);
  const audited = (await readFile(validationAuditPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(audited.length, 1);
  assert.equal(audited[0].payload.maxTokens, 4096);
  assert.equal(audited[0].provider, 'fixture-native');
  assert.equal(audited[0].reasoningEffort, 'max');
  const declarations = [...audited[0].payload.tools, ...(audited[0].payload.toolHistory?.tools ?? []), ...(audited[0].payload.toolHistory?.updates ?? []).flatMap((update) => update.additions)];
  assert(declarations.some((tool) => tool.name === 'fixture_read'));
  assert(declarations.some((tool) => tool.name === 'fixture_write'));
  assert(declarations.some((tool) => tool.name === 'spawn_role_teammate'));
  assert(declarations.every((tool) => nativeTeamTools.has(tool.name) || fixtureTools.has(tool.name)));
  assert.equal(forbiddenCalls, 0);
  const ordinaryRequests = [];
  class OrdinaryAdapter extends LlmAdapter {
    async *stream(options) { ordinaryRequests.push(options); yield* textChunks('SYNTHETIC_ORDINARY_WEB_OK'); }
  }
  host.ctx.llm.registerAdapter(['fixture-ordinary'], new OrdinaryAdapter());
  const ordinaryRoot = join(host.root, 'ordinary');
  await mkdir(ordinaryRoot, { mode: 0o700 });
  const ordinaryReceipt = await host.ctx.sessionController.create({ cwd: ordinaryRoot });
  const ordinary = host.ctx.agents.get(ordinaryReceipt.sessionId);
  ordinary.model.select({ provider: 'fixture-ordinary', model: 'fixture-model' });
  ordinary.options.maxTokens = 37;
  assert(host.ctx.tools.get('forbidden_global', ordinary));
  assert(host.ctx.tools.get('delegate_custom', ordinary));
  await host.ctx.sessionController.prompt({ sessionId: ordinary.id, requestId: 'synthetic-ordinary-validation-bypass', mode: 'queue', content: [{ type: 'text', text: 'SYNTHETIC_ORDINARY_WEB_INPUT' }] }, new AbortController().signal);
  await until(() => ordinaryRequests.length === 1 && ordinary.status === 'idle');
  assert.equal(ordinaryRequests[0].provider, 'fixture-ordinary');
  assert.equal(ordinaryRequests[0].maxTokens, 37);
  assert(ordinaryRequests[0].tools.some((tool) => tool.name === 'forbidden_global'));
  assert(ordinaryRequests[0].tools.some((tool) => tool.name === 'delegate_custom'));
  assert.match(JSON.stringify(ordinaryRequests[0].messages), /SYNTHETIC_ORDINARY_WEB_INPUT/u);
  assert.equal((await readFile(validationAuditPath, 'utf8')).trim().split('\n').length, 1);
  assert.doesNotMatch(await readFile(validationAuditPath, 'utf8'), /SYNTHETIC_ORDINARY_WEB_INPUT/u);
  const executed = await host.ctx.tools.execute({ agent: ordinary, signal: new AbortController().signal, calls: [{ type: 'tool-call', id: 'synthetic-visible-global', name: 'forbidden_global', arguments: '{}' }] });
  assert.equal(executed.results[0].result.isError, false);
  assert.equal(forbiddenCalls, 1);
});
