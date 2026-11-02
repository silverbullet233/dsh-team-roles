/** Bounded metadata-only observations; never consume a Job's model cursor. */
import { TeamError } from './errors.mjs';
const statuses = ['running', 'stopping', 'completed', 'killed', 'failed'];
const boundedId = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 256;
const coverage = { source: 'native-live-job-registry', historical: false, includesUnowned: false, consumesOutput: false, atomic: false };
const unavailable = (reason, rootAsOfSeq = null) => ({ available: false, reason, rootAsOfSeq, ownerScopeUnchangedAtCheck: null, ownerCount: null, counts: null, jobs: [], omitted: null, coverage });

function progress(value) {
  if (typeof value !== 'string') return null;
  let text = '', bytes = 0;
  for (const scalar of value) {
    const size = Buffer.byteLength(scalar);
    if (bytes + size > 160) break;
    text += scalar; bytes += size;
  }
  return { text, truncated: text.length < value.length };
}

export async function observeOwnedJobs(ctx, projections, teamId, limit = 20) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new TeamError('INVALID_REQUEST', 'Job sample limit must be an integer from 1 to 25.');
  const identity = ctx.agents.get(teamId), sessionIdentity = ctx.sessions.get(teamId);
  let cut;
  try { cut = await projections(teamId); }
  catch { return unavailable('ROOT_OBSERVATION_UNAVAILABLE'); }
  if (cut?.kind !== 'sequenced' || !Number.isSafeInteger(cut.asOfSeq)) return unavailable('ROOT_OBSERVATION_UNAVAILABLE');
  const team = cut.values?.agentTeam;
  const roster = team === null ? [] : team?.members;
  if (!Array.isArray(roster) || roster.some(member => !boundedId(member?.id))) return unavailable('OWNER_SCOPE_UNAVAILABLE', cut.asOfSeq);
  const owners = new Set([teamId, ...roster.map(member => member.id)]);
  const rows = new Map();
  try {
    const registry = typeof ctx.get === 'function' ? ctx.get('jobs') : ctx.jobs;
    if (!registry) return unavailable('JOB_REGISTRY_UNAVAILABLE', cut.asOfSeq);
    for (const owner of owners) for (const row of registry.list(owner)) {
      // Native list(caller) also includes unowned Jobs. Visibility is not ownership.
      if (row.owner !== owner) continue;
      if (!boundedId(row.id) || !statuses.includes(row.status) || !Number.isFinite(row.startedAt) || rows.has(row.id)) return unavailable('INVALID_NATIVE_JOB', cut.asOfSeq);
      rows.set(row.id, row);
    }
  } catch { return unavailable('JOB_REGISTRY_UNAVAILABLE', cut.asOfSeq); }
  const counts = Object.fromEntries(statuses.map(status => [status, 0]));
  for (const row of rows.values()) counts[row.status]++;
  const active = row => ['running', 'stopping'].includes(row.status) ? 0 : 1;
  const sample = [...rows.values()].sort((a, b) => active(a) - active(b) || b.startedAt - a.startedAt || a.id.localeCompare(b.id)).slice(0, limit);
  const session = ctx.sessions.get(teamId);
  return { available: true, reason: null, rootAsOfSeq: cut.asOfSeq,
    ownerScopeUnchangedAtCheck: ctx.agents.get(teamId) === identity && session === sessionIdentity && (!session || session.seq - 1 === cut.asOfSeq), ownerCount: owners.size,
    counts, jobs: sample.map(row => ({ id: row.id, owner: row.owner, status: row.status,
      kind: boundedId(row.kind) ? row.kind : null, kindOmitted: !boundedId(row.kind), startedAt: row.startedAt, finishedAt: Number.isFinite(row.finishedAt) ? row.finishedAt : null,
      progress: progress(row.progress), output: { totalBytes: Number.isSafeInteger(row.output?.total) && row.output.total >= 0 ? row.output.total : null,
        retainedFromBytes: Number.isSafeInteger(row.output?.earliest) && row.output.earliest >= 0 ? row.output.earliest : null } })),
    omitted: rows.size - sample.length, coverage };
}
