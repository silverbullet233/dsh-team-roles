/** Pure role-record fold shared by live projections and explicit cold inspection. */
import { isDeepStrictEqual } from 'node:util';
import { roleSnapshot, memberName, record, text } from './config.mjs';

export const RESERVED = 'plugin:dsh-agent-team/role-reserved';
export const BOUND = 'plugin:dsh-agent-team/role-bound';

/** Validate a durable immutable role reservation or binding. */
export function parseBinding(value) {
  record(value, ['name', 'role', 'description', 'instructions', 'provider', 'model', 'reasoningEffort', 'inputDigest', 'memberId'], 'role binding');
  const { role, ...snapshot } = roleSnapshot(value.role, {
    description: value.description, instructions: value.instructions, provider: value.provider, model: value.model,
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }),
  });
  return {
    name: memberName(value.name, true), role, ...snapshot,
    inputDigest: text(value.inputDigest, 'inputDigest'),
    ...(value.memberId === undefined ? {} : { memberId: text(value.memberId, 'memberId') }),
  };
}

/** Initialize only the Session's own suffix; forked records never grant membership. */
export function initialState(ownFrom = 0) {
  return { ownFrom, reservations: [], bound: null, hasDurableSelection: false, hasBoundRequest: false, lastRequest: null };
}

/** Agent options are fallback values, so only durable native events suppress initialization. */
export function needsInitialSelection(state) {
  return state.bound === null || (!state.hasDurableSelection && !state.hasBoundRequest);
}

/** Fold complete immutable records and authoritative native request headers. */
export function foldRoleState(state, event) {
  if (event.seq < state.ownFrom) return state;
  if (event.type === RESERVED) {
    const binding = parseBinding(event.data);
    const old = state.reservations.find(item => item.name === binding.name);
    if (old !== undefined) {
      const { memberId: ignoredOld, ...oldSnapshot } = old;
      const { memberId: ignoredNew, ...newSnapshot } = binding;
      if (!isDeepStrictEqual(oldSnapshot, newSnapshot)) throw new Error(`immutable role binding changed for ${binding.name}`);
      return state;
    }
    return { ...state, reservations: [...state.reservations, binding] };
  }
  if (event.type === BOUND) {
    const binding = parseBinding(event.data);
    if (state.bound !== null && !isDeepStrictEqual(state.bound, binding)) throw new Error('immutable member role binding changed');
    return state.bound === null ? { ...state, bound: binding, hasDurableSelection: false, hasBoundRequest: false } : state;
  }
  if (event.type === 'team/member') {
    const member = event.data.member;
    if (!member || typeof member.name !== 'string' || typeof member.id !== 'string') throw new Error('invalid native team member');
    const index = state.reservations.findIndex(item => item.name === member.name);
    if (index < 0) return state;
    const binding = state.reservations[index];
    if (binding.memberId !== undefined && binding.memberId !== member.id) throw new Error('native member identity changed for a bound role');
    if (binding.memberId === member.id) return state;
    return { ...state, reservations: state.reservations.with(index, { ...binding, memberId: member.id }) };
  }
  if (event.type === 'model/selection') return state.bound === null || state.hasDurableSelection ? state : { ...state, hasDurableSelection: true };
  if (event.type !== 'request/header') return state;
  const config = event.data.header.config;
  return { ...state, hasBoundRequest: state.bound !== null, lastRequest: {
    provider: config.provider, model: config.model,
    reasoningEffort: config.reasoningEffort ?? null,
    adapterDefaultEffort: event.data.header.adapterDefaults?.reasoningEffort === true,
    seq: event.seq, time: event.time,
  } };
}

/** Recover role metadata from one explicit persisted Session read. */
export function foldRoleEvents(events, inheritedEventCount = 0) {
  return events.reduce(foldRoleState, initialState(inheritedEventCount));
}
