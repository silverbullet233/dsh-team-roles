import test from 'node:test';
import assert from 'node:assert/strict';
import { executionEvidence } from '../../src/teams/execution-evidence.mjs';
import { NativeSessionPort } from '../../src/teams/native-port.mjs';
const status = { teamCompleted: true, asOfSeq: 8 };
const jobs = { available: true, rootAsOfSeq: 8, ownerScopeUnchangedAtCheck: true, counts: { running: 0, stopping: 0, completed: 1, failed: 0, killed: 0 } };

test('native Team completion requires settled known owned Jobs; goal acceptance stays unknown', () => {
  assert.equal(executionEvidence(status, jobs).completed, true);
  for (const state of ['running', 'stopping']) {
    const evidence = executionEvidence(status, { ...jobs, counts: { ...jobs.counts, [state]: 1 } });
    assert.equal(evidence.completed, false); assert.equal(evidence.nativeTeamCompleted, true); assert.equal(evidence.ownedJobsSettled, false);
  }
  for (const state of ['failed', 'killed']) {
    const evidence = executionEvidence(status, { ...jobs, counts: { ...jobs.counts, [state]: 1 } });
    assert.equal(evidence.completed, true); assert.equal(evidence.goalAccepted, null); assert.equal(evidence.admissionBarrier, false); assert.equal(evidence.atomic, false);
  }
});

test('missing, cold, stale and malformed Job evidence cannot turn an idle Team into proven completion', () => {
  for (const value of [undefined, { available: false }, { ...jobs, ownerScopeUnchangedAtCheck: null }, { ...jobs, rootAsOfSeq: 9 }, { ...jobs, counts: {} }]) {
    assert.equal(executionEvidence(status, value).completed, null);
    assert.equal(executionEvidence({ ...status, teamCompleted: false }, value).completed, false);
  }
  assert.equal(executionEvidence({ ...status, teamCompleted: null }, jobs).completed, null);
});

function fixture() {
  const session = id => ({ header: { id, ...(id === 'child' ? { parentSession: 'root' } : {}) }, seq: 9 });
  const agents = new Map(['root', 'child', 'foreign'].map(id => [id, { id, session: session(id) }]));
  const rows = [{ id: 'root-job', owner: 'root', status: 'running' }, { id: 'child-job', owner: 'child', status: 'running' }, { id: 'unowned-job', status: 'running' }, { id: 'foreign-job', owner: 'foreign', status: 'running' }];
  const calls = [], ctx = { agents: { get: id => agents.get(id) }, sessions: { get: id => agents.get(id)?.session }, agentTeams: { listMembers: () => [{ id: 'root' }, { id: 'child' }] }, jobs: {
    list: owner => rows.filter(row => row.owner === undefined || row.owner === owner), kill: (id, owner) => { calls.push([id, owner]); return 'requested'; },
  } };
  const port = Object.assign(Object.create(NativeSessionPort.prototype), { ctx });
  const snapshot = { consistent: true, team: { members: [{ id: 'root' }, { id: 'child' }] } };
  const root = new Map([...agents].map(([id, agent]) => [id, { agent, session: agent.session, registeredSession: agent.session }])), outcomes = new Map();
  return { ctx, port, agents, rows, calls, snapshot, root, outcomes };
}

test('Job cancellation serves exact current Team owners, never unowned or foreign jobs', () => {
  const f = fixture();
  assert.equal(f.port.cancelOwnedJobs('root', f.snapshot, f.root, f.outcomes), true);
  assert.deepEqual(f.calls, [['root-job', 'root'], ['child-job', 'child']]);
  f.port.cancelOwnedJobs('root', f.snapshot, f.root, f.outcomes);
  assert.equal(f.calls.length, 2);
});

test('cold/replaced/reparented owner identities are refused without activation or foreign cancellation', () => {
  for (const change of [f => f.agents.delete('child'), f => { f.agents.get('child').session.header.parentSession = 'foreign'; }, f => { f.agents.set('root', { id: 'root', session: f.root.get('root').session }); }]) {
    const f = fixture(); change(f);
    f.port.cancelOwnedJobs('root', f.snapshot, f.root, f.outcomes);
    assert(!f.calls.some(([id]) => id === 'child-job'));
    assert.equal(f.outcomes.get('child-job').cancellation, 'failed');
  }
});

test('Job cancellation scans beyond presentation samples and sanitizes producer failure', () => {
  const f = fixture(); f.rows.push(...Array.from({ length: 60 }, (_, i) => ({ id: 'many-' + i, owner: 'root', status: 'running' })));
  f.port.cancelOwnedJobs('root', f.snapshot, f.root, f.outcomes); assert.equal(f.calls.length, 62);
  const other = fixture(); other.ctx.jobs.kill = () => { throw new Error('excluded fixture secret'); };
  other.port.cancelOwnedJobs('root', other.snapshot, other.root, other.outcomes);
  assert([...other.outcomes.values()].every(row => row.cancellation === 'failed'));
  assert.doesNotMatch(JSON.stringify([...other.outcomes.values()]), /secret/);
});

test('same-sequence member Session replacement during observation refuses Job cancellation', async () => {
  const f = fixture(); f.rows.splice(0, f.rows.length, { id: 'child-job', owner: 'child', status: 'running' });
  for (const agent of f.agents.values()) { agent.status = 'idle'; agent.model = { current: () => undefined }; }
  const observation = { open: false, lastEnd: { reason: 'completed' }, inputs: [], output: '' };
  f.port.projections = async id => ({ kind: 'sequenced', asOfSeq: 8, values: { dshBridge: observation, inbox: { 'next-turn': [], 'next-step': [] },
    agentTeam: id === 'root' ? { members: [{ id: 'root', name: 'lead', role: 'lead' }, { id: 'child', name: 'worker', role: 'teammate' }], tasks: [] } : null } });
  let replace = true;
  f.port.roles = { stopping: new Set(), tails: new Map(), async bindings() {
    if (replace) { replace = false; f.agents.get('child').session = { header: { id: 'child', parentSession: 'root' }, seq: 9 }; }
    return [];
  } };
  const stopped = await f.port.stop('root');
  assert.deepEqual(f.calls, []); assert.equal(stopped.accepted, false); assert.equal(stopped.quiescent, false);
  assert.equal(stopped.jobCancellations.failed, 1);
});

test('the original observed member Session is retained through the post-snapshot cancellation boundary', async () => {
  const f = fixture();
  for (const agent of f.agents.values()) { agent.status = 'idle'; agent.model = { current: () => undefined }; }
  const observation = { open: false, lastEnd: { reason: 'completed' }, inputs: [], output: '' };
  f.port.projections = async id => ({ kind: 'sequenced', asOfSeq: 8, values: { dshBridge: observation, inbox: { 'next-turn': [], 'next-step': [] },
    agentTeam: id === 'root' ? { members: [{ id: 'root', name: 'lead' }, { id: 'child', name: 'worker' }], tasks: [] } : null } });
  const checked = new Map(), snapshot = await f.port.snapshot('root', checked);
  assert.equal(snapshot.consistent, true);
  f.agents.get('child').session = { header: { id: 'child', parentSession: 'root' }, seq: 9 };
  f.port.cancelOwnedJobs('root', snapshot, checked, f.outcomes);
  assert(!f.calls.some(([id]) => id === 'child-job'));
  assert.equal(f.outcomes.get('child-job').cancellation, 'failed');
});
