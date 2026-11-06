import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountNativeHost, textChunks, until } from '../fixtures/native-harness.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-execution-evidence-'));
  const host = await mountNativeHost({ root, jobLimit: options.jobLimit, ...(options.respond ? { respond: options.respond } : {}) });
  const detach = host.ctx.jobs.attachController('synthetic execution fixture'), handles = [];
  t.after(async () => {
    for (const handle of handles) handle.done.resolve({ status: 'killed' });
    await host.client.close(); await detach(); await host.dispose(); await rm(root, { recursive: true, force: true });
  });
  const created = await host.client.request('create', { key: 'execution', cwd: host.fixtureRoot, text: 'Synthetic Lead fixture.' });
  const lead = host.ctx.agents.get(created.teamId);
  if (options.running) await until(() => host.requests.length === 1); else await lead.whenIdle();
  const start = (owner, cancel) => {
    const done = Promise.withResolvers();
    const id = host.ctx.jobs.start({ kind: 'fixture', label: 'Synthetic deferred Job', ...(owner === undefined ? {} : { owner }), run: () => ({ done: done.promise, cancel: cancel ?? (() => done.resolve({ status: 'killed' })) }) });
    const handle = { id, owner, done }; handles.push(handle); return handle;
  };
  return { host, lead, teamId: created.teamId, start };
}

test('an idle Lead with a running owned Job is incomplete; Team stop requests native Job cancellation', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.host.client.request('result', { teamId: f.teamId })).completed, true);
  const job = f.start(f.teamId);
  const busy = await f.host.client.request('result', { teamId: f.teamId });
  assert.equal(busy.nativeTeamCompleted, true); assert.equal(busy.completed, false); assert.equal(busy.execution.ownedJobsSettled, false);
  const stopped = await f.host.client.request('stop', { teamId: f.teamId });
  assert.equal(stopped.accepted, true); assert.equal(stopped.quiescent, true); assert.equal(stopped.execution.admissionBarrier, false);
  assert.equal(stopped.jobCancellations.observed, 1); assert.equal(stopped.filesRolledBack, false);
  assert.equal(f.host.ctx.jobs.get(job.id, job.owner).status, 'killed');
  const settled = await f.host.client.request('result', { teamId: f.teamId });
  assert.equal(settled.completed, true); assert.equal(settled.execution.jobs.counts.killed, 1); assert.equal(settled.execution.goalAccepted, null);
});

test('requested cancellation and producer failure never manufacture terminal quiescence', { timeout: 15000 }, async t => {
  for (const throws of [false, true]) await t.test(String(throws), async t => {
    const f = await fixture(t); let calls = 0;
    const job = f.start(f.teamId, () => { calls++; if (throws) throw new Error('excluded fixture failure'); });
    const stopped = await f.host.client.request('stop', { teamId: f.teamId });
    assert.equal(stopped.accepted, !throws); assert.equal(stopped.quiescent, false); assert.equal(calls, 1);
    assert.equal(stopped.execution.ownedJobsSettled, false); assert.doesNotMatch(JSON.stringify(stopped), /excluded fixture failure/);
    assert.equal((await f.host.client.request('result', { teamId: f.teamId })).completed, false);
    job.done.resolve({ status: 'killed' }); await f.host.ctx.jobs.wait(job.id, 1000, job.owner);
    assert.equal((await f.host.client.request('result', { teamId: f.teamId })).completed, true);
  });
});

test('Team stop cancels root/member Jobs and excludes visible unowned and other Team Jobs', { timeout: 15000 }, async t => {
  const f = await fixture(t, { respond: options => options.provider === 'fixture-left' ? 'hang' : textChunks('SYNTHETIC_COMPLETE') });
  const member = await f.host.ctx.dshRoles.spawn(f.lead, { name: 'worker', role: 'left', prompt: 'Synthetic running member.', signal: new AbortController().signal });
  await until(() => f.host.requests.some(request => request.provider === 'fixture-left'));
  const other = await f.host.client.request('create', { key: 'foreign', cwd: f.host.fixtureRoot, text: 'Synthetic foreign Team.' });
  await f.host.ctx.agents.get(other.teamId).whenIdle();
  const cancelled = [];
  for (const owner of [f.teamId, member.member.id, other.teamId, undefined]) {
    let handle;
    handle = f.start(owner, () => { cancelled.push(owner); handle.done.resolve({ status: 'killed' }); });
  }
  const stopped = await f.host.client.request('stop', { teamId: f.teamId });
  assert.equal(stopped.accepted, true); assert.equal(stopped.quiescent, true);
  assert.deepEqual(new Set(cancelled), new Set([f.teamId, member.member.id]));
  assert.equal(stopped.jobCancellations.observed, 2);
  assert.equal(f.host.ctx.jobs.list().find(job => job.owner === undefined).status, 'running');
  assert.equal(f.host.ctx.jobs.list(other.teamId).find(job => job.owner === other.teamId).status, 'running');
});

test('late owned Jobs are observed and cancelled in later bounded passes', { timeout: 15000 }, async t => {
  const f = await fixture(t); let late, first, calls = 0;
  first = f.start(f.teamId, () => { calls++; first.done.resolve({ status: 'killed' }); late = f.start(f.teamId); });
  const stopped = await f.host.client.request('stop', { teamId: f.teamId });
  assert.equal(stopped.accepted, true); assert.equal(stopped.quiescent, true);
  assert.equal(stopped.jobCancellations.observed, 2); assert.equal(calls, 1);
  assert.equal(f.host.ctx.jobs.get(late.id, late.owner).status, 'killed');
  assert.equal(stopped.execution.atomic, false); assert.equal(stopped.execution.admissionBarrier, false);
});

test('native cancellation covers more Jobs than the bounded outcome sample', { timeout: 15000 }, async t => {
  const f = await fixture(t, { jobLimit: 64 }); // synthetic promises, no processes
  const jobs = Array.from({ length: 63 }, () => f.start(f.teamId));
  const stopped = await f.host.client.request('stop', { teamId: f.teamId });
  assert.equal(stopped.accepted, true); assert.equal(stopped.quiescent, true);
  assert.equal(stopped.jobCancellations.observed, 63); assert.equal(stopped.jobCancellations.items.length, 25); assert.equal(stopped.jobCancellations.omitted, 38);
  assert(jobs.every(job => f.host.ctx.jobs.get(job.id, job.owner).status === 'killed'));
});

test('stop preserves pending inbox and files without claiming a drain or automatic resume', { timeout: 15000 }, async t => {
  const f = await fixture(t, { running: true, respond: () => 'hang' });
  await f.host.client.request('send', { teamId: f.teamId, inputId: 'queued-old', text: 'Synthetic queued input.' });
  await f.host.files.write('left-result.txt', 'retained fixture');
  const stopped = await f.host.client.request('stop', { teamId: f.teamId });
  assert.equal(stopped.accepted, true); assert.equal(stopped.quiescent, false); assert.equal(stopped.pendingInputsRetained, true);
  assert.equal(stopped.execution.admissionBarrier, false);
  const message = f.lead.inbox.nextTurn.find(message => message.source.rpcId === 'queued-old'); assert(message);
  assert.equal(await f.host.files.read('left-result.txt'), 'retained fixture'); assert.equal(f.host.requests.length, 1);
  // Explicit fixture cleanup, not a stop side effect.
  f.lead.inbox.remove(message.id);
});
