/** Idempotent admission metadata over the native Session service. */
import { API_NAME, API_VERSION, CAPABILITIES } from './capabilities.mjs';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { TeamError, object, text } from './errors.mjs';
import { digest } from './private-store.mjs';

/** Serialization is admission-only. DSH remains the sole execution scheduler. */
export class ManagedTeams {
  constructor({ native, store, allowedRoots, sourceSha = null, runtimeEvidence = null }) {
    if (!Array.isArray(allowedRoots) || allowedRoots.length === 0 || allowedRoots.some(root => !isAbsolute(root))) {
      throw new TeamError('INVALID_CONFIG', 'allowedRoots must contain explicit absolute workspace roots.');
    }
    this.native = native;
    this.store = store;
    this.allowedRoots = allowedRoots;
    this.sourceSha = sourceSha;
    this.runtimeEvidence = runtimeEvidence;
    this.tails = new Map();
    this.pending = new Set();
    this.closing = false;
  }

  async serial(key, action) {
    const prior = this.tails.get(key) ?? Promise.resolve();
    const run = prior.then(action, action);
    const tail = run.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    try { return await run; } finally { if (this.tails.get(key) === tail) this.tails.delete(key); }
  }

  async workspace(cwd) {
    const directory = await realpath(text(cwd, 'cwd', 4096));
    const allowed = await Promise.all(this.allowedRoots.map(root => realpath(root)));
    if (!allowed.some(root => { const suffix = relative(root, directory); return suffix === '' || (!suffix.startsWith(`..${sep}`) && suffix !== '..' && !isAbsolute(suffix)); })) {
      throw new TeamError('WORKSPACE_DENIED', 'Directory is outside the configured workspace roots.');
    }
    return directory;
  }

  async record(teamId) {
    text(teamId, 'teamId', 256);
    const record = await this.store.get('team', teamId);
    if (record === undefined || record.sessionId !== teamId) throw new TeamError('UNKNOWN_TEAM', 'The role service did not create the requested Team.');
    return record;
  }

  async dispatch(method, params = {}) {
    if (this.closing) throw new TeamError('SERVICE_CLOSING', 'Managed-Team admission is closed.');
    const operation = this.invoke(method, params);
    this.pending.add(operation);
    try { return await operation; } finally { this.pending.delete(operation); }
  }

  async close() {
    this.closing = true;
    clearTimeout(this.shutdownLease);
    await Promise.allSettled([...this.pending]);
  }

  async invoke(method, params) {
    switch (method) {
      case 'health':
        object(params, []);
        return { ok: true, api: { name: API_NAME, version: API_VERSION, capabilities: CAPABILITIES }, sourceSha: this.sourceSha, runtime: this.runtimeEvidence, roles: await this.native.catalog?.() ?? null, transport: 'native-typert-gateway', service: 'native-session', modalities: ['text'], ownsExecution: false, host: { pid: process.pid, instanceId: process.env.DSH_OWNED_INSTANCE_ID ?? null } };
      case 'create': return this.create(params);
      case 'send': return this.send(params);
      case 'status': return this.status(params);
      case 'result': return this.result(params);
      case 'stop':
        object(params, ['teamId']);
        await this.record(params.teamId);
        return this.serial(`team:${params.teamId}`, () => this.native.stop(params.teamId));
      case 'prepareShutdown':
        object(params, []);
        this.quiescing = true;
        // Decide before the first await: an already admitted Web writer must
        // settle before a fresh native activity baseline can be trusted.
        if ((this.httpAdmissions ?? 0) > 1 || this.pending.size > 0) {
          this.quiescing = false;
          return { safeToStop: false, reason: 'admissions-in-flight' };
        }
        try {
          const activity = await this.activity();
          if (activity.safeToStop) {
            const leaseExpiresAt = Date.now() + 5000;
            this.shutdownLease = setTimeout(() => { this.quiescing = false; }, 5000);
            this.shutdownLease.unref();
            return { ...activity, leaseExpiresAt };
          }
          else this.quiescing = false;
          return activity;
        } catch (error) { this.quiescing = false; throw error; }
      case 'activity':
        object(params, []);
        return this.activity();
      default: throw new TeamError('METHOD_NOT_FOUND', 'Unknown managed-Team method.');
    }
  }

