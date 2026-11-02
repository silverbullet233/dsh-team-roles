/** Passive ended-turn audit text, pinned to native events rather than latest projections. */
import { createHash } from 'node:crypto';
import { TeamError, object } from './errors.mjs';

const FORMAT = 'assistant-text-events-v1';
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 20000;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw new TeamError(code, message); };
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;

function reference(value, teamId) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || !/^[\w-]+$/.test(value)) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error();
    const ref = JSON.parse(bytes.toString('utf8'));
    object(ref, ['version', 'format', 'teamId', 'turn', 'startSeq', 'endSeq', 'sha256', 'sourceSha256', 'totalBytes']);
    if (ref.version !== 1 || ref.format !== FORMAT || ref.teamId !== teamId || !integer(ref.turn, 1)
      || !integer(ref.startSeq, 0) || !integer(ref.endSeq, ref.startSeq + 1) || !integer(ref.totalBytes, 0, MAX_HISTORY_BYTES)
      || !/^[a-f0-9]{64}$/.test(ref.sha256) || !/^[a-f0-9]{64}$/.test(ref.sourceSha256)) throw new Error();
    return ref;
  } catch { fail('INVALID_RESULT_REF', 'Result reference is invalid, unsupported or belongs to another Team.'); }
}

/** Native message limits are not byte limits; oversized fetched pages fail explicitly. */
async function endedTurn(read, teamId, turn, ref) {
  let cut = ref?.endSeq, beforeSeq, end, size = 0, count = 0;
  const reversed = [];
  for (let pageNumber = 0; pageNumber < 64; pageNumber++) {
    let page;
    try { page = await read({ address: { kind: 'session', sessionId: teamId }, ...(cut === undefined ? {} : { throughSeq: cut }), ...(beforeSeq === undefined ? {} : { beforeSeq }), maxMessages: 32 }); }
    catch { fail('HISTORY_UNAVAILABLE', 'Public native history could not be read at the requested cut; no latest-result fallback was used.'); }
    if (!integer(page?.cursor, -1) || !Array.isArray(page.records) || typeof page.hasMore !== 'boolean') fail('HISTORY_INCOMPLETE', 'Native history did not provide a valid exact page.');
    cut ??= page.cursor;
    if (page.cursor !== cut) fail('HISTORY_INCOMPLETE', 'Native history changed its pinned cut.');
    size += Buffer.byteLength(JSON.stringify(page.records)); count += page.records.length;
    if (size > MAX_HISTORY_BYTES || count > MAX_EVENTS) fail('HISTORY_LIMIT', 'History scan exceeds 8 MiB or 20000 events; no partial result was returned.');
    const events = page.records.map(record => record?.type === 'event' ? record.event : null);
    const high = beforeSeq ?? cut + 1;
    if (events.some((event, i) => !integer(event?.seq, 0) || event.seq !== high - events.length + i)) fail('HISTORY_INCOMPLETE', 'Native history has a gap or unordered events.');
    if (events.length === 0 && (page.hasMore || high !== 0)) fail('HISTORY_INCOMPLETE', 'Native history is missing the requested event window.');
    if (ref && beforeSeq === undefined && (events.at(-1)?.type !== 'turn/end' || events.at(-1)?.data?.turn !== turn)) fail('RESULT_CHANGED', 'Pinned turn end is no longer present.');
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.type === 'turn/start' && event.data?.turn === turn) {
        if (!end) fail('TURN_NOT_ENDED', 'The selected turn has no committed native end.');
        reversed.push(event);
        return reversed.reverse();
      }
      if (!end && event.type === 'turn/end' && event.data?.turn === turn) end = event;
      if (end) {
        if ((event.type === 'turn/start' || event.type === 'turn/end') && event.data?.turn !== turn) fail('HISTORY_INCOMPLETE', 'Selected turn boundaries are inconsistent.');
        reversed.push(event);
      }
    }
    if (!page.hasMore) {
      if (events.length && events[0].seq !== 0) fail('HISTORY_INCOMPLETE', 'Native history ends before its declared origin.');
      fail(end ? 'HISTORY_INCOMPLETE' : 'TURN_NOT_FOUND', end ? 'Selected turn start is unavailable.' : 'Selected turn is absent from native history.');
    }
    if (!events.length || events[0].seq === 0) fail('HISTORY_INCOMPLETE', 'Native history has no earlier page to read.');
    beforeSeq = events[0].seq;
  }
  fail('HISTORY_LIMIT', 'History scan exceeds 64 native pages; no partial result was returned.');
}

