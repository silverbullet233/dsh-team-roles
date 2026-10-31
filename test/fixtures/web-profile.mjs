/** Ordinary official Web bundle with bounded, keyless test-owned services. */
import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { boot, composeEntries, loadProfileDirectory, readProfilePatches, createRuntimeResolution, PluginPackages } from '@deepseek-ai/dsh-app-boot';
import { CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { textChunks } from './native-harness.mjs';
const home = resolve(process.argv[2]);
const dir = join(home, 'profiles', 'owned-web-test');
const installAnchor = resolve('node_modules/@deepseek-ai/dsh/package.json');
const profile = loadProfileDirectory('dsh', dir, installAnchor);
const facts = { name: 'owned-web-test', dir, installAnchor, patchPath: join(dir, 'cordis.patch.yml'), cwd: await realpath(join(home, 'fixture')), home, startedBundles: profile.layers.map(layer => layer.packageName), overlays: [] };
await mkdir(facts.cwd, { recursive: true });
const patches = readProfilePatches('dsh', facts);
const composed = composeEntries([patches]);
assert.equal(composed.find(entry => entry.id === 'credentials')?.disabled, true, 'Disable the native file credential row before any test host starts');
assert(composed.some(entry => entry.name === 'cordis:fixtureCredentials' && !entry.disabled), 'Insert the in-memory fixture as a distinct native row');
const resolution = await createRuntimeResolution({ installAnchor, profile, home });
class FixtureCredentials extends CredentialProvider {
  async resolve() { return undefined; }
  async describe() { return { configured: false, writable: false }; }
  async set() { throw new Error('Test credentials are read-only'); }
  async unset() { throw new Error('Test credentials are read-only'); }
  async readRecord() { return undefined; }
  async describeRecord() { return { configured: false, writable: false }; }
  async listRecords() { return []; }
  async deleteRecord() { throw new Error('Test credentials are read-only'); }
  async modifyRecord(_key, mutate) {
    const record = { kind: 'grant', payload: { version: 1, secret: Buffer.alloc(32, 71).toString('base64url') } };
    if (await mutate(record) !== undefined) throw new Error('Test credential replacement refused');
    return record;
  }
}
let requests = 0;
const adapter = { inject: ['llm', 'agents', 'tools'], apply(ctx) {
  class FixtureAdapter extends LlmAdapter {
    async listModels(provider) { return [{ provider, id: 'fixture-model', name: 'Keyless Web fixture' }]; }
    async resolveModel(provider, id) { if (id !== 'fixture-model') throw new Error('Unknown synthetic model'); return { provider, id, name: 'Keyless Web fixture' }; }
    async *stream(options) {
      if (++requests > 8 || options.provider !== 'fixture-web' || options.model !== 'fixture-model' || options.messages.length > 16) throw new Error('Bounded synthetic test limit exceeded');
      yield* textChunks('KEYLESS_WEB_COMPLETE');
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['fixture-web'], new FixtureAdapter()));
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.cwd !== facts.cwd) throw new Error('The Web test only accepts its synthetic workspace');
    agent.options.maxTokens = 512;
    agent.ctx.tools.restrict({ allow: [] });
  }, { prepend: true });
} };
const ctx = await boot('web-test', join(dir, 'cordis.yml'), patches, async ctx => {
  ctx.provide('profileContext', facts);
  ctx.provide('webStartup', { host: '127.0.0.1', port: Number(process.argv[3] ?? 0), openBrowser: false, trustedHosts: [] });
  ctx.provide('appReady', { onReady: listener => { listener(); return () => {}; } });
  Object.assign(ctx.loader.builtins, { fixtureCredentials: FixtureCredentials, fixtureAdapter: adapter });
  await ctx.plugin(PluginPackages, { resolution });
});
const origin = ctx.webServer.getOrigin();
// The launch capability stays in an owned 0600 temporary file; stdout is clean.
await writeFile(join(home, 'web-entry.json'), JSON.stringify({ url: ctx.connection.authenticatedUrl(origin), origin, pid: process.pid, cwd: facts.cwd }), { mode: 0o600 });
console.log(JSON.stringify({ ready: true, origin, home, pid: process.pid }));
for (const event of ['SIGTERM', 'SIGINT']) process.once(event, async () => { await ctx.fiber.dispose(); process.exit(0); });
await readFile(join(home, 'web-entry.json'));
