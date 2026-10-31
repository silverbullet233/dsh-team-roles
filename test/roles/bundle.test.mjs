import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