  async activity() {
    const agents = this.native.ctx.agents.list();
    const busy = agents.filter(agent => agent.status === 'running').map(agent => agent.id);
    const records = await this.store.list('team');
    const unsettled = [];
    for (const record of records) {
      try {
        const state = await this.native.snapshot(record.sessionId);
        const activity = state.teamActivity;
        const coldComplete = state.runtimeState === 'unloaded' && state.rootTurnCompleted && !state.team?.failure && activity.pendingTasks === 0
          && activity.members.every(member => member.observationAvailable && !member.openTurn && member.pendingInputs === 0 && member.lastTurnOutcome === 'completed' && member.phase !== 'provisioning');
        if (activity.members.some(member => member.openTurn || member.pendingInputs !== 0 || member.phase === 'provisioning')
          || activity.pendingTasks > 0 || state.observation.open || ['running', 'provisioning'].includes(activity.state) || (activity.state === 'unknown' && !coldComplete)) unsettled.push(record.sessionId);
      } catch { unsettled.push(record.sessionId); }
    }
    // Inspect unmanaged Web Sessions too, including their native inboxes.
    for (const agent of agents) {
      const projections = await this.native.projections(agent.id);
      const inbox = projections?.kind === 'sequenced' ? projections.values.inbox : null;
      if (inbox === null || inbox === undefined || (inbox['next-turn']?.length ?? 0) + (inbox['next-step']?.length ?? 0) > 0) unsettled.push(agent.id);
    }
    const runningNow = this.native.ctx.agents.list().filter(agent => agent.status === 'running').map(agent => agent.id);
    busy.push(...runningNow.filter(id => !busy.includes(id)));
    return { safeToStop: (this.native.roles?.tails?.size ?? 0) === 0 && this.pending.size <= 1 && (this.httpAdmissions ?? 0) <= 1 && busy.length === 0 && unsettled.length === 0,
      running: busy, unsettled: [...new Set(unsettled)], admissions: Math.max(0, this.pending.size - 1) };
  }

  async create(params) {
    object(params, ['key', 'text', 'cwd', 'workspaceId', 'agentPreset', 'leadRole']);
    const key = text(params.key, 'key', 256);
    const prompt = text(params.text, 'text');
    const cwd = await this.workspace(params.cwd);
    const workspaceId = params.workspaceId === undefined ? undefined : text(params.workspaceId, 'workspaceId', 256);
    const agentPreset = params.agentPreset === undefined ? undefined : text(params.agentPreset, 'agentPreset', 256);
    const leadRole = params.leadRole === undefined ? undefined : text(params.leadRole, 'leadRole', 128);
    if (workspaceId !== undefined && await this.workspace(this.native.workspacePath(workspaceId)) !== cwd) {
      throw new TeamError('WORKSPACE_DENIED', 'The native workspace path differs from cwd.');
    }
    const hash = digest({ prompt, cwd, workspaceId, agentPreset, leadRole });
    return this.serial(`key:${key}`, async () => {
      let record = await this.store.get('key', key);
      if (record !== undefined && record.digest !== hash) throw new TeamError('CONTENT_CONFLICT', 'The create key is already bound to different content.');
      if (record === undefined) {
        record = { sessionId: randomUUID(), inputId: `create-${digest(key)}`, digest: hash, cwd, stage: 'reserved', createdAt: Date.now() };
        await this.store.set('key', key, record);
      }
      await this.store.set('team', record.sessionId, record);
      const existing = await this.native.projections(record.sessionId);
      if (existing === null) {
        if (record.stage !== 'reserved') throw new TeamError('SESSION_MISSING', 'The reserved native Session disappeared; no replacement was created.');
        await this.native.prepareLead(record.sessionId, leadRole);
        const created = await this.native.create({ sessionId: record.sessionId, ...(workspaceId === undefined ? { cwd } : { workspaceId }), ...(agentPreset === undefined ? {} : { agentPreset }) });
        if (created.sessionId !== record.sessionId) throw new TeamError('SESSION_CONFLICT', 'Native create returned another Session; admission stopped.');
        await this.native.flush(record.sessionId);
      }
      record = { ...record, stage: 'created' };
      await this.store.set('key', key, record);
      await this.store.set('team', record.sessionId, record);
      let acceptance;
      try {
        acceptance = await this.send({ teamId: record.sessionId, inputId: record.inputId, text: prompt, mode: 'queue' });
      } catch (error) {
        if (!(error instanceof TeamError) || error.code !== 'CONTINUATION_REQUIRED') throw error;
        const receipt = await this.store.get('input', [record.sessionId, record.inputId]);
        acceptance = { accepted: receipt === undefined ? false : null, processed: null, requiresContinuation: true };
      }
      return { teamId: record.sessionId, sessionId: record.sessionId, inputId: record.inputId, ...acceptance };
    });
  }

