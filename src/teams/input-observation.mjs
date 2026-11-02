/** Read-only input evidence from one exact native projection cut. */
import { INPUT_LIMIT } from './projection.mjs';
export const unavailableInput = reason => ({ phase: 'unavailable', reason, asOfSeq: null, scope: 'root-session', pending: null, entered: null,
  coverage: { source: 'native-projections', absenceIsConclusive: false } });

export function observeInput(projection, inputId) {
  if (projection === null) return unavailableInput('SESSION_MISSING');
  if (projection?.kind !== 'sequenced') return unavailableInput('MIGRATION_REQUIRED');
  const inbox = projection.values?.inbox, inputs = projection.values?.dshBridge?.inputs;
  if (!Number.isSafeInteger(projection.asOfSeq) || !Array.isArray(inbox?.['next-turn']) || !Array.isArray(inbox?.['next-step']) || !Array.isArray(inputs)) return unavailableInput('PROJECTION_MISSING');
  const pending = [];
  for (const placement of ['next-turn', 'next-step']) for (const message of inbox[placement]) {
    if (message?.source?.kind !== 'user' || message.source.rpcId !== inputId) continue;
    if (typeof message.id !== 'string' || !message.id.length || Buffer.byteLength(message.id) > 256) return unavailableInput('INVALID_MESSAGE_ID');
    pending.push({ messageId: message.id, placement });
  }
  const entered = inputs.findLast(row => row.id === inputId);
  const phase = pending.length > 1 || (pending.length && entered) ? 'ambiguous' : pending.length ? 'pending' : entered ? entered.processed ? 'turn-ended' : 'entered-turn' : 'not-observed';
  return { phase, asOfSeq: projection.asOfSeq, scope: 'root-session',
    pending: { count: pending.length, items: pending.slice(0, 2), truncated: pending.length > 2 },
    entered: entered ? { turn: entered.turn, seq: entered.seq, outcome: entered.outcome, turnEnded: entered.processed } : null,
    coverage: { source: 'native-projections', retainedInputEntries: inputs.length, inputRetentionLimit: INPUT_LIMIT, absenceIsConclusive: false } };
}
