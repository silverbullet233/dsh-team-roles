/** Native Session projection for managed-Team observations; no execution state is scheduled here. */
const INPUT_LIMIT = 4096;
const TEXT_LIMIT = 8192;

export function initialObservation() {
  return { turn: 0, open: false, lastEnd: null, inputs: [], output: '', recent: [], errors: [] };
}

/** Inputs become processed only after their native turn ends. */
export function foldObservation(state, event) {
  const recent = [...state.recent, { seq: event.seq, type: event.type, time: event.time }].slice(-12);
  if (event.type === 'turn/start') {
    return { ...state, turn: event.data.turn, open: true, recent };
  }
  if (event.type === 'user/message' && event.data.source?.kind === 'user'
    && typeof event.data.source.rpcId === 'string') {
    const input = { id: event.data.source.rpcId, turn: state.turn, seq: event.seq, processed: false, outcome: null };
    return { ...state, inputs: [...state.inputs.filter(item => item.id !== input.id), input].slice(-INPUT_LIMIT), recent };
  }
  if (event.type === 'turn/end') {
    const reason = event.data.reason.kind;
    const error = reason === 'error' ? String(event.data.reason.error?.message ?? 'Native turn failed.').slice(0, 2048) : undefined;
    return {
      ...state,
      open: false,
      lastEnd: { turn: event.data.turn, reason },
      inputs: state.inputs.map(input => input.turn === event.data.turn ? { ...input, processed: true, outcome: reason } : input),
      errors: error === undefined ? state.errors : [...state.errors, { seq: event.seq, message: error }].slice(-8),
      recent,
    };
  }
  if (event.type === 'assistant/message') {
    const content = event.data.message.content;
    const output = content.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, TEXT_LIMIT);
    return { ...state, output, recent };
  }
  return { ...state, recent };
}

/** Register using the runtime's public zod dependency. */
export function teamObservationProjection(z) {
  const schema = z.object({
    turn: z.number().int().nonnegative(),
    open: z.boolean(),
    lastEnd: z.object({ turn: z.number().int().nonnegative(), reason: z.string() }).nullable(),
    inputs: z.array(z.object({
      id: z.string(), turn: z.number().int().nonnegative(), seq: z.number().int().nonnegative(),
      processed: z.boolean(), outcome: z.string().nullable(),
    })).max(INPUT_LIMIT),
    output: z.string().max(TEXT_LIMIT),
    recent: z.array(z.object({ seq: z.number(), type: z.string(), time: z.number() })).max(12),
    errors: z.array(z.object({ seq: z.number(), message: z.string().max(2048) })).max(8),
  }).strict();
  return {
    key: 'dshBridge',
    stateVersion: 1,
    stateSchema: schema,
    init: initialObservation,
    apply: foldObservation,
    wire: { viewSchema: schema, view: state => state },
  };
}
