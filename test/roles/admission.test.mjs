import test from 'node:test';
import assert from 'node:assert/strict';
import { creationGuard, isNativeActivationTool } from '../../src/roles/admission.mjs';

const activation = { output: { schema: {
  type: 'object', additionalProperties: false,
  properties: { kind: { type: 'string', const: 'activation' }, subagentId: { type: 'string' } },
  required: ['kind', 'subagentId'],
} } };

test('native activation output identifies delegation independently of alias or backend', () => {
  assert.equal(isNativeActivationTool(activation), true);
  for (const name of ['subagent_codex', 'delegate_custom', 'external_alias']) {
    const toolSet = {};
    let lookups = 0;
    const agent = { ctx: { tools: { get(actualName, actualAgent, actualSet) {
      lookups += 1;
      assert.equal(actualName, name);
      assert.equal(actualAgent, agent);
      assert.equal(actualSet, toolSet);
      return activation;
    } } } };
    assert.match(creationGuard({ name, agent, toolSet, schema: { type: 'string' } }), /allowlisted role/u);
    assert.equal(lookups, 1);
  }
});

test('ordinary and enhanced-role outputs remain available while original native Team spawning is denied', () => {
  assert.equal(isNativeActivationTool({ output: { schema: { type: 'object', properties: { kind: { const: 'activation' } }, required: ['kind'] } } }), false);
  assert.equal(isNativeActivationTool({ output: { schema: { ...activation.output.schema, properties: { kind: { const: 'result' }, subagentId: { type: 'string' } } } } }), false);
  const agent = { ctx: { tools: { get() { return { output: { schema: { type: 'object', properties: { target: { type: 'string' }, memberId: { type: 'string' }, role: { type: 'string' } }, required: ['target', 'memberId', 'role'] } } }; } } } };
  assert.equal(creationGuard({ name: 'spawn_role_teammate', agent }), undefined);
  assert.match(creationGuard({ name: 'spawn_teammate', agent }), /allowlisted role/u);
  assert.equal(creationGuard({ name: 'fixture_read', agent }), undefined);
});