/** A result is an event-text audit transcript, never a goal-success assertion. */
export async function readTurnResult(params, read) {
  object(params, ['teamId', 'turn', 'resultRef', 'offset', 'maxBytes']);
  const { teamId, resultRef, offset = 0, maxBytes = 8192 } = params;
  if ((params.turn === undefined) === (resultRef === undefined) || (params.turn !== undefined && !integer(params.turn, 1))
    || !integer(offset, 0) || !integer(maxBytes, 4, 32768) || (resultRef === undefined && offset !== 0)) fail('INVALID_REQUEST', 'Select exactly one positive turn or resultRef; nonzero offsets require resultRef. Page budget is 4..32768 bytes.');
  const ref = resultRef === undefined ? null : reference(resultRef, teamId);
  const turn = ref?.turn ?? params.turn;
  const events = await endedTurn(read, teamId, turn, ref);
  const startSeq = events[0].seq, endSeq = events.at(-1).seq;
  const outcome = events.at(-1).data?.reason?.kind;
  if (typeof outcome !== 'string' || outcome.length > 64) fail('HISTORY_INCOMPLETE', 'Native turn outcome is unavailable.');
  const inputs = new Set(), lines = [];
  for (const event of events) {
    if (event.type === 'user/message' && event.data?.source?.kind === 'user' && typeof event.data.source.rpcId === 'string') inputs.add(event.data.source.rpcId);
    if (event.type !== 'assistant/message') continue;
    const content = event.data?.message?.content;
    if (!Array.isArray(content)) fail('HISTORY_INCOMPLETE', 'Native assistant content is unavailable.');
    const text = content.filter(part => part.type === 'text').map(part => {
      if (typeof part.text !== 'string') fail('HISTORY_INCOMPLETE', 'Native assistant text is invalid.');
      return part.text;
    });
    lines.push(JSON.stringify({ seq: event.seq, surfaceOp: event.surfaceOp ?? null, ...(event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs }), text }));
  }
  if (inputs.size > 128 || [...inputs].some(id => Buffer.byteLength(id) > 256)) fail('HISTORY_LIMIT', 'Turn input identities exceed the bounded result metadata.');
  const bytes = Buffer.from(lines.length ? lines.join('\n') + '\n' : '', 'utf8');
  if (bytes.length > MAX_HISTORY_BYTES) fail('HISTORY_LIMIT', 'Rendered result exceeds 8 MiB; no partial result was returned.');
  const identity = { version: 1, format: FORMAT, teamId, turn, startSeq, endSeq, sha256: hash(bytes), sourceSha256: hash(JSON.stringify(events)), totalBytes: bytes.length };
  if (ref && JSON.stringify(ref) !== JSON.stringify(identity)) fail('RESULT_CHANGED', 'Pinned result content, source or rendering identity changed.');
  if (offset > bytes.length || (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80)) fail('INVALID_OFFSET', 'Offset must be an in-range UTF-8 scalar boundary returned by this result.');
  let end = Math.min(offset + maxBytes, bytes.length);
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  return { teamId, turn, resultRef: resultRef ?? Buffer.from(JSON.stringify(identity)).toString('base64url'), startSeq, endSeq, outcome,
    inputIds: [...inputs], format: FORMAT,
    coverage: { assistantMessages: lines.length, canonicalConversation: false, goalAccepted: null, excludes: ['reasoning', 'tools', 'artifacts', 'member-sessions'] },
    page: { offset, nextOffset: end < bytes.length ? end : null, totalBytes: bytes.length, sha256: identity.sha256, text: bytes.subarray(offset, end).toString('utf8') } };
}
