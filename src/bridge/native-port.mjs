/** Calls the same public Remote methods used by the native Web client. */
import { BridgeError } from './errors.mjs';

export class NativeSessionPort {
  constructor(ctx, roles) {
    for (const name of ['connection', 'typertGateway', 'sessionController', 'sessions', 'agents', 'sessionProjections', 'agentTeams']) {
      if (!ctx[name]) throw new BridgeError('CAPABILITY_MISSING', `Pinned native runtime requires ${name}.`);
    }
    this.ctx = ctx;
    this.roles = roles;
    this.peer = ctx.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' });
  }

  call(method, request) {
    return this.ctx.typertGateway.invoke({ namespace: 'session', method, args: { request }, peer: this.peer });
  }

  async prepareLead(sessionId, role) {
    if (!this.roles) throw new BridgeError('CAPABILITY_MISSING', 'Role plugin is required.');
    await this.roles.prepareLead(sessionId, role);
  }

  create(request) { return this.call('create', request); }
  catalog() { return this.roles.catalog(); }
  workspacePath(id) {
    const workspace = this.ctx.workspaceRegistry?.get(id);
    if (!workspace) throw new BridgeError('WORKSPACE_MISSING', 'The requested native workspace does not exist.');
    return workspace.path;
  }
  prompt(request) { return this.call('prompt', request); }
  projections(sessionId) { return this.call('projections', { sessionId }); }
  cancel(sessionId) { return this.call('cancel', { sessionId }); }

  async flush(sessionId) {
    const session = this.ctx.sessions.get(sessionId);
    if (session !== undefined) await this.ctx.sessions.flush(session);
  }

  async snapshot(sessionId) {
    const projections = await this.projections(sessionId);
    if (projections === null) throw new BridgeError('SESSION_MISSING', 'The native Session is absent; no replacement was created.');
    if (projections.kind !== 'sequenced') throw new BridgeError('MIGRATION_REQUIRED', 'The native Session requires an explicit supported migration.');
    const agent = this.ctx.agents.get(sessionId);
    const observation = projections.values.dshBridge;
    if (observation === undefined) throw new BridgeError('PROJECTION_MISSING', 'Native dshBridge projection is unavailable.');
    const inbox = projections.values.inbox ?? null;
    const queued = (inbox?.['next-turn']?.length ?? 0) + (inbox?.['next-step']?.length ?? 0) > 0;
    const rootTurnState = agent?.status === 'running' ? 'running' : observation.open ? 'interrupted' : queued ? 'queued' : observation.lastEnd?.reason ?? 'idle';
    const team = projections.values.agentTeam ?? null;
    const liveRoster = agent === undefined ? null : this.ctx.agentTeams.listMembers(agent);
    const members = [];
    for (const member of team?.members ?? []) {
      const native = liveRoster?.find(row => row.id === member.id);
      const live = this.ctx.agents.get(member.id);
      let current = member.id === sessionId ? projections : null;
      if (member.id !== sessionId) current = await this.projections(member.id);
      const pending = current?.kind === 'sequenced' ? current.values.inbox : null;
      members.push({
        id: member.id, name: member.name, role: member.role, phase: member.phase,
        nativeStatus: native?.status ?? null,
        runtimeState: live?.status ?? 'unloaded',
        observationAvailable: current?.kind === 'sequenced' && current.values.dshBridge !== undefined && current.values.inbox !== undefined,
        openTurn: current?.kind === 'sequenced' ? current.values.dshBridge?.open ?? null : null,
        pendingInputs: pending === null || pending === undefined ? null : (pending['next-turn']?.length ?? 0) + (pending['next-step']?.length ?? 0),
        lastTurnOutcome: current?.kind === 'sequenced' ? current.values.dshBridge?.lastEnd?.reason ?? null : null,
      });
    }
    const pendingTasks = (team?.tasks ?? []).filter(task => task.status === 'pending' || task.status === 'in_progress').length;
    const active = rootTurnState === 'running' || members.some(member => member.runtimeState === 'running' || member.nativeStatus === 'running');
    const provisioning = members.some(member => member.phase === 'provisioning' || member.nativeStatus === 'provisioning');
    const failed = team?.failure !== undefined || members.some(member => member.phase === 'failed' || member.nativeStatus === 'failed');
    const pending = queued || pendingTasks > 0 || members.some(member => (member.pendingInputs ?? 0) > 0);
    const unknown = agent === undefined || team === null || liveRoster === null || members.some(member => member.nativeStatus === null || !member.observationAvailable);
    const childInterrupted = members.some(member => member.id !== sessionId && member.openTurn === true && member.runtimeState !== 'running');
    const childIncomplete = members.some(member => member.id !== sessionId && (member.openTurn === true || member.lastTurnOutcome !== 'completed'));
    const rootTurnCompleted = rootTurnState === 'completed';
    const teamCompleted = active || provisioning || failed || pending || !rootTurnCompleted ? false : unknown ? null : !childIncomplete;
    const activityState = active ? 'running' : provisioning ? 'provisioning' : failed ? 'failed' : pending ? 'pending' : unknown ? 'unknown' : childInterrupted ? 'interrupted' : childIncomplete ? 'incomplete' : 'quiescent';
    return {
      sessionId,
      asOfSeq: projections.asOfSeq,
      runtimeState: agent === undefined ? 'unloaded' : agent.status,
      taskState: activityState === 'quiescent' ? rootTurnState : activityState,
      rootTurnState,
      rootTurnCompleted,
      teamCompleted,
      teamActivity: { state: activityState, pendingTasks, members },
      needsContinuation: agent === undefined || (agent.status !== 'running' && (observation.open || ['interrupted', 'aborted'].includes(observation.lastEnd?.reason))),
      observation,
      team,
      inbox,
      route: {
        selected: agent?.model.current() ?? null,
        lastUsed: projections.values.modelSelection?.lastUsed ?? null,
      },
      members: this.roles ? await this.roles.bindings(sessionId) : [],
      usage: null,
      fees: null,
    };
  }

  /** Cancels active native Team members; it does not clear inboxes or revert files. */
  async stop(sessionId) {
    const snapshot = await this.snapshot(sessionId);
    const roster = snapshot.team?.members ?? [];
    const ids = new Set([sessionId, ...roster.map(member => member.id)]);
    const outcomes = [];
    for (const id of ids) {
      const agent = this.ctx.agents.get(id);
      if (agent?.status !== 'running') { outcomes.push({ sessionId: id, cancellation: 'inactive' }); continue; }
      try {
        if (id === sessionId) await this.cancel(id);
        else {
          const lead = this.ctx.agents.get(sessionId);
          const member = roster.find(item => item.id === id);
          if (lead === undefined || member === undefined) throw new BridgeError('TEAM_UNAVAILABLE', 'Native Team lead or member is unavailable for interruption.');
          this.ctx.agentTeams.interrupt(lead, member.name);
        }
        await this.flush(id);
        outcomes.push({ sessionId: id, cancellation: 'requested' });
      } catch (error) {
        outcomes.push({ sessionId: id, cancellation: 'failed', code: error.code ?? 'NATIVE_FAILURE', message: error.message });
      }
    }
    return { teamId: sessionId, accepted: outcomes.every(item => item.cancellation !== 'failed'), outcomes, filesRolledBack: false, pendingInputsRetained: true };
  }

  close() { return this.peer.dispose(); }
}
