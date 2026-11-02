/** Payload-free receipts from public Session events, not tool execution scheduling. */
export const TOOL_CALL_LIMIT = 16;
const identity = value => typeof value === 'string' && value.length > 0 && value.isWellFormed() && Buffer.byteLength(value) <= 256;
export const initialTools = () => ({ turn: 0, open: false, observedCalls: 0, observedResults: 0, correlationComplete: true, omittedCallEvents: 0, unsettled: [], lastResult: null });
export function foldTools(state, event) {
  // The native tagged boundary ends a fork's inherited prefix. Untagged
  // ordinary restore markers must retain this Session's own receipts.
  if (event.type === 'session/end-seed' && event.data?.inherited === true) return initialTools();
  if (event.type === 'turn/start') return { ...initialTools(), turn: event.data.turn, open: true };
  if (event.type === 'turn/end' && event.data.turn === state.turn) return { ...state, open: false };
  if (event.data?.turn !== state.turn) return state;
  if (event.type === 'tool/call') {
    const { callId, name, step } = event.data;
    const duplicate = state.unsettled.some(row => row.callId === callId && row.step === step);
    const retain = identity(callId) && Number.isSafeInteger(step) && step >= 0 && !duplicate && state.unsettled.length < TOOL_CALL_LIMIT;
    return { ...state, observedCalls: state.observedCalls + 1,
      correlationComplete: state.correlationComplete && retain,
      omittedCallEvents: state.omittedCallEvents + (retain ? 0 : 1),
      unsettled: retain ? [...state.unsettled, { callId, name: identity(name) ? name : null, step, callSeq: event.seq }] : state.unsettled };
  }
  if (event.type === 'tool/result') {
    const { message, step } = event.data, callId = message?.toolCallId;
    const index = state.unsettled.findIndex(row => row.callId === callId && row.step === step);
    const call = state.unsettled[index];
    const linked = state.correlationComplete && index !== -1;
    return { ...state, observedResults: state.observedResults + 1,
      correlationComplete: state.correlationComplete && index !== -1,
      unsettled: index === -1 ? state.unsettled : state.unsettled.filter((_, i) => i !== index),
      lastResult: { callId: identity(callId) ? callId : null, name: linked ? call.name : null, step: Number.isSafeInteger(step) && step >= 0 ? step : null,
        callSeq: linked ? call.callSeq : null, resultSeq: event.seq, isError: typeof message?.isError === 'boolean' ? message.isError : null } };
  }
  return state;
}

export function toolReceiptView(state) {
  if (!state) return { available: false, reason: 'PROJECTION_UNAVAILABLE' };
  return { available: true, turn: state.turn, turnOpen: state.open,
    observedCalls: state.observedCalls, observedResults: state.observedResults,
    correlationComplete: state.correlationComplete, omittedCallEvents: state.omittedCallEvents,
    unsettledCount: state.correlationComplete ? state.unsettled.length : null,
    unsettledKnownCount: state.unsettled.length, unsettled: state.unsettled.slice(0, 4), omittedSamples: Math.max(0, state.unsettled.length - 4), lastResult: state.lastResult };
}

export function toolObservationProjection(z) {
  const id = z.string().min(1).max(256), seq = z.number().int().nonnegative();
  const schema = z.object({ turn: seq, open: z.boolean(), observedCalls: seq, observedResults: seq,
    correlationComplete: z.boolean(), omittedCallEvents: seq,
    unsettled: z.array(z.object({ callId: id, name: id.nullable(), step: seq, callSeq: seq }).strict()).max(TOOL_CALL_LIMIT),
    lastResult: z.object({ callId: id.nullable(), name: id.nullable(), step: seq.nullable(), callSeq: seq.nullable(), resultSeq: seq, isError: z.boolean().nullable() }).strict().nullable(),
  }).strict();
  return { key: 'dshToolReceipts', stateVersion: 3, stateSchema: schema, init: initialTools, apply: foldTools,
    wire: { viewSchema: schema, view: state => state } };
}
