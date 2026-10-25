/** Real Cordis profile/Loader/Settings transaction fixture, with a keyless native LLM registry. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot';
import ConfigEditor from '@deepseek-ai/dsh-config-editor';
import Settings from '@deepseek-ai/dsh-settings';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { Config } from '../../src/settings/schema.mjs';
import { TeamRoleSettings } from '../../src/settings/index.mjs';
import { fixtureRoles } from './native-harness.mjs';
import Hmr from '@deepseek-ai/dsh-hmr';
import Timer from '@deepseek-ai/cordis-plugin-timer';
import { catalogFromLegacy, validateCatalog } from '../../src/settings/catalog.mjs';

export async function settingsFixture(t, { hmr = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'team-role-settings-'));
  const dir = join(home, 'profiles/test');
  initProfile(dir, ['test-bundle']);
  const bundle = join(dir, 'node_modules/test-bundle');
  await mkdir(bundle, { recursive: true });
  await writeFile(join(home, 'package.json'), '{"name":"synthetic-settings-installation"}\n');
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }));
  const catalog = catalogFromLegacy({ leadRole: 'lead', roles: fixtureRoles });
  await writeFile(join(home, 'legacy.json'), JSON.stringify(catalog));
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' }, { id: 'typert', name: 'cordis:typert' },
    { id: 'llm', name: 'cordis:llm' }, { id: 'fixture-adapter', name: 'cordis:adapter' },
    { id: 'dsh-agent-team', name: 'cordis:roles', config: { stateDirectory: join(home, 'state'), socketPath: join(home, 'ipc.sock'), allowedRoots: [home], catalog: { __jsExpr: `JSON.parse(process.getBuiltinModule('node:fs').readFileSync(${JSON.stringify(join(home, 'legacy.json'))}, 'utf8'))` } } },
  ] }]));
  await writeFile(join(dir, 'cordis.yml'), '[]\n');
  const profile = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [] };
  const contexts = [];
  const start = async () => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
      ctx.provide('profileContext', profile);
      ctx.provide('appReady', { onReady: listener => { listener(); return () => {}; } });
      Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, typert: TypertRegistry, llm: Llm,
        adapter: { inject: ['llm'], apply(ctx) {
          class Adapter extends LlmAdapter {
            async listModels(provider) { return [{ provider, id: 'fixture-model', name: 'Synthetic model' }]; }
            async resolveModel(provider, id) { return { provider, id, name: 'Synthetic model', reasoning: { efforts: [{ id: 'max', name: 'Max' }] } }; }
            async *stream() { throw new Error('Settings never invoke inference'); }
          }
          ctx.effect(() => ctx.llm.registerAdapter(['fixture-lead', 'fixture-left', 'fixture-right', 'fixture-new'], new Adapter()));
        } },
        roles: { Config, inject: ['settings', 'typert', 'llm'], async apply(ctx, config) {
          await validateCatalog(ctx.llm, config.catalog.get());
          await ctx.plugin(TeamRoleSettings, { hostContext: ctx, config });
        } },
      });
    });
    contexts.push(ctx);
    if (hmr) { await ctx.plugin(Timer); await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 }); await ctx.hmr.runExclusive(async () => {}); }
    if (!ctx.get('teamRoleSettings')) throw new Error('Native settings fixture failed to activate');
    return ctx;
  };
  t.after(async () => { for (const ctx of contexts.reverse()) await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }); });
  return { ctx: await start(), catalog, profile, start, read: () => readFile(profile.patchPath, 'utf8') };
}
