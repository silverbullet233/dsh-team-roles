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
