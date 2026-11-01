import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagedTeams } from '../../src/teams/service.mjs';
import { TeamStore } from '../../src/teams/private-store.mjs';
import { TeamError } from '../../src/teams/errors.mjs';

// Permission effects and children are synthetic data only; no native preset or tool executes.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-permission-admission-'));
  const store = await new TeamStore(join(directory, 'metadata')).open();
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const presets = new Map([['read-only', { sandboxMode: 'read-only', approvalPolicy: 'ask' }], ['danger-full-access', { sandboxMode: 'danger-full-access', approvalPolicy: 'never' }]]);
  const native = {
    sessions: new Map(), calls: [], children: [], ctx: {}, failure: undefined,
    resolvePermissionPreset(name) { const spec = presets.get(name); if (!spec) throw new TeamError('PERMISSION_PRESET_UNAVAILABLE', 'Unknown synthetic preset'); return { preset: name, ...spec }; },
    permissionCatalog() { return { options: [...presets.keys()].map(value => ({ value, ...this.resolvePermissionPreset(value) })) }; },
    async projections(id) { return this.sessions.has(id) ? { kind: 'sequenced' } : null; },
    async prepareLead() {},
    async create({ sessionId }) { this.calls.push('create'); this.sessions.set(sessionId, { runtimeState: 'idle', needsContinuation: false, permissions: { preset: 'read-only', sandbox: { mode: 'read-only', workspaceRoot: directory }, approvalPolicy: 'ask', asOfSeq: 0 } }); return { sessionId }; },
    async applyPermissionPreset(id, intent) {
      this.calls.push('set');
      if (this.failure === 'ignore-set') return;
      const permissions = this.sessions.get(id).permissions;
      permissions.preset = intent.preset; permissions.sandbox.mode = intent.sandboxMode;
      if (this.failure === 'partial-set') throw new Error('Synthetic partial append');
      permissions.approvalPolicy = intent.approvalPolicy; permissions.asOfSeq++;
    },
    async permissionSnapshot(id) { return structuredClone(this.sessions.get(id).permissions); },
    async flush() { this.calls.push('flush'); if (this.failure === 'flush' && this.calls.includes('set')) throw new Error('Synthetic durability failure'); },
    async snapshot(id) { return structuredClone(this.sessions.get(id)); },
    async prompt({ sessionId }, verify) { verify?.(this.permissionSnapshot ? await this.permissionSnapshot(sessionId) : null); this.calls.push('prompt'); this.children.push(structuredClone(this.sessions.get(sessionId).permissions)); },
  };
  const bridge = new ManagedTeams({ native, store, allowedRoots: [directory] });
  const params = { key: 'permission-test', cwd: directory, text: 'Synthetic authorized task.' };
  return { directory, store, native, bridge, params, presets };
}

test('omitted preset preserves defaults; explicit selection is verified before first prompt/child', async t => {
  const { native, bridge, params } = await fixture(t);
  const omitted = await bridge.dispatch('create', params);
  assert.equal(native.calls.includes('set'), false); assert.equal(omitted.permissions.sandbox.mode, 'read-only');
  native.calls.length = 0; native.children.length = 0;
  const result = await bridge.dispatch('create', { ...params, key: 'explicit', permissionPreset: 'danger-full-access' });
  assert(native.calls.indexOf('set') < native.calls.indexOf('prompt'));
  assert.deepEqual(native.calls, ['create', 'flush', 'set', 'flush', 'prompt', 'flush']);
  assert.equal(result.permissions.preset, 'danger-full-access'); assert.equal(result.permissions.approvalPolicy, 'never');
  assert.equal(native.children[0].sandbox.mode, 'danger-full-access');
  native.sessions.get(result.teamId).permissions.sandbox.mode = 'read-only';
  assert.equal(native.children[0].sandbox.mode, 'danger-full-access');
});

test('invalid preset fails before reservation or native creation', async t => {
  const { native, bridge, store, params } = await fixture(t);
  await assert.rejects(bridge.dispatch('create', { ...params, permissionPreset: 'missing' }), { code: 'PERMISSION_PRESET_UNAVAILABLE' });
  assert.equal(await store.get('key', params.key), undefined); assert.equal(native.sessions.size, 0); assert.equal(native.calls.length, 0);
});

test('an existing default Team cannot gain an explicit preset on retry', async t => {
  const { native, bridge, params } = await fixture(t);
  await bridge.dispatch('create', params);
  await assert.rejects(bridge.dispatch('create', { ...params, permissionPreset: 'danger-full-access' }), { code: 'CONTENT_CONFLICT' });
  assert.equal(native.calls.includes('set'), false); assert.equal(native.calls.filter(call => call === 'prompt').length, 1);
});

