/** Idempotent admission metadata over the native Session service. */
import { PROTOCOL_NAME, PROTOCOL_VERSION, CAPABILITIES } from './protocol.mjs';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { BridgeError, object, text } from './errors.mjs';
import { digest } from './private-store.mjs';

/** Serialization is admission-only. DSH remains the sole execution scheduler. */
export class SessionBridge {
  constructor({ native, store, allowedRoots, sourceSha = null, runtimeEvidence = null }) {
    if (!Array.isArray(allowedRoots) || allowedRoots.length === 0 || allowedRoots.some(root => !isAbsolute(root))) {
      throw new BridgeError('INVALID_CONFIG', 'allowedRoots must contain explicit absolute workspace roots.');
    }
    this.native = native;
    this.store = store;
    this.allowedRoots = allowedRoots;
    this.sourceSha = sourceSha;
    this.runtimeEvidence = runtimeEvidence;
    this.tails = new Map();
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
      throw new BridgeError('WORKSPACE_DENIED', 'Directory is outside the configured workspace roots.');
    }
    return directory;
  }

  async record(teamId) {
    text(teamId, 'teamId', 256);
    const record = await this.store.get('team', teamId);
    if (record === undefined || record.sessionId !== teamId) throw new BridgeError('UNKNOWN_TEAM', 'This bridge did not create the requested Team.');
    return record;
  }

  async dispatch(method, params = {}) {
    switch (method) {
      case 'health':
        object(params, []);
        return { ok: true, protocol: { name: PROTOCOL_NAME, version: PROTOCOL_VERSION, capabilities: CAPABILITIES }, sourceSha: this.sourceSha, runtime: this.runtimeEvidence, roles: await this.native.catalog?.() ?? null, transport: 'uid-restricted-unix-socket', service: 'native-session', modalities: ['text'], ownsExecution: false };
      case 'create': return this.create(params);
      case 'send': return this.send(params);
      case 'status': return this.status(params);
      case 'result': return this.result(params);
      case 'stop':
        object(params, ['teamId']);
        await this.record(params.teamId);
        return this.native.stop(params.teamId);
      default: throw new BridgeError('METHOD_NOT_FOUND', 'Unknown bridge method.');
    }
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
      throw new BridgeError('WORKSPACE_DENIED', 'The native workspace path differs from cwd.');
    }
    const hash = digest({ prompt, cwd, workspaceId, agentPreset, leadRole });
    return this.serial(`key:${key}`, async () => {
      let record = await this.store.get('key', key);
      if (record !== undefined && record.digest !== hash) throw new BridgeError('CONTENT_CONFLICT', 'The create key is already bound to different content.');
      if (record === undefined) {
        record = { sessionId: randomUUID(), inputId: `create-${digest(key)}`, digest: hash, cwd, stage: 'reserved', createdAt: Date.now() };
        await this.store.set('key', key, record);
      }
      await this.store.set('team', record.sessionId, record);
      const existing = await this.native.projections(record.sessionId);
      if (existing === null) {
        if (record.stage !== 'reserved') throw new BridgeError('SESSION_MISSING', 'The reserved native Session disappeared; no replacement was created.');
        await this.native.prepareLead(record.sessionId, leadRole);
        const created = await this.native.create({ sessionId: record.sessionId, ...(workspaceId === undefined ? { cwd } : { workspaceId }), ...(agentPreset === undefined ? {} : { agentPreset }) });
        if (created.sessionId !== record.sessionId) throw new BridgeError('SESSION_CONFLICT', 'Native create returned another Session; admission stopped.');
        await this.native.flush(record.sessionId);
      }
      record = { ...record, stage: 'created' };
      await this.store.set('key', key, record);
      await this.store.set('team', record.sessionId, record);
      let acceptance;
      try {
        acceptance = await this.send({ teamId: record.sessionId, inputId: record.inputId, text: prompt, mode: 'queue' });
      } catch (error) {
        if (!(error instanceof BridgeError) || error.code !== 'CONTINUATION_REQUIRED') throw error;
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
    if (mode !== 'queue' && mode !== 'steer') throw new BridgeError('INVALID_REQUEST', 'mode must be queue or steer.');
    if (params.continue !== undefined && typeof params.continue !== 'boolean') throw new BridgeError('INVALID_REQUEST', 'continue must be a boolean.');
    return this.serial(`team:${params.teamId}`, async () => {
      const receiptKey = [params.teamId, inputId];
      const hash = digest({ prompt, mode });
      const receipt = await this.store.get('input', receiptKey);
      if (receipt !== undefined && receipt.digest !== hash) throw new BridgeError('CONTENT_CONFLICT', 'The input ID is already bound to different content.');
      if (receipt?.accepted === true) return { teamId: params.teamId, inputId, accepted: true, processed: null, duplicate: true };
      const snapshot = await this.native.snapshot(params.teamId);
      if (snapshot.needsContinuation && params.continue !== true) {
        throw new BridgeError('CONTINUATION_REQUIRED', `Explicit continue=true is required for Team ${params.teamId}; retry send with the same inputId.`);
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
