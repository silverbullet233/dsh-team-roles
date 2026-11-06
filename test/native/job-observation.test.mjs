import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mountNativeHost, textChunks, until } from '../fixtures/native-harness.mjs';

test('native Job observations filter owners, preserve model output and stay passive after restart', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-job-observation-'));
  let host = await mountNativeHost({ root, respond: options => options.provider === 'fixture-left' ? 'hang' : textChunks('SYNTHETIC_COMPLETE') });
  const handles = [];
  let detach;
  t.after(async () => {
    for (const handle of handles) handle.done.resolve({ status: 'killed' });
    await detach?.();
    await host.client.close(); await host.dispose(); await rm(root, { recursive: true, force: true });
  });
  detach = host.ctx.jobs.attachController('synthetic observation fixture');
  const first = await host.client.request('create', { key: 'job-team', cwd: host.fixtureRoot, text: 'Synthetic completed Lead.' });
  const lead = host.ctx.agents.get(first.teamId); await lead.whenIdle();
  const initial = await host.client.request('jobs', { teamId: first.teamId });
  assert.equal(initial.available, true); assert.equal(initial.ownerCount, 1);
  const spawned = await host.ctx.dshRoles.spawn(lead, { name: 'worker', role: 'left', prompt: 'Synthetic completed member.', signal: new AbortController().signal });
  await until(() => host.requests.some(request => request.provider === 'fixture-left'));
  const child = host.ctx.agents.get(spawned.member.id);
  const other = await host.client.request('create', { key: 'other-team', cwd: host.fixtureRoot, text: 'Synthetic unrelated Lead.' });
  await host.ctx.agents.get(other.teamId).whenIdle();
  for (const owner of [first.teamId, spawned.member.id, other.teamId, undefined]) {
    const done = Promise.withResolvers();
    const id = host.ctx.jobs.start({ kind: 'fixture', label: 'excluded fixture command', ...(owner === undefined ? {} : { owner }), run(handle) {
      handle.append('SYNTHETIC_OUTPUT'); handle.updateProgress('step 1/3');
      return { done: done.promise, cancel: () => done.resolve({ status: 'killed' }) };
    } });
    handles.push({ id, owner, done });
  }
  assert(host.ctx.jobs.list(first.teamId).some(job => job.owner === undefined));
  const seq = lead.session.seq;
  const result = await host.client.request('jobs', { teamId: first.teamId });
  assert.equal(result.available, true); assert.equal(result.ownerScopeUnchangedAtCheck, true);
  assert.equal(result.counts.running, 2); assert.equal(result.ownerCount, 2);
  assert.deepEqual(new Set(result.jobs.map(job => job.owner)), new Set([first.teamId, spawned.member.id]));
  assert(result.jobs.every(job => job.progress.text === 'step 1/3' && job.output.totalBytes === 16));
  assert.doesNotMatch(JSON.stringify(result), /excluded fixture command|SYNTHETIC_OUTPUT/);
  assert.equal(lead.session.seq, seq);
  await assert.rejects(host.client.request('jobs', { teamId: spawned.member.id }), { code: 'UNKNOWN_TEAM' });
  await host.client.close();
  assert.equal((await host.client.request('jobs', { teamId: first.teamId, limit: 1 })).omitted, 1);
  const consumed = host.ctx.jobs.read(handles[0].id, handles[0].owner);
  assert.equal(consumed.chunks.map(chunk => chunk.text).join(''), 'SYNTHETIC_OUTPUT');
  for (const handle of handles) { handle.done.resolve({ status: 'completed' }); await host.ctx.jobs.wait(handle.id, 1000, handle.owner); }
  const settled = await host.client.request('jobs', { teamId: first.teamId });
  assert.equal(settled.counts.running, 0); assert.equal(settled.counts.completed, 2);
  await host.ctx.agentTeams.interrupt(lead, 'worker'); await child.whenIdle();
  await host.ctx.sessions.flush(lead.session);
  // Cordis effect disposal is asynchronous. Starting host disposal before the
  // controller detachment settles can strand the remaining native teardown.
  await host.client.close(); await detach(); await host.dispose();
  host = await mountNativeHost({ root });
  const cold = await host.client.request('jobs', { teamId: first.teamId });
  assert.equal(cold.available, true); assert.equal(cold.jobs.length, 0);
  assert.equal(cold.ownerScopeUnchangedAtCheck, null);
  assert.equal(cold.coverage.historical, false); assert.equal(cold.ownerCount, 2);
  assert.equal(host.ctx.agents.list().length, 0); assert.equal(host.requests.length, 0);
});
