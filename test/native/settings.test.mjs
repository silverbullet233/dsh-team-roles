import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsFixture } from '../fixtures/settings.mjs';
const descriptor = ctx => ctx.settings.describe().find(row => row.ns === 'dsh-agent-team');

test('native role settings persist atomically, reject stale drafts and reopen with the saved catalog', async t => {
  const { ctx, catalog, read, start } = await settingsFixture(t);
  const initial = descriptor(ctx);
  assert.equal(initial.autoGenerate, false);
  const next = structuredClone(catalog);
  next.roles[1].instructions = 'Synthetic instructions edited in native Settings.';
  const saved = await ctx.teamRoleSettings.save(next, initial.revision);
  assert.equal(saved.applies, 'new-members');
  assert.deepEqual(descriptor(ctx).value.catalog, next);
  const before = await read();
  await assert.rejects(ctx.teamRoleSettings.save(catalog, initial.revision), /changed since it was read/);
  assert.equal(await read(), before);
  await ctx.fiber.dispose();
  const reopened = await start();
  assert.deepEqual(descriptor(reopened).value.catalog, next);
});

test('native registry errors reject provider, model, effort, duplicate and missing lead without a profile write', async t => {
  const { ctx, catalog, read } = await settingsFixture(t);
  const before = await read().catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const invalid = [
    value => { value.roles[0].provider = 'unregistered'; },
    value => { value.roles[0].model = 'unregistered'; },
    value => { value.roles[0].reasoningEffort = 'unsupported'; },
    value => { value.roles.push(value.roles[0]); },
    value => { value.leadRole = 'absent'; },
  ];
  for (const change of invalid) {
    const next = structuredClone(catalog); change(next);
    await assert.rejects(ctx.teamRoleSettings.save(next, descriptor(ctx).revision));
    assert.equal(await read().catch(error => { if (error.code === 'ENOENT') return null; throw error; }), before);
  }
  const next = structuredClone(catalog); next.roles[0].model = 'raw-settings-bypass';
  await assert.rejects(ctx.settings.mutate('dsh-agent-team', [{ op: 'set', path: ['catalog'], value: next }], descriptor(ctx).revision), /Team roles settings page/);
});

test('native settings array replacement persists role removal and addition across reopen', async t => {
  const { ctx, catalog, start } = await settingsFixture(t);
  const next = structuredClone(catalog);
  next.roles = next.roles.filter(role => role.name !== 'left');
  next.roles.push({ name: 'new-role', description: 'Synthetic new role.', instructions: 'Use synthetic input only.', provider: 'fixture-new', model: 'fixture-model', reasoningEffort: 'max' });
  await ctx.teamRoleSettings.save(next, descriptor(ctx).revision);
  await ctx.fiber.dispose();
  const reopened = await start();
  assert.deepEqual(descriptor(reopened).value.catalog.roles.map(role => role.name), ['lead', 'right', 'new-role']);
});

test('native HMR disposal during route validation cancels the pending save without deadlock or persistence', { timeout: 5000 }, async t => {
  const { ctx, catalog, read } = await settingsFixture(t, { hmr: true });
  const before = await read().catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const old = ctx.llm.resolveModelInfo.bind(ctx.llm);
  ctx.llm.resolveModelInfo = async (...args) => { entered.resolve(); await release.promise; return old(...args); };
  const owner = [...ctx.loader.entries()].find(entry => entry.options.id === 'dsh-agent-team').fiber;
  const pending = ctx.teamRoleSettings.save(catalog, descriptor(ctx).revision);
  const rejected = assert.rejects(pending, /reloaded|aborted/);
  await entered.promise;
  await ctx.hmr.runExclusive(async () => { await owner.dispose(); });
  release.resolve();
  await rejected;
  assert.equal(await read().catch(error => { if (error.code === 'ENOENT') return null; throw error; }), before);
});


test('native settings can clear all roles and reopen with native defaults while partial explicit catalogs reject', async t => {
  const { ctx, start, read } = await settingsFixture(t);
  const empty = { leadRole: '', roles: [] };
  await ctx.teamRoleSettings.save(empty, descriptor(ctx).revision);
  assert.deepEqual(descriptor(ctx).value.catalog, empty);
  const before = await read();
  await assert.rejects(ctx.teamRoleSettings.save({ leadRole: 'lead', roles: [] }, descriptor(ctx).revision));
  assert.equal(await read(), before);
  await ctx.fiber.dispose();
  const reopened = await start();
  assert.deepEqual(descriptor(reopened).value.catalog, empty);
});
