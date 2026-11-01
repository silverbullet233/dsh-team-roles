import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import PermissionPresets from '@deepseek-ai/dsh-permission-presets';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import { NativeSessionPort } from '../../src/teams/native-port.mjs';
import { mountNativeHost } from '../fixtures/native-harness.mjs';

test('actual native permission projections read live and persisted defaults without setters or activation', async t => {
  const root = await mkdtemp('/tmp/dsh-permission-read-');
  let host, port;
  t.after(async () => { await port?.close(); await host?.dispose(); await rm(root, { recursive: true, force: true }); });
  const mount = async () => {
    host = await mountNativeHost({ root });
    // A declaration only: this fixture has no shell executor or arbitrary tools.
    host.ctx.provide('shell', { sandboxMode: 'workspace-write' });
    await host.ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: host.fixtureRoot });
    await host.ctx.plugin(PermissionPresets, {});
    host.ctx.get('permissionPresets').set = () => { throw new Error('Read-only fixture must never set permissions'); };
    port = new NativeSessionPort(host.ctx, host.ctx.dshRoles);
  };
  await mount();
  assert.equal(port.resolvePermissionPreset('danger-full-access').approvalPolicy, 'never');
  const { sessionId } = await host.ctx.sessionController.create({ cwd: host.fixtureRoot });
  const live = await port.permissionSnapshot(sessionId);
  assert.equal(live.preset, 'workspace-write'); assert.equal(live.approvalPolicy, 'ask');
  await host.ctx.sessions.flush(host.ctx.sessions.get(sessionId));
  const persisted = await host.ctx.sessionQuery.readSession(sessionId);
  await port.close(); port = undefined; await host.dispose(); host = undefined;
  await mount();
  const cold = await port.permissionSnapshot(sessionId);
  assert.deepEqual(cold, { ...live, asOfSeq: persisted.events.at(-1).seq });
  assert.equal(host.ctx.agents.get(sessionId), undefined); assert.equal(host.ctx.sessions.get(sessionId), undefined);
  assert.equal(host.requests.length, 0);
});

test('guarded text admission uses the public native Agent queue with durable request deduplication', async t => {
  const root = await mkdtemp('/tmp/dsh-permission-prompt-');
  const host = await mountNativeHost({ root });
  const port = new NativeSessionPort(host.ctx, host.ctx.dshRoles);
  t.after(async () => { await port.close(); await host.dispose(); await rm(root, { recursive: true, force: true }); });
  host.ctx.provide('shell', { sandboxMode: 'workspace-write' });
  await host.ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: host.fixtureRoot });
  await host.ctx.plugin(PermissionPresets, {});
  host.ctx.get('permissionPresets').set = () => { throw new Error('No preset switch in this fixture'); };
  const { sessionId } = await host.ctx.sessionController.create({ cwd: host.fixtureRoot });
  const request = { sessionId, requestId: 'guarded-input', content: [{ type: 'text', text: 'Synthetic guarded input.' }] };
  const verify = actual => assert.equal(actual.sandbox.mode, 'workspace-write');
  await port.prompt(request, verify);
  await host.ctx.agents.get(sessionId).whenIdle();
  await port.prompt(request, verify);
  assert.equal(host.requests.length, 1);
});
