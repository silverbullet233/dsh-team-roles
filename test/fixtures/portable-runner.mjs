/** Isolated packed-plugin exercise using the official launcher resolution and native app boot. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';

const [runtimeArgument, home, profileName, mode = 'positive'] = process.argv.slice(2);
const runtime = await realpath(runtimeArgument);
const app = await import(pathToFileURL(join(runtime, 'packages/boot/app-boot/lib/index.js')).href);
const profileDir = join(home, 'profiles', profileName);
const installAnchor = join(runtime, 'apps/cli/package.json');
const profile = app.loadProfileDirectory('dsh', profileDir, installAnchor);
const facts = { name: profileName, dir: profileDir, installAnchor, patchPath: join(profileDir, 'cordis.patch.yml'), cwd: join(home, 'keyless/fixture'), home, startedBundles: profile.bundles ?? ['dsh-team-roles'], overlays: [] };
await mkdir(facts.cwd, { recursive: true });
process.env.TMPDIR = join(home, 'tmp');
await mkdir(process.env.TMPDIR, { recursive: true });
const patches = app.readProfilePatches('dsh', facts);
const resolution = await app.createRuntimeResolution({ installAnchor, profile, home });
let fixture;
const ctx = await app.boot('portability', join(profileDir, 'cordis.yml'), patches, async ctx => {
  ctx.provide('profileContext', facts);
  ctx.provide('appReady', { onReady: listener => { listener(); return () => {}; } });
  await ctx.plugin(app.PluginPackages, { resolution });
  const { mountPortableStack } = await import('./portable-stack.mjs');
  const nativeRequire = createRequire(join(runtime, 'node_modules/.pnpm/node_modules/__fixture__.cjs'));
  fixture = await mountPortableStack(ctx, { root: join(home, 'keyless'), nativeImport: specifier => import(pathToFileURL(nativeRequire.resolve(specifier)).href) });
  const [{ default: ConfigEditor }, { default: Settings }] = await Promise.all([import('@deepseek-ai/dsh-config-editor'), import('@deepseek-ai/dsh-settings')]);
  await ctx.plugin(ConfigEditor); await ctx.plugin(Settings);
  if (mode === 'missing-api') { const { AgentModel } = await import('@deepseek-ai/dsh-agent'); AgentModel.prototype.select = undefined; }
});
const socketPath = join(home, 'tmp', `dsh-agent-team-${process.getuid()}`, 'native.sock');
let nextId = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId, socket = createConnection(socketPath); let body = '';
  socket.on('error', reject);
  socket.once('connect', () => socket.write(JSON.stringify({ protocol: 1, id, method, params }) + '\n'));
  socket.on('data', chunk => { body += chunk; });
  socket.once('end', () => { const result = JSON.parse(body); if (result.error) reject(Object.assign(new Error(result.error.message), result.error)); else resolve(result.result); });
});
try {
  if (mode === 'missing-api') {
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'dsh-agent-team');
    await assert.rejects(async () => { await entry.fiber.await(); }, error => error.code === 'DSH_RUNTIME_INCOMPATIBLE' && /agent.model.select\/current/.test(error.message));
    assert.equal(ctx.get('teamRoleSettings'), undefined);
    await assert.rejects(lstat(socketPath), error => error.code === 'ENOENT');
    console.log(JSON.stringify({ missingApiRejected: true, code: 'DSH_RUNTIME_INCOMPATIBLE', socketOpened: false, nativeRequests: fixture.requests.length }));
  } else {
  assert(ctx.get('teamRoleSettings'), 'Packed native settings service must activate');
  const health = await call('health');
  assert.equal(health.ok, true); assert.equal(health.roles.configured, false);
  assert(health.runtime.runtimeDirectory.startsWith(runtime));
  const { until } = await import('./portable-stack.mjs');
  const nativeTeam = await call('create', { key: 'native-default', cwd: fixture.fixtureRoot, text: 'Synthetic unconfigured native Lead.' });
  const nativeLead = ctx.agents.get(nativeTeam.teamId);
  await until(() => fixture.requests.some(request => request.sessionId === nativeLead.id) && nativeLead.status === 'idle');
  const nativeSelection = { provider: 'fixture-new', model: 'fixture-alternate', reasoningEffort: 'high' };
  nativeLead.model.select(nativeSelection);
  await call('send', { teamId: nativeLead.id, inputId: 'native-selection', text: 'Synthetic native selection follow-up.' });
  await until(() => fixture.requests.filter(request => request.sessionId === nativeLead.id).length >= 2 && nativeLead.status === 'idle');
  const nativeChild = await ctx.agentTeams.spawnTeammate(nativeLead, { name: 'native-inherited', description: 'Synthetic inherited native model.', prompt: [{ type: 'text', text: 'Synthetic native inherited request.' }], context: 'fresh', provider: 'spawn', signal: new AbortController().signal });
  await until(() => fixture.requests.some(request => request.sessionId === nativeChild.member.id));
  const inheritedRequest = fixture.requests.find(request => request.sessionId === nativeChild.member.id);
  assert.deepEqual({ provider: inheritedRequest.provider, model: inheritedRequest.model, reasoningEffort: inheritedRequest.reasoningEffort }, nativeSelection);
  assert.equal(await ctx.dshRoles.leads.read(nativeLead.id), null);
  const { fixtureRoles } = await import('./portable-stack.mjs');
  const catalog = { leadRole: 'lead', roles: Object.entries(fixtureRoles).map(([name, fields]) => ({ name, ...fields })) };
  const describe = () => ctx.settings.describe().find(row => row.ns === 'dsh-agent-team');
  const revision = describe().revision;
  await ctx.teamRoleSettings.save(catalog, revision);
  await assert.rejects(ctx.teamRoleSettings.save(catalog, revision), /changed since it was read/);
  const invalid = structuredClone(catalog); invalid.roles[0].model = 'synthetic-invalid-model';
  const before = await readFile(facts.patchPath, 'utf8');
  await assert.rejects(ctx.teamRoleSettings.save(invalid, describe().revision), /not in the native catalog/);
  assert.equal(await readFile(facts.patchPath, 'utf8'), before);
  const created = await call('create', { key: 'packed-team', cwd: fixture.fixtureRoot, text: 'Synthetic packed native Team request.' });
  const lead = ctx.agents.get(created.teamId); await lead.whenIdle();
  const signal = new AbortController().signal;
  const child = await ctx.dshRoles.spawn(lead, { name: 'packed-left', role: 'left', prompt: 'Synthetic packed child request.', signal });
  await new Promise((resolve, reject) => {
    const limit = setTimeout(() => reject(new Error('Packed child request timed out')), 5000);
    const poll = () => { if (fixture.requests.some(request => request.sessionId === child.member.id)) { clearTimeout(limit); resolve(); } else setTimeout(poll, 10); }; poll();
  });
  const status = await call('status', { teamId: created.teamId });
  assert(status.members.some(member => member.memberId === child.member.id));
  assert.equal(fixture.requests.find(request => request.sessionId === child.member.id).provider, 'fixture-left');
  const nativeStatus = await call('status', { teamId: nativeLead.id });
  assert(nativeStatus.teamActivity.members.some(member => member.id === nativeChild.member.id));
  assert.equal(nativeStatus.members.length, 0);
  await ctx.teamRoleSettings.save({ leadRole: '', roles: [] }, describe().revision);
  assert.equal((await call('health')).roles.configured, false);
  assert.equal((await ctx.dshRoles.prepareLead(lead.id)).provider, 'fixture-lead');
  assert.equal(await ctx.dshRoles.prepareLead('synthetic-after-clear'), null);
  const ownPackage = ctx.pluginPackages.packageOf('dsh-team-roles', pathToFileURL(join(profileDir, 'package.json')).href);
  assert.equal((await lstat(ownPackage.dir)).isSymbolicLink(), false);
  assert.equal((await readFile(join(ownPackage.dir, 'package.json'), 'utf8')).includes('silverbullet233/dsh-team-roles/'), false);
  const moduleTargets = health.runtime.resolvedModules;
  assert(Object.values(moduleTargets).every(path => path.startsWith(runtime + '/')));
  const evidence = { package: ownPackage.name, version: ownPackage.version, packageDir: ownPackage.dir, runtime: health.runtime.runtimeDirectory, nativeModuleIdentityChecked: true, manualPluginLinks: false, configuredBeforeSave: health.roles.configured, nativeEmptyTeamCreated: true, inheritedRoute: nativeSelection, clearedCatalogSaved: true, existingManagedBindingRetained: true, settingsSaved: true, staleRejected: true, invalidRejected: true, teamId: created.teamId, memberId: child.member.id, members: status.members.length, keylessRequests: fixture.requests.length };
  await writeFile(join(home, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  }
} finally { await ctx.fiber.dispose(); }