  async send(params) {
    object(params, ['teamId', 'inputId', 'text', 'mode', 'continue']);
    const team = await this.record(params.teamId);
    await this.workspace(team.cwd);
    const inputId = text(params.inputId, 'inputId', 256);
    const prompt = text(params.text, 'text');
    const mode = params.mode ?? 'queue';
    if (mode !== 'queue' && mode !== 'steer') throw new TeamError('INVALID_REQUEST', 'mode must be queue or steer.');
    if (params.continue !== undefined && typeof params.continue !== 'boolean') throw new TeamError('INVALID_REQUEST', 'continue must be a boolean.');
    return this.serial(`team:${params.teamId}`, async () => {
      const receiptKey = [params.teamId, inputId];
      const hash = digest({ prompt, mode });
      const receipt = await this.store.get('input', receiptKey);
      if (receipt !== undefined && receipt.digest !== hash) throw new TeamError('CONTENT_CONFLICT', 'The input ID is already bound to different content.');
      if (receipt?.accepted === true) return { teamId: params.teamId, inputId, accepted: true, processed: null, duplicate: true };
      const snapshot = await this.native.snapshot(params.teamId);
      if (snapshot.needsContinuation && params.continue !== true) {
        throw new TeamError('CONTINUATION_REQUIRED', `Explicit continue=true is required for Team ${params.teamId}; retry send with the same inputId.`);
      }
      await this.store.set('input', receiptKey, { teamId: params.teamId, inputId, digest: hash, accepted: false });
      await this.native.prompt({ requestId: inputId, sessionId: params.teamId, mode, content: [{ type: 'text', text: prompt }] });
      await this.native.flush(params.teamId);
      await this.store.set('input', receiptKey, { teamId: params.teamId, inputId, digest: hash, accepted: true });
      return { teamId: params.teamId, inputId, accepted: true, processed: null, duplicate: false };
    });
  }

  async status(params) {
    object(params, ['teamId']);
    const record = await this.record(params.teamId);
    const snapshot = await this.native.snapshot(params.teamId);
    return { teamId: params.teamId, createdAt: record.createdAt, ...snapshot };
  }

  async result(params) {
    const status = await this.status(params);
    return {
      teamId: params.teamId,
      taskState: status.taskState,
      runtimeState: status.runtimeState,
      rootTurnState: status.rootTurnState,
      rootTurnCompleted: status.rootTurnCompleted,
      completed: status.teamCompleted ?? null,
      teamActivity: status.teamActivity,
      output: status.observation.output,
      errors: status.observation.errors,
      inputs: status.observation.inputs,
      asOfSeq: status.asOfSeq,
      usage: null,
      fees: null,
    };
  }
}
