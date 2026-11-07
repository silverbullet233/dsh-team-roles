/** Pure admission regressions: no listener, child process or credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, appendPluginRecord } from '@deepseek-ai/dsh-session';
import { NativeSessionPort } from '../../src/teams/native-port.mjs';
import { validateProfile } from '../../src/teams/permission-profile.mjs';
const marker = 'plugin:dsh-team-roles/permission-profile';
const profile = { sandboxMode: 'read-only', approvalPolicy: 'ask', writableRoots: [], networkAccess: 'unknown', binding: 'a'.repeat(64) };
const actual = () => ({ sandbox: { mode: 'read-only', workspaceRoot: '/synthetic', additionalWritableRoots: [] }, approvalPolicy: 'ask' });
function fixture() {
  const sessions = new Map(), agents = new Map(), policies = new Map(), records = new Map();
  const add = (id, parent, saved = true, origin = 'subagent') => {
    const session = Session.create(id, undefined, { version: 4, id, createdAt: 0, isSeeded: false, ...(parent ? { parentSession: parent, ...(origin === 'subagent' ? { origin } : {}) } : {}), cwd: '/synthetic' });
    if (parent && saved) appendPluginRecord(session, marker, profile);
    const agent = { id, session }; agents.set(id, agent); sessions.set(id, session); policies.set(id, actual()); return agent;
  };
  const root = add('root'); const parent = add('parent', root.id); const child = add('child', parent.id, false);
  records.set(root.id, { sessionId: root.id, stage: 'created', cwd: '/synthetic', permissionProfile: profile, permissions: actual() });
  const port = Object.create(NativeSessionPort.prototype);
  port.ctx = { sessions: { get: id => sessions.get(id), flush: async () => {} }, agents: { get: id => agents.get(id), isOwnedBy: () => false }, agentTeams: { tryMembership: () => undefined } };
  port.resolvePermissionProfile = validateProfile;
  port.permissionsOf = session => policies.get(session.id);
  const store = { get: async (_kind, id) => records.get(id) };
  return { port, store, sessions, agents, policies, records, root, parent, child, add };
}
for (const failure of ['missing-parent-marker', 'conflicting-parent-marker', 'duplicate-parent-marker', 'missing-root', 'incomplete-root', 'invalid-root-profile', 'wrong-root-id', 'root-profile-change', 'parent-policy-drift', 'root-policy-drift', 'cycle', 'unowned-parent-marker']) {
  test(`recursive inheritance rejects ${failure} before writing child policy`, async () => {
    const f = fixture();
    if (failure === 'missing-parent-marker') f.parent = f.add('parent', 'root', false);
    if (failure === 'conflicting-parent-marker') { f.parent = f.add('parent', 'root', false); appendPluginRecord(f.parent.session, marker, { ...profile, networkAccess: 'enabled' }); }
    if (failure === 'duplicate-parent-marker') appendPluginRecord(f.parent.session, marker, profile);
    if (failure === 'missing-root') f.records.clear();
    if (failure === 'incomplete-root') f.records.get('root').stage = 'reserved';
    if (failure === 'invalid-root-profile') f.records.get('root').permissionProfile = null;
    if (failure === 'wrong-root-id') f.records.get('root').sessionId = 'other';
    if (failure === 'root-profile-change') f.records.get('root').permissionProfile = { ...profile, networkAccess: 'enabled' };
    if (failure === 'parent-policy-drift') f.policies.get('parent').approvalPolicy = 'never';
    if (failure === 'root-policy-drift') f.policies.get('root').sandbox.mode = 'danger-full-access';
    if (failure === 'cycle') { f.add('parent', 'child'); f.records.clear(); }
    if (failure === 'unowned-parent-marker') f.add('parent', 'root', true, 'ordinary');
    const before = f.child.session.snapshotEvents();
    await assert.rejects(f.port.inheritPermissions(f.child, f.store, 'startup'), error => ['PERMISSION_MISMATCH', 'PERMISSION_INITIALIZATION_INCOMPLETE', 'INVALID_REQUEST'].includes(error.code));
    assert.deepEqual(f.child.session.snapshotEvents(), before);
  });
}
for (const source of ['resume', 'clear', 'compaction', undefined]) test(`missing own initialization on ${source} never rewrites restored policy`, async () => {
  const f = fixture(); const before = f.child.session.snapshotEvents();
  await assert.rejects(f.port.inheritPermissions(f.child, f.store, source), { code: 'PERMISSION_INITIALIZATION_INCOMPLETE' });
  assert.deepEqual(f.child.session.snapshotEvents(), before);
});
test('a fresh child that already started work cannot initialize late', async () => {
  const f = fixture(); f.child.session.append('turn/start', { turn: 1 });
  const before = f.child.session.snapshotEvents();
  await assert.rejects(f.port.inheritPermissions(f.child, f.store, 'startup'), { code: 'PERMISSION_INITIALIZATION_INCOMPLETE' });
  assert.deepEqual(f.child.session.snapshotEvents(), before);
});
test('conflicting restored child intent and drift are rejected without rewriting history', async () => {
  for (const failure of ['conflict', 'duplicate', 'drift']) {
    const f = fixture();
    appendPluginRecord(f.child.session, marker, failure === 'conflict' ? { ...profile, networkAccess: 'enabled' } : profile);
    if (failure === 'duplicate') appendPluginRecord(f.child.session, marker, profile);
    if (failure === 'drift') f.policies.get('child').approvalPolicy = 'never';
    const before = f.child.session.snapshotEvents();
    await assert.rejects(f.port.inheritPermissions(f.child, f.store, 'resume'), { code: 'PERMISSION_MISMATCH' });
    assert.deepEqual(f.child.session.snapshotEvents(), before);
  }
});
test('independent ancestry stops inheritance even for its genuine delegated child', async () => {
  const f = fixture(); f.add('parent', 'root', false, 'ordinary');
  assert.equal(await f.port.inheritPermissions(f.child, f.store, 'startup'), undefined);
  assert.deepEqual(f.child.session.snapshotEvents(), []);
});
test('parent drift or runtime replacement during async lookup is checked before initialization', async () => {
  for (const failure of ['drift', 'replacement']) {
    const f = fixture();
    f.store.get = async (_kind, id) => {
      if (id === 'root') {
        if (failure === 'drift') f.policies.get('parent').approvalPolicy = 'never';
        else f.agents.set('parent', { ...f.parent });
      }
      return f.records.get(id);
    };
    await assert.rejects(f.port.inheritPermissions(f.child, f.store, 'startup'), { code: 'PERMISSION_MISMATCH' });
    assert.deepEqual(f.child.session.snapshotEvents(), []);
  }
});
test('drift while initialization flushes blocks release of queued work', async () => {
  const f = fixture(); f.port.ctx.sessions.flush = async () => { f.policies.get('parent').approvalPolicy = 'never'; };
  await assert.rejects(f.port.inheritPermissions(f.child, f.store, 'startup'), { code: 'PERMISSION_MISMATCH' });
  assert.equal(f.child.session.snapshotEvents().filter(event => event.type === marker).length, 1);
});
test('cold ancestor logs retain verified intent without activating or rewriting them', async () => {
  const f = fixture(); const saved = new Map();
  for (const id of ['parent', 'root']) {
    const session = f.sessions.get(id);
    saved.set(id, { events: session.snapshotEvents(), session: session.header, inheritedEventCount: session.inheritedEventCount });
    f.sessions.delete(id); f.agents.delete(id);
  }
  f.port.ctx.sessionQuery = { readSession: async id => saved.get(id) };
  await f.port.inheritPermissions(f.child, f.store, 'startup');
  assert.equal(f.child.session.snapshotEvents().filter(event => event.type === marker).length, 1);
  assert.equal(f.agents.has('parent'), false); assert.equal(f.agents.has('root'), false);
  assert.deepEqual(saved.get('parent').events, f.parent.session.snapshotEvents());
});
