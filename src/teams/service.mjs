/** Idempotent admission metadata over the native Session service. */
import { API_NAME, API_VERSION, CAPABILITIES } from './capabilities.mjs';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { TeamError, object, text } from './errors.mjs';
import { digest } from './private-store.mjs';
import { isDeepStrictEqual } from 'node:util';
import { validateProfile, verifyProfile } from './permission-profile.mjs';
import { executionEvidence } from './execution-evidence.mjs';

function verifyPermissions(intent, actual, saved) {
  if (!actual || actual.preset !== intent.preset || actual.sandbox?.mode !== intent.sandboxMode || actual.approvalPolicy !== intent.approvalPolicy
    || (saved && (!isDeepStrictEqual(actual.sandbox, saved.sandbox) || actual.preset !== saved.preset || actual.approvalPolicy !== saved.approvalPolicy))) {
    throw new TeamError('PERMISSION_MISMATCH', 'Effective native permissions differ from the verified create intent; no permission fallback or upgrade was attempted.');
  }
}

/** Serialization is admission-only. DSH remains the sole execution scheduler. */
export class ManagedTeams {
  constructor({ native, store, allowedRoots, sourceSha = null, runtimeEvidence = null }) {
    if (allowedRoots !== undefined && (!Array.isArray(allowedRoots) || allowedRoots.length === 0 || allowedRoots.some(root => typeof root !== 'string' || !isAbsolute(root)))) {
      throw new TeamError('INVALID_CONFIG', 'allowedRoots, when configured, must contain explicit absolute workspace roots.');
    }
    this.native = native;
    this.store = store;
    this.allowedRoots = allowedRoots === undefined ? undefined : [...allowedRoots];
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
    if (!(await stat(directory)).isDirectory()) throw new TeamError('WORKSPACE_DENIED', 'cwd must be an existing directory.');
    // This is an optional admission allowlist, never a grant of native authority.
    if (this.allowedRoots === undefined) return directory;
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

  async permissions(record) {
    if (record.permissionProfile !== undefined) {
      if (record.stage !== 'created' || !record.permissions) throw new TeamError('PERMISSION_INITIALIZATION_INCOMPLETE', `Team ${record.sessionId} has unverified initial permissions.`);
      const profile = this.native.resolvePermissionProfile(record.permissionProfile, record.cwd);
      const actual = await this.native.permissionSnapshot(record.sessionId);
      verifyProfile(profile, actual);
      if (!isDeepStrictEqual(actual.sandbox, record.permissions.sandbox)) throw new TeamError('PERMISSION_MISMATCH', 'Saved native policy changed.');
      return actual;
    }
    if (record.permissionPreset === undefined) return await this.native.permissionSnapshot?.(record.sessionId) ?? null;
    if (record.stage !== 'created' || !record.permissionIntent || !record.permissions) throw new TeamError('PERMISSION_INITIALIZATION_INCOMPLETE', `Team ${record.sessionId} has unverified initial permissions; inspect it before using a new create key. No task was submitted.`);
    const intent = await this.native.resolvePermissionPreset(record.permissionPreset);
    if (!isDeepStrictEqual(intent, record.permissionIntent)) throw new TeamError('PERMISSION_MISMATCH', 'The native permission preset definition changed; existing Teams are never upgraded on retry.');
    const actual = await this.native.permissionSnapshot(record.sessionId);
    verifyPermissions(intent, actual, record.permissions);
    return actual;
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
      case 'health': {
        object(params, []);
        const home = this.native.ctx.get?.('profileContext')?.home;
        return { ok: true, api: { name: API_NAME, version: API_VERSION, capabilities: CAPABILITIES }, sourceSha: this.sourceSha, runtime: this.runtimeEvidence, roles: await this.native.catalog?.() ?? null, permissionPresets: await this.native.permissionCatalog?.() ?? null, transport: 'native-typert-gateway', service: 'native-session', modalities: ['text'], ownsExecution: false, host: { pid: process.pid, instanceId: process.env.DSH_OWNED_INSTANCE_ID ?? null, home: home ? await realpath(home) : null, permissionBinding: this.native.permissionBinding ?? null, permissionExecution: structuredClone(this.native.permissionExecution ?? null) } };
      }
      case 'create': return this.create(params);
      case 'send': return this.send(params);
      case 'status': return this.status(params);
      case 'result': return this.result(params);
      case 'input': return this.input(params);
      case 'withdrawInput': return this.withdrawInput(params);
      case 'jobs':
        object(params, ['teamId', 'limit']);
        await this.record(params.teamId);
        return { teamId: params.teamId, ...await this.native.jobs(params.teamId, params.limit) };
      case 'turnResult':
        object(params, ['teamId', 'turn', 'resultRef', 'offset', 'maxBytes']);
        await this.record(params.teamId);
        return this.native.turnResult(params);
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
    const blockers = [];
    const owners = new Set(agents.map(agent => agent.id));
    // Establish one owner scope before comparing Job baselines. A retained
    // settled Job of a cold member must not look like newly started work.
    for (const record of records) {
      try {
        const state = await this.native.snapshot(record.sessionId);
        for (const member of state.teamActivity.members) owners.add(member.id);
      } catch { unsettled.push(record.sessionId); }
    }
    // list() without a caller sees only unowned Jobs. Include every known
    // owner, including cold roster members, without consuming Job output.
    const registry = typeof this.native.ctx.get === 'function' ? this.native.ctx.get('jobs') : this.native.ctx.jobs;
    const readJobs = () => {
      if (!registry) return [];
      const jobs = new Map();
      for (const owner of [undefined, ...owners]) {
        for (const job of registry.list(owner)) jobs.set(job.id, { id: job.id, owner: job.owner ?? null, status: job.status });
      }
      return [...jobs.values()].sort((a, b) => a.id.localeCompare(b.id));
    };
    let beforeJobs;
    try { beforeJobs = readJobs(); }
    catch { blockers.push({ kind: 'job-observation-unavailable' }); }
    for (const record of records) {
      try {
        const state = await this.native.snapshot(record.sessionId);
        const activity = state.teamActivity;
        for (const member of activity.members) owners.add(member.id);
        if (activity.pendingTasks > 0) blockers.push({ kind: 'unfinished-tasks', teamId: record.sessionId, count: activity.pendingTasks });
        for (const member of activity.members) {
          if (member.runtimeState === 'unloaded' && member.lastTurnOutcome !== 'completed') blockers.push({ kind: 'unloaded-member-not-completed', teamId: record.sessionId, sessionId: member.id, outcome: member.lastTurnOutcome ?? null });
        }
        const unresolved = !Array.isArray(state.members) || state.members.some(binding => !binding.memberId || binding.error || !activity.members.some(member => member.id === binding.memberId));
        const coldComplete = state.runtimeState === 'unloaded' && state.team !== null && activity.members.some(member => member.id === record.sessionId) && state.rootTurnCompleted && !state.team?.failure && activity.pendingTasks === 0
          && activity.members.every(member => member.observationAvailable && !member.openTurn && member.pendingInputs === 0 && member.lastTurnOutcome === 'completed' && member.phase !== 'provisioning');
        if (state.consistent !== true || unresolved || activity.members.some(member => member.openTurn || member.pendingInputs !== 0 || member.phase === 'provisioning' || (member.runtimeState === 'unloaded' && member.lastTurnOutcome !== 'completed'))
          || activity.pendingTasks > 0 || state.observation.open || ['running', 'provisioning'].includes(activity.state) || (activity.state === 'unknown' && !coldComplete)) unsettled.push(record.sessionId);
      } catch { unsettled.push(record.sessionId); }
    }
    // Inspect unmanaged Web Sessions too; empty inboxes alone do not settle an open turn or shared task.
    for (const agent of agents) {
      const projections = await this.native.projections(agent.id);
      const values = projections?.kind === 'sequenced' ? projections.values : null;
      const inbox = values?.inbox;
      const live = this.native.ctx.sessions.get(agent.id);
      if (inbox === null || inbox === undefined || values?.dshBridge === undefined || values.dshBridge.open
        || (inbox['next-turn']?.length ?? 0) + (inbox['next-step']?.length ?? 0) > 0
        || values.agentTeam?.tasks?.some(task => ['pending', 'in_progress'].includes(task.status))
        || values.agentTeam?.members?.some(member => member.phase === 'provisioning')
        || !live || live.seq - 1 !== projections.asOfSeq) unsettled.push(agent.id);
    }
    const agentsNow = this.native.ctx.agents.list();
    unsettled.push(...agentsNow.filter(agent => !agents.includes(agent)).map(agent => agent.id));
    const runningNow = agentsNow.filter(agent => agent.status === 'running').map(agent => agent.id);
    busy.push(...runningNow.filter(id => !busy.includes(id)));
    for (const agent of agentsNow) owners.add(agent.id);
    try {
      const jobs = readJobs();
      for (const job of jobs) if (['running', 'stopping'].includes(job.status)) blockers.push({ kind: 'native-job', ...job });
      // A Job can start and settle while asynchronous Session reads run. Do
      // not bless that changing baseline, even if the last read is idle.
      if (beforeJobs && !isDeepStrictEqual(beforeJobs, jobs)) blockers.push({ kind: 'job-state-changed' });
    } catch { blockers.push({ kind: 'job-observation-unavailable' }); }
    return { safeToStop: (this.native.roles?.tails?.size ?? 0) === 0 && this.pending.size <= 1 && (this.httpAdmissions ?? 0) <= 1 && busy.length === 0 && unsettled.length === 0 && blockers.length === 0,
      running: busy, unsettled: [...new Set(unsettled)], admissions: Math.max(0, this.pending.size - 1), blockers };
  }

  async create(params) {
    object(params, ['key', 'text', 'cwd', 'workspaceId', 'agentPreset', 'leadRole', 'permissionPreset', 'permissionProfile']);
    const key = text(params.key, 'key', 256);
    const prompt = text(params.text, 'text');
    const cwd = await this.workspace(params.cwd);
    const workspaceId = params.workspaceId === undefined ? undefined : text(params.workspaceId, 'workspaceId', 256);
    const agentPreset = params.agentPreset === undefined ? undefined : text(params.agentPreset, 'agentPreset', 256);
    const leadRole = params.leadRole === undefined ? undefined : text(params.leadRole, 'leadRole', 128);
    const permissionPreset = params.permissionPreset === undefined ? undefined : text(params.permissionPreset, 'permissionPreset', 256);
    const permissionProfile = params.permissionProfile === undefined ? undefined : this.native.resolvePermissionProfile(validateProfile(params.permissionProfile), cwd);
    if (permissionProfile && permissionPreset !== undefined) {
      const preset = await this.native.resolvePermissionPreset(permissionPreset);
      if (preset.sandboxMode !== permissionProfile.sandboxMode || preset.approvalPolicy !== permissionProfile.approvalPolicy) throw new TeamError('PERMISSION_MISMATCH', 'Explicit preset differs from the authorized exact profile.');
    }
    if (workspaceId !== undefined && await this.workspace(this.native.workspacePath(workspaceId)) !== cwd) {
      throw new TeamError('WORKSPACE_DENIED', 'The native workspace path differs from cwd.');
    }
    const hash = digest({ prompt, cwd, workspaceId, agentPreset, leadRole, permissionPreset, ...(permissionProfile === undefined ? {} : { permissionProfile }) });
    let reservedId;
    return this.serial(`key:${key}`, async () => {
      let record = await this.store.get('key', key);
      if (record !== undefined && record.digest !== hash) throw new TeamError('CONTENT_CONFLICT', 'The create key is already bound to different content.');
      if (record === undefined) {
        const permissionIntent = permissionPreset === undefined ? undefined : await this.native.resolvePermissionPreset(permissionPreset);
        record = { sessionId: randomUUID(), inputId: `create-${digest(key)}`, digest: hash, cwd, stage: 'reserved', createdAt: Date.now(), ...(permissionProfile === undefined ? {} : { permissionProfile }), ...(permissionPreset === undefined ? {} : { permissionPreset, permissionIntent }) };
        await this.store.set('key', key, record);
      }
      reservedId = record.sessionId;
      await this.store.set('team', record.sessionId, record);
      const existing = await this.native.projections(record.sessionId);
      if (existing === null) {
        if (record.stage !== 'reserved') throw new TeamError('SESSION_MISSING', 'The reserved native Session disappeared; no replacement was created.');
        await this.native.prepareLead(record.sessionId, leadRole);
        const created = await this.native.create({ sessionId: record.sessionId, ...(workspaceId === undefined ? { cwd } : { workspaceId }), ...(agentPreset === undefined ? {} : { agentPreset }) });
        if (created.sessionId !== record.sessionId) throw new TeamError('SESSION_CONFLICT', 'Native create returned another Session; admission stopped.');
        await this.native.flush(record.sessionId);
        if (permissionPreset !== undefined || permissionProfile !== undefined) {
          try {
            if (permissionPreset !== undefined) await this.native.applyPermissionPreset(record.sessionId, record.permissionIntent);
            else await this.native.applyPermissionProfile(record.sessionId, permissionProfile);
            await this.native.flush(record.sessionId);
            const permissions = await this.native.permissionSnapshot(record.sessionId);
            if (permissionProfile !== undefined) verifyProfile(permissionProfile, permissions);
            else verifyPermissions(record.permissionIntent, permissions);
            record = { ...record, permissions };
          } catch (error) {
            if (error instanceof TeamError) throw new TeamError(error.code, `Team ${record.sessionId}: ${error.message}`);
            throw new TeamError('PERMISSION_INITIALIZATION_INCOMPLETE', `Permission initialization for Team ${record.sessionId} did not complete. No task was submitted; inspect the reserved Session before using a new key.`);
          }
        }
      } else if (permissionPreset !== undefined || permissionProfile !== undefined) {
        await this.permissions(record);
      }
      record = { ...record, stage: 'created' };
      await this.store.set('key', key, record);
      await this.store.set('team', record.sessionId, record);
      const permissions = await this.permissions(record);
      let acceptance;
      try {
        acceptance = await this.send({ teamId: record.sessionId, inputId: record.inputId, text: prompt, mode: 'queue' });
      } catch (error) {
        if (!(error instanceof TeamError) || error.code !== 'CONTINUATION_REQUIRED') throw error;
        const receipt = await this.store.get('input', [record.sessionId, record.inputId]);
        acceptance = { accepted: receipt === undefined ? false : null, processed: null, requiresContinuation: true };
      }
      return { teamId: record.sessionId, sessionId: record.sessionId, inputId: record.inputId, ...acceptance, permissions, ...(permissionProfile === undefined ? {} : { permissionProfile }) };
    }).catch(error => {
      if (reservedId && !(error instanceof TeamError && error.message.includes(reservedId))) {
        throw new TeamError(error instanceof TeamError ? error.code : 'NATIVE_FAILURE', `Team ${reservedId}: ${error instanceof TeamError ? error.message : 'Native creation or input admission failed. Inspect this reserved Session before retrying.'}`);
      }
      throw error;
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
      const admission = await this.record(params.teamId);
      if (admission.permissionPreset !== undefined || admission.permissionProfile !== undefined) await this.permissions(admission);
      const receiptKey = [params.teamId, inputId];
      const hash = digest({ prompt, mode });
      const receipt = await this.store.get('input', receiptKey);
      if (receipt !== undefined && receipt.digest !== hash) throw new TeamError('CONTENT_CONFLICT', 'The input ID is already bound to different content.');
      if (receipt?.withdrawal) throw new TeamError(receipt.withdrawal.state === 'withdrawn' ? 'INPUT_WITHDRAWN' : 'WITHDRAWAL_UNCERTAIN', 'This input has a withdrawal intent; it will not be resubmitted. Inspect its evidence and use a new input ID only for explicitly authorized new work.');
      if (receipt?.accepted === true) return { teamId: params.teamId, inputId, accepted: true, processed: null, duplicate: true };
      const snapshot = await this.native.snapshot(params.teamId);
      if (snapshot.needsContinuation && params.continue !== true) {
        throw new TeamError('CONTINUATION_REQUIRED', `Explicit continue=true is required for Team ${params.teamId}; retry send with the same inputId.`);
      }
      await this.store.set('input', receiptKey, { teamId: params.teamId, inputId, digest: hash, accepted: false });
      const verify = admission.permissionProfile !== undefined ? actual => {
        this.native.resolvePermissionProfile(admission.permissionProfile, admission.cwd);
        verifyProfile(admission.permissionProfile, actual);
        if (!isDeepStrictEqual(actual.sandbox, admission.permissions.sandbox)) throw new TeamError('PERMISSION_MISMATCH', 'Saved native policy changed during admission.');
      } : admission.permissionPreset === undefined ? undefined : actual => {
        const intent = this.native.resolvePermissionPreset(admission.permissionPreset);
        if (!isDeepStrictEqual(intent, admission.permissionIntent)) throw new TeamError('PERMISSION_MISMATCH', `Team ${admission.sessionId}: the permission preset definition changed during input admission.`);
        verifyPermissions(intent, actual, admission.permissions);
      };
      await this.native.prompt({ requestId: inputId, sessionId: params.teamId, mode, content: [{ type: 'text', text: prompt }] }, verify);
      await this.native.flush(params.teamId);
      await this.store.set('input', receiptKey, { teamId: params.teamId, inputId, digest: hash, accepted: true });
      return { teamId: params.teamId, inputId, accepted: true, processed: null, duplicate: false };
    });
  }

  async status(params) {
    object(params, ['teamId']);
    const record = await this.record(params.teamId);
    const snapshot = await this.native.snapshot(params.teamId);
    // Passive policy read for clients admitting interaction replies. The saved
    // intent alone does not establish the current native sandbox or approval.
    const permissions = await this.native.permissionSnapshot?.(params.teamId) ?? null;
    return { teamId: params.teamId, createdAt: record.createdAt, permissionProfile: record.permissionProfile ?? null, ...snapshot, permissions };
  }

  async result(params) {
    const status = await this.status(params);
    const execution = executionEvidence(status, await this.native.jobs?.(params.teamId, 1));
    return {
      teamId: params.teamId,
      taskState: status.taskState,
      runtimeState: status.runtimeState,
      rootTurnState: status.rootTurnState,
      rootTurnCompleted: status.rootTurnCompleted,
      completed: execution.completed,
      nativeTeamCompleted: execution.nativeTeamCompleted,
      execution,
      teamActivity: status.teamActivity,
      toolActivity: status.toolActivity,
      output: status.observation.output,
      outputSource: status.observation.outputSource ?? null,
      latestAssistant: status.observation.latestAssistant ?? null,
      turns: { latestStarted: { turn: status.observation.turn, startSeq: status.observation.turnStartSeq ?? null }, active: status.observation.open ? status.observation.turn : null,
        lastEnded: status.observation.lastEnd, lastCompleted: status.observation.lastCompletedTurn ?? null },
      errors: status.observation.errors,
      inputs: status.observation.inputs,
      asOfSeq: status.asOfSeq,
      asOfSeqScope: status.asOfSeqScope ?? 'root-session',
      freshness: status.freshness ?? null,
      usage: null,
      fees: null,
    };
  }

  async input(params) {
    object(params, ['teamId', 'inputId']);
    await this.record(params.teamId);
    const inputId = text(params.inputId, 'inputId', 256);
    const receipt = await this.store.get('input', [params.teamId, inputId]);
    if (receipt === undefined) throw new TeamError('UNKNOWN_INPUT', 'This service has no admission intent for the requested Team/input ID.');
    return { teamId: params.teamId, inputId, admission: { state: receipt.accepted === true ? 'acknowledged' : 'unconfirmed' }, withdrawal: receipt.withdrawal ?? null,
      native: await this.native.inputState(params.teamId, inputId), goalAccepted: null };
  }

  async withdrawInput(params) {
    object(params, ['teamId', 'inputId', 'expectedMessageId']);
    await this.record(params.teamId);
    const inputId = text(params.inputId, 'inputId', 256), messageId = text(params.expectedMessageId, 'expectedMessageId', 256);
    return this.serial(`team:${params.teamId}`, async () => {
      const key = [params.teamId, inputId], receipt = await this.store.get('input', key);
      if (!receipt) throw new TeamError('UNKNOWN_INPUT', 'This service has no admission intent for the requested Team/input ID.');
      if (receipt.withdrawal?.messageId !== undefined && receipt.withdrawal.messageId !== messageId) throw new TeamError('CONTENT_CONFLICT', 'A withdrawal is already bound to another native message ID.');
      if (receipt.withdrawal?.state === 'withdrawn') return { teamId: params.teamId, inputId, ...receipt.withdrawal, duplicate: true, filesRolledBack: false };
      let checked;
      try { checked = this.native.checkInputWithdrawal(params.teamId, inputId, messageId, receipt.digest); }
      catch (error) {
        if (receipt.withdrawal) throw new TeamError('WITHDRAWAL_UNCERTAIN', 'A previous withdrawal remains unconfirmed; missing pending evidence does not prove success. No cold work was resumed.');
        throw error;
      }
      const intent = { messageId, state: 'unconfirmed' };
      try {
        await this.store.set('input', key, { ...receipt, withdrawal: intent });
        const cut = await this.native.withdrawInput(params.teamId, inputId, messageId, receipt.digest, checked);
        const withdrawal = { ...intent, state: 'withdrawn', asOfSeq: cut.asOfSeq };
        await this.store.set('input', key, { ...receipt, withdrawal });
        return { teamId: params.teamId, inputId, ...withdrawal, duplicate: false, filesRolledBack: false };
      } catch { throw new TeamError('WITHDRAWAL_UNCERTAIN', 'Withdrawal may have occurred but its durable receipt is unconfirmed. Retain the exact IDs and inspect evidence; do not resend or infer success from absence.'); }
    });
  }
}
