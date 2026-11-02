import test from 'node:test';
import assert from 'node:assert/strict';
import { observeOwnedJobs } from '../../src/teams/job-observation.mjs';
import { ManagedTeams } from '../../src/teams/service.mjs';

const row = (id, owner, status = 'running') => ({ id, owner, status, kind: 'fixture', label: 'excluded fixture label', progress: '中文🙂'.repeat(100), startedAt: 1, output: { total: 22, earliest: 3, spillPaths: ['excluded fixture path'] }, detail: 'excluded fixture detail', result: 'excluded fixture result' });
function fixture() {
  const calls = [], session = { seq: 9 }, agent = { session };
  const cut = { kind: 'sequenced', asOfSeq: 8, values: { agentTeam: { members: [{ id: 'root' }, { id: 'child' }] } } };
  const jobs = [row('root-job', 'root'), row('child-job', 'child', 'completed'), row('unowned-job', undefined), row('foreign-job', 'foreign')];
  const ctx = { agents: { get: () => agent }, sessions: { get: () => session }, jobs: {
    list(owner) { calls.push(owner); return jobs.filter(job => job.owner === undefined || job.owner === owner); },
    read() { assert.fail('must not consume'); }, readAt() { assert.fail('must not read output'); }, kill() { assert.fail('must not cancel'); },
  } };
  const projections = async id => { assert.equal(id, 'root'); return cut; };
  return { ctx, cut, session, agent, jobs, calls, read: limit => observeOwnedJobs(ctx, projections, 'root', limit) };
}

test('only exact declared Team owners are included; native unowned visibility is not ownership', async () => {
  const f = fixture(), result = await f.read();
  assert.equal(result.available, true); assert.equal(result.rootAsOfSeq, 8); assert.equal(result.ownerScopeUnchangedAtCheck, true);
  assert.deepEqual(f.calls, ['root', 'child']); assert.equal(result.ownerCount, 2);
  assert.deepEqual(result.jobs.map(job => job.id), ['root-job', 'child-job']);
  assert.deepEqual(result.counts, { running: 1, stopping: 0, completed: 1, killed: 0, failed: 0 });
  assert.equal(result.coverage.includesUnowned, false); assert.equal(result.coverage.atomic, false);
  assert.doesNotMatch(JSON.stringify(result), /excluded fixture|foreign-job|unowned-job/);
});

test('samples prioritize live work, count omissions and bound Unicode progress without clipping IDs', async () => {
  const f = fixture();
  f.jobs.push(...Array.from({ length: 30 }, (_, i) => ({ ...row('ended-' + i, 'root', 'completed'), startedAt: i + 3 })));
  const result = await f.read(2);
  assert.equal(result.jobs.length, 2); assert.equal(result.jobs[0].status, 'running'); assert.equal(result.counts.completed, 31); assert.equal(result.omitted, 30);
  assert(Buffer.byteLength(result.jobs[0].progress.text) <= 160); assert.equal(result.jobs[0].progress.truncated, true);
  assert.doesNotMatch(result.jobs[0].progress.text, /\uFFFD/);
  assert.deepEqual(result.jobs[0].output, { totalBytes: 22, retainedFromBytes: 3 });
  f.jobs[0].kind = '中'.repeat(86); const omitted = await f.read(1);
  assert.equal(omitted.jobs[0].kind, null); assert.equal(omitted.jobs[0].kindOmitted, true);
});

test('cold observations stay passive and registry absence/failure is not a zero-Job assertion', async () => {
  const f = fixture(); f.ctx.agents.get = () => undefined; f.ctx.sessions.get = () => undefined;
  const cold = await f.read(); assert.equal(cold.available, true); assert.equal(cold.ownerScopeUnchangedAtCheck, null);
  for (const registry of [undefined, { list() { throw new Error('excluded fixture secret'); } }]) {
    f.ctx.jobs = registry; const result = await f.read();
    assert.equal(result.available, false); assert.equal(result.counts, null); assert.equal(result.reason, 'JOB_REGISTRY_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  }
});

test('missing root scope, malformed native identities and bad limits refuse misleading partial observations', async () => {
  const f = fixture();
  for (const limit of [0, 26, 1.5]) await assert.rejects(f.read(limit), { code: 'INVALID_REQUEST' });
  assert.deepEqual(f.calls, []);
  for (const cut of [null, { kind: 'migration-required' }, { ...f.cut, values: {} }]) {
    const result = await observeOwnedJobs(f.ctx, async () => cut, 'root');
    assert.equal(result.available, false); assert.equal(result.counts, null);
  }
  assert.deepEqual(f.calls, []);
  f.jobs[0].id = '中'.repeat(86);
  assert.equal((await f.read()).reason, 'INVALID_NATIVE_JOB');
});

test('Agent/Session replacement or changed root cut makes owner-scope freshness explicit', async () => {
  for (const change of [f => { f.ctx.agents.get = () => ({}); }, f => { f.ctx.sessions.get = () => ({ seq: 9 }); }, f => { f.session.seq++; }]) {
    const f = fixture();
    const result = await observeOwnedJobs(f.ctx, async () => { change(f); return f.cut; }, 'root');
    assert.equal(result.available, true); assert.equal(result.ownerScopeUnchangedAtCheck, false);
  }
});

test('member/unmanaged targets and supplied owner IDs are rejected before native access', async () => {
  let reads = 0;
  const service = new ManagedTeams({ allowedRoots: ['/tmp'], store: { get: async (_kind, id) => id === 'root' ? { sessionId: 'root' } : undefined }, native: { async jobs() { reads++; return { available: true }; } } });
  for (const teamId of ['child', 'foreign']) await assert.rejects(service.dispatch('jobs', { teamId }), { code: 'UNKNOWN_TEAM' });
  await assert.rejects(service.dispatch('jobs', { teamId: 'root', owner: 'foreign' }), { code: 'INVALID_REQUEST' });
  assert.equal(reads, 0); assert.equal((await service.dispatch('jobs', { teamId: 'root', limit: 1 })).available, true);
});
