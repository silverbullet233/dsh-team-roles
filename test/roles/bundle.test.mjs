import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import Schema from '@deepseek-ai/schemastery';
import { Config } from '../../src/settings/schema.mjs';

test('installable Cordis bundle parses and native Settings can rehydrate its declarative schema', async () => {
  const patches = yaml.load(await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'), { schema: entryListSchema });
  assert.equal(patches[0].insert[0].name, 'dsh-team-roles');
  assert.equal(patches[0].insert[0].id, 'dsh-agent-team');
  const schema = new Schema(Config.toJSON());
  const result = schema['~standard'].validate({ stateDirectory: '/synthetic/state', allowedRoots: ['/synthetic'], catalog: { leadRole: 'lead', roles: [{ name: 'lead', description: 'Synthetic role.', instructions: 'Synthetic instructions.', provider: 'fixture', model: 'fixture-model' }] } });
  assert.equal(result.issues, undefined);
  assert.equal(result.value.catalog.get().roles[0].name, 'lead');
});

test('bundle default omits the launch-directory allowlist and preserves legacy restrictions', async t => {
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runInNewContext } = await import('node:vm');
  const home = await mkdtemp(join(tmpdir(), 'bundle-roots-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const patches = yaml.load(await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'), { schema: entryListSchema });
  const expression = patches[0].insert[0].config.allowedRoots.__jsExpr;
  const evaluate = () => runInNewContext(expression, { process, dshHomePath: name => join(home, name), ctx: { get: () => ({ cwd: '/installation-directory' }) } });
  assert.equal(evaluate(), undefined);
  const schema = new Schema(Config.toJSON());
  const defaults = schema['~standard'].validate({ stateDirectory: join(home, 'state') });
  assert.equal(defaults.issues, undefined);
  assert.equal(defaults.value.allowedRoots, undefined);
  for (const allowedRoots of [null, []]) {
    const explicit = schema['~standard'].validate({ stateDirectory: join(home, 'state'), allowedRoots });
    assert.deepEqual(explicit.value.allowedRoots, allowedRoots);
  }
  await writeFile(join(home, 'dsh-agent-team.json'), JSON.stringify({ allowedRoots: ['/admin/project'] }));
  assert.deepEqual(Array.from(evaluate()), ['/admin/project']);
  await writeFile(join(home, 'dsh-agent-team.json'), JSON.stringify({ allowedRoots: [] }));
  assert.deepEqual(Array.from(evaluate()), []);
});