test('a failed verified-metadata write leaves the Session unusable for task admission', async t => {
  const { native, bridge, params, store } = await fixture(t), set = store.set.bind(store);
  store.set = (kind, key, record) => {
    if (kind === 'key' && record.stage === 'created') throw new Error('Synthetic metadata durability failure');
    return set(kind, key, record);
  };
  const input = { ...params, permissionPreset: 'danger-full-access' };
  await assert.rejects(bridge.dispatch('create', input), error => error.code === 'NATIVE_FAILURE' && /Team [a-f0-9-]+/.test(error.message));
  store.set = set;
  const record = await store.get('key', params.key);
  await assert.rejects(bridge.dispatch('create', input), { code: 'PERMISSION_INITIALIZATION_INCOMPLETE' });
  await assert.rejects(bridge.dispatch('send', { teamId: record.sessionId, inputId: record.inputId, text: params.text, continue: true }), { code: 'PERMISSION_INITIALIZATION_INCOMPLETE' });
  assert.equal(native.calls.filter(call => call === 'set').length, 1); assert.equal(native.calls.includes('prompt'), false);
});

test('a native creation flush failure returns the reserved ID without starting input', async t => {
  const { native, bridge, params, store } = await fixture(t);
  native.flush = async () => { throw new Error('Synthetic flush failure'); };
  let failure;
  await assert.rejects(bridge.dispatch('create', { ...params, permissionPreset: 'read-only' }), error => { failure = error; return error.code === 'NATIVE_FAILURE'; });
  const record = await store.get('key', params.key);
  assert(failure.message.includes(record.sessionId)); assert.equal(native.calls.includes('prompt'), false);
});

test('same intent retries are read-only, restored Teams verify, and changed intent conflicts', async t => {
  const { native, bridge, params, store } = await fixture(t);
  const input = { ...params, permissionPreset: 'danger-full-access' };
  const first = await bridge.dispatch('create', input);
  native.sessions.get(first.teamId).runtimeState = 'unloaded'; native.sessions.get(first.teamId).needsContinuation = true;
  const restored = new ManagedTeams({ native, store, allowedRoots: [params.cwd] });
  assert.equal((await restored.dispatch('create', input)).duplicate, true);
  for (const changed of [undefined, 'read-only']) await assert.rejects(restored.dispatch('create', { ...input, permissionPreset: changed }), { code: 'CONTENT_CONFLICT' });
  assert.equal(native.calls.filter(call => call === 'set').length, 1); assert.equal(native.calls.filter(call => call === 'prompt').length, 1);
  native.sessions.get(first.teamId).permissions.approvalPolicy = 'ask';
  await assert.rejects(restored.dispatch('create', input), { code: 'PERMISSION_MISMATCH' });
  await assert.rejects(restored.dispatch('send', { teamId: first.teamId, inputId: 'followup', text: 'Synthetic follow-up.', continue: true }), { code: 'PERMISSION_MISMATCH' });
  assert.equal(native.calls.filter(call => call === 'set').length, 1);
});

test('partial selection, verification and durability failures cannot start work or be repaired on retry', async t => {
  for (const failure of ['partial-set', 'ignore-set', 'flush']) await t.test(failure, async t => {
    const { native, bridge, params, store } = await fixture(t);
    native.failure = failure;
    const input = { ...params, permissionPreset: 'danger-full-access' };
    await assert.rejects(bridge.dispatch('create', input), error => error.code === (failure === 'ignore-set' ? 'PERMISSION_MISMATCH' : 'PERMISSION_INITIALIZATION_INCOMPLETE') && /Team [a-f0-9-]+/.test(error.message));
    const record = await store.get('key', params.key); assert.equal(record.stage, 'reserved');
    native.failure = undefined;
    await assert.rejects(bridge.dispatch('create', input), { code: 'PERMISSION_INITIALIZATION_INCOMPLETE' });
    await assert.rejects(bridge.dispatch('send', { teamId: record.sessionId, inputId: record.inputId, text: params.text, continue: true }), { code: 'PERMISSION_INITIALIZATION_INCOMPLETE' });
    assert.equal(native.calls.filter(call => call === 'set').length, 1); assert.equal(native.calls.includes('prompt'), false);
  });
});

test('permission changes during receipt I/O are refused at native input admission', async t => {
  const { native, bridge, params, store } = await fixture(t), set = store.set.bind(store);
  store.set = async (kind, key, record) => {
    await set(kind, key, record);
    if (kind === 'input') native.sessions.get(record.teamId).permissions.sandbox.mode = 'danger-full-access';
  };
  await assert.rejects(bridge.dispatch('create', { ...params, permissionPreset: 'read-only' }), { code: 'PERMISSION_MISMATCH' });
  assert.equal(native.calls.includes('prompt'), false);
});

test('catalog changes never reapply or silently fallback for an existing Team', async t => {
  const { native, bridge, params, presets } = await fixture(t);
  const input = { ...params, permissionPreset: 'danger-full-access' };
  const result = await bridge.dispatch('create', input);
  presets.set('danger-full-access', { sandboxMode: 'workspace-write', approvalPolicy: 'ask' });
  await assert.rejects(bridge.dispatch('create', input), { code: 'PERMISSION_MISMATCH' });
  assert.equal(native.sessions.get(result.teamId).permissions.sandbox.mode, 'danger-full-access');
  assert.equal(native.calls.filter(call => call === 'set').length, 1);
});
