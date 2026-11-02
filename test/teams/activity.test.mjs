import test from 'node:test';
import assert from 'node:assert/strict';
import { ManagedTeams } from '../../src/teams/service.mjs';
import { initialObservation } from '../../src/teams/projection.mjs';

function fixture() {
  const observation = { ...initialObservation(), lastEnd: { turn: 1, reason: 'completed' } };
  const members = ['root', 'child'].map(id => ({ id, phase: 'active', runtimeState: id === 'root' ? 'idle' : 'unloaded', observationAvailable: true, openTurn: false, pendingInputs: 0, lastTurnOutcome: 'completed' }));
  const state = { consistent: true, runtimeState: 'idle', rootTurnCompleted: true, observation, team: { members }, teamActivity: { state: 'quiescent', members, pendingTasks: 0 }, members: members.map(member => ({ memberId: member.id })) };
  const agents = new Map([['root', { id: 'root', status: 'idle' }]]);
  const projections = { kind: 'sequenced', asOfSeq: 1, values: { dshBridge: observation, inbox: { 'next-turn': [], 'next-step': [] }, agentTeam: { tasks: [] } } };
  const native = { roles: { tails: new Map() }, ctx: { agents: { list: () => [...agents.values()] }, sessions: { get: () => ({ seq: 2 }) } }, snapshot: async () => structuredClone(state), projections: async () => structuredClone(projections) };
  const service = new ManagedTeams({ native, store: { list: async () => [{ sessionId: 'root' }] }, allowedRoots: ['/tmp'] });
  return { state, agents, projections, native, service };
}

test('shutdown requires consistent settled managed and unmanaged native evidence', async t => {
  assert.equal((await fixture().service.dispatch('prepareShutdown')).safeToStop, true);
  const cases = {
    'inconsistent managed snapshot': f => { f.state.consistent = false; f.state.teamActivity.state = 'failed'; },
    'reserved role without a member identity': f => { f.state.members.push({ memberId: null }); },
    'unresolved role member': f => { f.state.members[1].error = 'Unavailable native member'; },
    'role member missing from native roster': f => { f.state.members[1].memberId = 'missing'; },
    'aborted unloaded child': f => { f.state.teamActivity.members[1].lastTurnOutcome = 'aborted'; f.state.teamActivity.state = 'incomplete'; },
    'unmanaged open turn': f => { f.agents.delete('root'); f.agents.set('web', { id: 'web', status: 'idle' }); f.projections.values.dshBridge.open = true; },
    'unmanaged pending shared task': f => { f.agents.delete('root'); f.agents.set('web', { id: 'web', status: 'idle' }); f.projections.values.agentTeam.tasks.push({ status: 'pending' }); },
    'unmanaged projection changed after observation': f => { f.native.ctx.sessions.get = () => ({ seq: 3 }); },
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
    const f = fixture(); mutate(f);
    const result = await f.service.dispatch('prepareShutdown');
    assert.equal(result.safeToStop, false);
    assert(result.unsettled.length > 0);
    assert.equal(f.service.quiescing, false);
  });
});

test('shutdown distinguishes preserved unfinished records from execution without altering either', async () => {
  const f = fixture();
  f.state.teamActivity.pendingTasks = 3;
  f.state.teamActivity.state = 'incomplete';
  f.state.teamActivity.members[1].lastTurnOutcome = 'error';
  const before = structuredClone(f.state);
  const result = await f.service.dispatch('prepareShutdown');
  assert.equal(result.safeToStop, false);
  assert.deepEqual(result.running, []);
  assert.deepEqual(result.blockers, [
    { kind: 'unfinished-tasks', teamId: 'root', count: 3 },
    { kind: 'unloaded-member-not-completed', teamId: 'root', sessionId: 'child', outcome: 'error' },
  ]);
  assert.deepEqual(f.state, before);
  assert.equal(f.service.quiescing, false);
});

test('idle Agents do not hide owned, unowned or stopping native Jobs', async t => {
  for (const owner of [undefined, 'root', 'child']) for (const status of ['running', 'stopping']) await t.test(`${owner ?? 'unowned'} ${status}`, async () => {
    const f = fixture(), calls = [];
    const job = { id: 'job', owner, status };
    f.native.ctx.jobs = { list(caller) { calls.push(caller); return owner === undefined || caller === owner ? [job] : []; } };
    const result = await f.service.dispatch('prepareShutdown');
    assert.equal(result.safeToStop, false);
    assert(result.blockers.some(b => b.kind === 'native-job' && b.id === 'job' && b.owner === (owner ?? null) && b.status === status));
    assert(calls.includes(undefined)); assert(calls.includes('root')); assert(calls.includes('child'));
    assert.equal(f.service.quiescing, false);
  });
});

test('Job observation errors and changes refuse a lease even if the last Job is settled', async t => {
  for (const failure of ['throws', 'appears-settled', 'disappears', 'settles']) await t.test(failure, async () => {
    const f = fixture(); let second = false;
    const projections = f.native.projections;
    f.native.projections = async (...args) => { second = true; return projections(...args); };
    f.native.ctx.jobs = { list() {
      if (failure === 'throws') throw new Error('unavailable');
      if (failure === 'appears-settled') return second ? [{ id: 'job', status: 'completed' }] : [];
      if (failure === 'disappears') return second ? [] : [{ id: 'job', status: 'running' }];
      return [{ id: 'job', status: second ? 'completed' : 'running' }];
    } };
    const result = await f.service.dispatch('prepareShutdown');
    assert.equal(result.safeToStop, false);
    assert(result.blockers.some(b => b.kind === (failure === 'throws' ? 'job-observation-unavailable' : 'job-state-changed')));
    assert.equal(f.service.quiescing, false);
  });
});

test('unchanging settled Jobs do not block a shutdown lease or consume producer output', async () => {
  const f = fixture();
  f.native.ctx.jobs = { list: () => [{ id: 'job', status: 'completed' }], read() { throw new Error('must not consume output'); }, kill() { throw new Error('must not cancel work'); } };
  try {
    const result = await f.service.dispatch('prepareShutdown');
    assert.equal(result.safeToStop, true);
    assert.deepEqual(result.blockers, []);
    assert(result.leaseExpiresAt > Date.now());
  } finally { await f.service.close(); }
});

test('stable retained Jobs of unloaded roster members do not create a false changing baseline', async () => {
  const f = fixture();
  f.native.ctx.jobs = { list: caller => caller === 'child' ? [{ id: 'cold-job', owner: 'child', status: 'completed' }] : [] };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const activity = await f.service.dispatch('activity');
      assert.equal(activity.safeToStop, true);
      assert.deepEqual(activity.blockers, []);
    }
    assert.equal((await f.service.dispatch('prepareShutdown')).safeToStop, true);
  } finally { await f.service.close(); }
});
