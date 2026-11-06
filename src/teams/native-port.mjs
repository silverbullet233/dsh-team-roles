/** Public native Session Remote calls and create-time permission services. */
import { TeamError } from './errors.mjs';
import { Session, appendPluginRecord } from '@deepseek-ai/dsh-session';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval';
import { validateProfile, verifyProfile } from './permission-profile.mjs';
import { isDeepStrictEqual } from 'node:util';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { readTurnResult } from './turn-result.mjs';
import { observeInput, unavailableInput } from './input-observation.mjs';
import { digest } from './private-store.mjs';
import { observeOwnedJobs } from './job-observation.mjs';
import { executionEvidence } from './execution-evidence.mjs';
import { toolReceiptView } from './tool-observation.mjs';

const runtimeIdentity = (ctx, id, agent = ctx.agents.get(id)) => ({ agent, session: agent?.session, registeredSession: ctx.sessions.get(id) });
const sameRuntime = (ctx, id, observed) => observed !== undefined && ctx.agents.get(id) === observed.agent
  && observed.agent?.session === observed.session && ctx.sessions.get(id) === observed.registeredSession;

export class NativeSessionPort {
  constructor(ctx, roles) {
    for (const name of ['connection', 'typertGateway', 'sessionController', 'sessions', 'agents', 'sessionProjections', 'agentTeams']) {
      if (!ctx[name]) throw new TeamError('CAPABILITY_MISSING', `Pinned native runtime requires ${name}.`);
    }
    this.ctx = ctx;
    // Snapshot at startup; later env changes are not evidence of a changed process boundary.
    this.permissionBinding = process.env.DSH_AGENT_TEAM_LAUNCH_PERMISSION_BINDING ?? null;
    // Reporting a launch plan is not an OS probe. Freeze it at host startup so
    // a later environment change cannot pretend to move the running process.
    const execution = process.env.DSH_AGENT_TEAM_LAUNCH_EXECUTION;
    this.permissionExecution = execution === undefined ? null : JSON.parse(execution);
    this.roles = roles;
    this.peer = ctx.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' });
  }

  call(method, request) {
    return this.ctx.typertGateway.invoke({ namespace: 'session', method, args: { request }, peer: this.peer });
  }

  async prepareLead(sessionId, role) {
    if (!this.roles) throw new TeamError('CAPABILITY_MISSING', 'Role plugin is required.');
    await this.roles.prepareLead(sessionId, role);
  }

  create(request) { return this.call('create', request); }
  catalog() { return this.roles.catalog(); }
  permissionServices(required = false) {
    const get = name => typeof this.ctx.get === 'function' ? this.ctx.get(name) : this.ctx[name];
    const presets = get('permissionPresets'), sandbox = get('sandboxPolicy'), approval = get('approval');
    if (presets && sandbox && approval) return { presets, sandbox, approval };
    if (required) throw new TeamError('CAPABILITY_MISSING', 'Native permission preset, sandbox and approval services are required for an explicit preset.');
    return null;
  }
  resolvePermissionPreset(name) {
    const { presets } = this.permissionServices(true);
    if (!presets.catalog().options.some(option => option.value === name)) throw new TeamError('PERMISSION_PRESET_UNAVAILABLE', 'Select an exact available native permission preset from health.');
    const spec = presets.resolve(name);
    if (!['read-only', 'workspace-write', 'danger-full-access'].includes(spec.sandbox) || !['ask', 'never'].includes(spec.approval)) throw new TeamError('CAPABILITY_MISSING', 'Native permission preset has an unsupported bundle.');
    return { preset: name, sandboxMode: spec.sandbox, approvalPolicy: spec.approval };
  }
  permissionCatalog() {
    const services = this.permissionServices();
    if (!services) return null;
    const catalog = services.presets.catalog();
    return { ...structuredClone(catalog), options: catalog.options.map(option => ({ ...option, ...this.resolvePermissionPreset(option.value) })) };
  }
  async permissionSnapshot(sessionId) {
    const services = this.permissionServices();
    if (!services) return null;
    let session = this.ctx.sessions.get(sessionId);
    let asOfSeq = session ? session.seq - 1 : -1;
    if (!session) {
      const query = typeof this.ctx.get === 'function' ? this.ctx.get('sessionQuery') : this.ctx.sessionQuery;
      if (!query?.readSession) throw new TeamError('CAPABILITY_MISSING', 'A read-only native Session query is required to verify restored permissions.');
      const loaded = await query.readSession(sessionId);
      // Detached replay can append a synthetic seed boundary; report only persisted events.
      asOfSeq = loaded.events.at(-1)?.seq ?? -1;
      session = Session.create(sessionId, loaded.events, loaded.session, loaded.inheritedEventCount, this.ctx.sessions.messageProjections);
    }
    return this.permissionsOf(session, asOfSeq);
  }
  permissionsOf(session, asOfSeq = session.seq - 1) {
    const services = this.permissionServices(true);
    return { preset: services.presets.current(session), sandbox: structuredClone(services.sandbox.resolve({ session })), approvalPolicy: services.approval.overrideOf(session) ?? services.approval.config.policy ?? 'ask', asOfSeq };
  }
  applyPermissionPreset(sessionId, intent) {
    const current = this.resolvePermissionPreset(intent.preset);
    if (current.sandboxMode !== intent.sandboxMode || current.approvalPolicy !== intent.approvalPolicy) throw new TeamError('PERMISSION_MISMATCH', 'Native preset definition changed before initialization.');
    this.assertFreshLead(sessionId);
    const session = this.ctx.sessions.get(sessionId);
    this.permissionServices(true).presets.set(session, intent.preset);
  }
  assertFreshLead(sessionId) {
    const session = this.ctx.sessions.get(sessionId), agent = this.ctx.agents.get(sessionId);
    if (!session || agent?.session !== session || agent.status !== 'idle' || session.header.parentSession || session.header.isSeeded || session.firstLiveSeq !== 0
      || agent.inbox.nextTurn.length || agent.inbox.nextStep.length || this.ctx.agentTeams.listMembers(agent).some(member => member.id !== sessionId)
      || session.snapshotEvents().some(event => ['turn/start', 'user/message', 'assistant/message', 'tool/call'].includes(event.type))) {
      throw new TeamError('PERMISSION_INITIALIZATION_INCOMPLETE', 'Permission presets may only be applied to a fresh blank Lead before any task or member.');
    }
  }
  resolvePermissionProfile(value, cwd) {
    const profile = validateProfile(value);
    if (profile.binding !== this.permissionBinding) throw new TeamError('HOST_PERMISSION_MISMATCH', 'This host has a different or unknown launch boundary.');
    const services = this.permissionServices(true);
    const roots = [...new Set([cwd, ...(services.sandbox.additionalWritableRoots ?? [])])].sort();
    if (profile.sandboxMode === 'workspace-write' && !isDeepStrictEqual(roots, profile.writableRoots)) throw new TeamError('PERMISSION_MISMATCH', 'Host writable roots do not match the requested boundary; configure a separate owned host.');
    return profile;
  }
  applyPermissionProfile(sessionId, profile) {
    this.assertFreshLead(sessionId);
    const session = this.ctx.sessions.get(sessionId);
    setSandboxMode(session, profile.sandboxMode);
    setApprovalPolicy(session, profile.approvalPolicy);
  }
  ownPermissionMarkers(session) {
    return session.snapshotEvents().filter(event => event.seq >= session.inheritedEventCount
      && event.type === 'plugin:dsh-team-roles/permission-profile');
  }
  permissionParent(session, agent) {
    const parentId = session.header.parentSession;
    if (!parentId) return undefined;
    const parent = this.ctx.agents.get(parentId);
    const membership = agent && this.ctx.agentTeams.tryMembership(agent);
    // Ancestry alone also describes independent Web forks. Native origin is
    // durable across cold activation; exact runtime ownership covers Team children.
    return session.header.origin === 'subagent'
      || (agent && parent && this.ctx.agents.isOwnedBy(agent.id, parent))
      || (membership?.role === 'teammate' && membership.root.id === parentId) ? parentId : undefined;
  }
  async permissionSession(id) {
    const identity = runtimeIdentity(this.ctx, id);
    let session = identity.registeredSession;
    if (!session) {
      const query = typeof this.ctx.get === 'function' ? this.ctx.get('sessionQuery') : this.ctx.sessionQuery;
      if (!query?.readSession) throw new TeamError('CAPABILITY_MISSING', 'Native Session query is required to verify permission ancestry.');
      const loaded = await query.readSession(id);
      session = Session.create(id, loaded.events, loaded.session, loaded.inheritedEventCount, this.ctx.sessions.messageProjections);
    }
    return { id, session, identity };
  }
  /** Resolve genuine delegation all the way to its managed root, including cold parents. */
  async permissionAncestry(agent, store) {
    let parentId = this.permissionParent(agent.session, agent);
    if (!parentId) {
      if (this.ownPermissionMarkers(agent.session).length) throw new TeamError('PERMISSION_MISMATCH', 'Saved permission intent has no native delegation owner.');
      return null;
    }
    const seen = new Set([agent.id]), ancestors = [];
    while (parentId) {
      if (seen.has(parentId) || seen.size > 128) throw new TeamError('PERMISSION_MISMATCH', 'Permission delegation ancestry is cyclic or exceeds the verification bound.');
      seen.add(parentId);
      const record = await store.get('team', parentId);
      const state = await this.permissionSession(parentId);
      ancestors.push(state);
      if (record) {
        if (record.sessionId !== parentId) throw new TeamError('PERMISSION_MISMATCH', 'Managed permission root identity conflicts with its record.');
        if (record.permissionProfile !== undefined) {
          if (record.stage !== 'created' || !record.permissions) throw new TeamError('PERMISSION_INITIALIZATION_INCOMPLETE', 'The managed root has no verified initial permissions.');
          return { profile: this.resolvePermissionProfile(record.permissionProfile, record.cwd), record, ancestors };
        }
        break;
      }
      parentId = this.permissionParent(state.session, state.identity.agent);
    }
    if ([agent.session, ...ancestors.map(state => state.session)].some(session => this.ownPermissionMarkers(session).length)) {
      throw new TeamError('PERMISSION_INITIALIZATION_INCOMPLETE', 'Saved inherited permission intent has no verified managed root.');
    }
    return null;
  }
  verifyPermissionAncestry({ profile, record, ancestors }) {
    for (const [index, state] of ancestors.entries()) {
      if (!sameRuntime(this.ctx, state.id, state.identity)) throw new TeamError('PERMISSION_MISMATCH', 'Permission ancestor changed during initialization.');
      if (index < ancestors.length - 1) {
        if (this.permissionParent(state.session, state.identity.agent) !== ancestors[index + 1].id) throw new TeamError('PERMISSION_MISMATCH', 'Native permission delegation ownership changed.');
        this.verifyInheritedIntent(state.session, profile);
      }
      const actual = this.permissionsOf(state.session);
      verifyProfile(profile, actual);
      if (index === ancestors.length - 1 && !isDeepStrictEqual(actual.sandbox, record.permissions.sandbox)) throw new TeamError('PERMISSION_MISMATCH', 'Saved root native policy changed.');
    }
  }
  verifyInheritedIntent(session, profile) {
    const markers = this.ownPermissionMarkers(session);
    if (!markers.length) throw new TeamError('PERMISSION_INITIALIZATION_INCOMPLETE', 'A delegated member has no verified inherited permission profile.');
    if (markers.length !== 1 || !isDeepStrictEqual(markers[0].data, profile)) throw new TeamError('PERMISSION_MISMATCH', 'Saved member permission intent conflicts with the managed root.');
  }
  /** Awaited before queued work; only native fresh creation may establish new intent. */
  async inheritPermissions(agent, store, source) {
    const identity = runtimeIdentity(this.ctx, agent.id);
    const ancestry = await this.permissionAncestry(agent, store);
    if (!ancestry) return;
    const { profile } = ancestry;
    const verify = () => {
      if (!sameRuntime(this.ctx, agent.id, identity)) throw new TeamError('PERMISSION_MISMATCH', 'Member changed during permission initialization.');
      if (this.permissionParent(agent.session, agent) !== ancestry.ancestors[0].id) throw new TeamError('PERMISSION_MISMATCH', 'Native member ownership changed during initialization.');
      this.verifyPermissionAncestry(ancestry);
    };
    verify(); // No await between current ancestry checks and policy writes.
    if (!this.ownPermissionMarkers(agent.session).length) {
      const liveEvents = agent.session.snapshotEvents().filter(event => event.seq >= agent.session.firstLiveSeq);
      // A fresh native fork has a seed (and synthetic closers), but no own work.
      // source is the native factory lifecycle discriminator, never header inference.
      if (source !== 'startup' || liveEvents.some(event => ['turn/start', 'user/message', 'assistant/message', 'tool/call'].includes(event.type))) throw new TeamError('PERMISSION_INITIALIZATION_INCOMPLETE', 'A restored or already working member has no verified inherited permission profile.');
      setSandboxMode(agent.session, profile.sandboxMode);
      setApprovalPolicy(agent.session, profile.approvalPolicy);
      appendPluginRecord(agent.session, 'plugin:dsh-team-roles/permission-profile', profile);
      await this.ctx.sessions.flush(agent.session);
      verify();
    }
    this.verifyInheritedIntent(agent.session, profile);
    verifyProfile(profile, this.permissionsOf(agent.session));
  }
  workspacePath(id) {
    const workspace = this.ctx.workspaceRegistry?.get(id);
    if (!workspace) throw new TeamError('WORKSPACE_MISSING', 'The requested native workspace does not exist.');
    return workspace.path;
  }
  async prompt(request, verify) {
    if (!verify) return this.call('prompt', request);
    // Public native Host-domain API; keep all awaits before the final check + synchronous queue write.
    const resolved = await this.ctx.sessionController.resolveAgent(request.sessionId);
    if ('error' in resolved) throw resolved.error;
    const { agent } = resolved;
    if (request.content.some(part => part.type !== 'text')) throw new TeamError('INVALID_REQUEST', 'Managed input is text-only.');
    const attachments = this.ctx.get('attachments'), uploads = this.ctx.get('fileUploads');
    const content = await attachments.admitPromptContent(request.content);
    const message = createUserMessage({ content, source: { kind: 'user', rpcId: request.requestId } });
    if (this.ctx.agents.get(agent.id) !== agent) throw new TeamError('SESSION_MISSING', 'The Lead was disposed during input admission.');
    const binding = uploads.bindPrompt(agent, [], request.requestId);
    try {
      verify(this.permissionsOf(agent.session));
      const matches = message => message.source?.kind === 'user' && message.source.rpcId === request.requestId;
      const duplicate = agent.inbox.nextTurn.some(matches) || agent.inbox.nextStep.some(matches)
        || agent.session.snapshotEvents().some(event => event.type === 'user/message' && matches(event.data));
      if (!duplicate) {
        if (request.mode === 'steer') agent.steer(message);
        else agent.followup(message);
      }
      binding.commit();
      return { accepted: true };
    } finally { binding[Symbol.dispose](); }
  }
  projections(sessionId) { return this.call('projections', { sessionId }); }
  jobs(teamId, limit) { return observeOwnedJobs(this.ctx, id => this.projections(id), teamId, limit); }
  async inputState(sessionId, inputId) {
    let projection;
    try { projection = await this.projections(sessionId); }
    catch { return unavailableInput('NATIVE_READ_FAILED'); }
    return observeInput(projection, inputId);
  }
  checkInputWithdrawal(sessionId, inputId, messageId, hash) {
    const agent = this.ctx.agents.get(sessionId);
    if (!agent || agent.id !== sessionId || agent.session !== this.ctx.sessions.get(sessionId) || agent.session.header.id !== sessionId || agent.session.header.parentSession) {
      throw new TeamError('LIVE_INPUT_REQUIRED', 'Withdrawal requires the existing live managed Lead; cold execution was not resumed.');
    }
    const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep];
    const matches = pending.filter(message => message.source?.kind === 'user' && message.source.rpcId === inputId);
    if (matches.length !== 1 || matches[0].id !== messageId || pending.filter(message => message.id === messageId).length !== 1) {
      throw new TeamError('INPUT_NOT_PENDING', 'The exact input/message pair is no longer uniquely pending. No work was cancelled.');
    }
    const content = matches[0].content;
    if (!Array.isArray(content) || content.length !== 1 || content[0].type !== 'text' || typeof content[0].text !== 'string'
      || !['queue', 'steer'].some(mode => digest({ prompt: content[0].text, mode }) === hash)) {
      throw new TeamError('INPUT_CONTENT_CHANGED', 'Pending text no longer matches the saved admission intent. No work was cancelled.');
    }
    return { agent, session: agent.session };
  }
  async withdrawInput(sessionId, inputId, messageId, hash, checked) {
    // Recheck after the durable intent write. No await separates identity/content
    // checks from the public synchronous Inbox removal; never resolve a cold Agent.
    const { agent, session } = this.checkInputWithdrawal(sessionId, inputId, messageId, hash);
    if (agent !== checked.agent || session !== checked.session) throw new TeamError('INPUT_RUNTIME_CHANGED', 'The checked Lead runtime was replaced during withdrawal admission.');
    if (!agent.inbox.remove(messageId)) throw new TeamError('INPUT_NOT_PENDING', 'The exact message is no longer pending.');
    const asOfSeq = session.seq - 1;
    await this.ctx.sessions.flush(session);
    return { asOfSeq };
  }
  async turnResult(params) {
    const baseline = await this.projections(params.teamId);
    if (baseline === null) throw new TeamError('SESSION_MISSING', 'The native Session is absent.');
    if (baseline.kind !== 'sequenced') throw new TeamError('MIGRATION_REQUIRED', 'Native history requires an explicit supported migration.');
    return readTurnResult(params, request => this.call('events', request));
  }
  cancel(sessionId) { return this.call('cancel', { sessionId }); }

  async flush(sessionId) {
    const session = this.ctx.sessions.get(sessionId);
    if (session !== undefined) await this.ctx.sessions.flush(session);
  }

  async snapshot(sessionId, identities = new Map()) {
    identities.set(sessionId, runtimeIdentity(this.ctx, sessionId));
    const projections = await this.projections(sessionId);
    if (projections === null) throw new TeamError('SESSION_MISSING', 'The native Session is absent; no replacement was created.');
    if (projections.kind !== 'sequenced') throw new TeamError('MIGRATION_REQUIRED', 'The native Session requires an explicit supported migration.');
    const agent = this.ctx.agents.get(sessionId);
    const observation = projections.values.dshBridge;
    if (observation === undefined) throw new TeamError('PROJECTION_MISSING', 'Native dshBridge projection is unavailable.');
    const inbox = projections.values.inbox ?? null;
    const queued = (inbox?.['next-turn']?.length ?? 0) + (inbox?.['next-step']?.length ?? 0) > 0;
    const rootTurnState = agent?.status === 'running' ? 'running' : observation.open ? 'interrupted' : queued ? 'queued' : observation.lastEnd?.reason ?? 'idle';
    const team = projections.values.agentTeam ?? null;
    const liveRoster = agent === undefined ? null : this.ctx.agentTeams.listMembers(agent);
    const members = [];
    const cuts = new Map([[sessionId, projections.asOfSeq]]);
    const toolSamples = new Map([[sessionId, projections.values.dshToolReceipts]]);
    for (const member of team?.members ?? []) {
      const native = liveRoster?.find(row => row.id === member.id);
      const live = this.ctx.agents.get(member.id);
      if (member.id !== sessionId) identities.set(member.id, runtimeIdentity(this.ctx, member.id, live));
      let current = member.id === sessionId ? projections : null;
      if (member.id !== sessionId) current = await this.projections(member.id);
      if (current?.kind === 'sequenced') cuts.set(member.id, current.asOfSeq);
      if (!toolSamples.has(member.id) && toolSamples.size < 32) toolSamples.set(member.id, current?.kind === 'sequenced' ? current.values.dshToolReceipts : undefined);
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
    const bindings = this.roles ? await this.roles.bindings(sessionId) : [];
    const rootNow = this.ctx.agents.get(sessionId);
    const rosterNow = rootNow === undefined ? null : this.ctx.agentTeams.listMembers(rootNow);
    const changed = rootNow !== agent || [...identities].some(([id, observed]) => !sameRuntime(this.ctx, id, observed)) || [...cuts].some(([id, cut]) => {
      const live = this.ctx.sessions.get(id);
      return typeof live?.seq === 'number' && live.seq - 1 !== cut;
    });
    for (const member of members) {
      member.runtimeState = this.ctx.agents.get(member.id)?.status ?? 'unloaded';
      member.nativeStatus = rosterNow?.find(row => row.id === member.id)?.status ?? null;
    }
    const pendingTasks = (team?.tasks ?? []).filter(task => task.status === 'pending' || task.status === 'in_progress').length;
    const active = rootNow?.status === 'running' || rootTurnState === 'running' || members.some(member => member.runtimeState === 'running' || member.nativeStatus === 'running');
    const provisioning = members.some(member => member.phase === 'provisioning' || member.nativeStatus === 'provisioning');
    const failed = team?.failure !== undefined || members.some(member => member.phase === 'failed' || member.nativeStatus === 'failed');
    const pending = queued || pendingTasks > 0 || members.some(member => (member.pendingInputs ?? 0) > 0);
    const unknown = changed || agent === undefined || team === null || liveRoster === null || members.some(member => member.nativeStatus === null || !member.observationAvailable);
    const childInterrupted = members.some(member => member.id !== sessionId && member.openTurn === true && member.runtimeState !== 'running');
    const childIncomplete = members.some(member => member.id !== sessionId && (member.openTurn === true || member.lastTurnOutcome !== 'completed'));
    const rootTurnCompleted = !changed && rootTurnState === 'completed';
    const teamCompleted = active || provisioning || failed || pending || !rootTurnCompleted ? false : unknown ? null : !childIncomplete;
    const activityState = active ? 'running' : provisioning ? 'provisioning' : failed ? 'failed' : pending ? 'pending' : unknown ? 'unknown' : childInterrupted ? 'interrupted' : childIncomplete ? 'incomplete' : 'quiescent';
    return {
      sessionId,
      asOfSeq: projections.asOfSeq,
      asOfSeqScope: 'root-session',
      freshness: { atomic: false, projections: [...identities.keys()].map(id => {
        const cut = cuts.get(id) ?? null, live = this.ctx.sessions.get(id);
        return { sessionId: id, asOfSeq: cut, unchangedAtCheck: cut === null || typeof live?.seq !== 'number' ? null : live.seq - 1 === cut && sameRuntime(this.ctx, id, identities.get(id)) };
      }) },
      runtimeState: rootNow === undefined ? 'unloaded' : rootNow.status,
      taskState: activityState === 'quiescent' ? rootTurnState : activityState,
      rootTurnState: changed ? (rootNow?.status === 'running' ? 'running' : 'unknown') : rootTurnState,
      consistent: !changed,
      rootTurnCompleted,
      teamCompleted,
      teamActivity: { state: activityState, pendingTasks, members },
      toolActivity: { format: 'native-tool-receipts-v1', scope: 'managed-root-and-declared-roster', atomic: false, historyScope: 'latest-started-turn',
        omittedSessions: new Set([sessionId, ...members.map(m => m.id)]).size - toolSamples.size,
        sessions: [...toolSamples].map(([id, state]) => {
          const cut = cuts.get(id) ?? null, live = this.ctx.sessions.get(id);
          return { sessionId: id, asOfSeq: cut, unchangedAtCheck: cut === null || typeof live?.seq !== 'number' ? null : live.seq - 1 === cut && sameRuntime(this.ctx, id, identities.get(id)), ...toolReceiptView(state) };
        }) },
      needsContinuation: agent === undefined || (agent.status !== 'running' && (observation.open || ['interrupted', 'aborted'].includes(observation.lastEnd?.reason))),
      observation,
      team,
      inbox,
      route: {
        selected: rootNow?.model.current() ?? null,
        lastUsed: projections.values.modelSelection?.lastUsed ?? null,
      },
      members: bindings,
      usage: null,
      fees: null,
    };
  }

  /** Native owner authority only; cold/replaced owner runtimes are never resumed. */
  cancelOwnedJobs(sessionId, snapshot, identities, outcomes) {
    let available = snapshot.consistent === true;
    try {
      const registry = typeof this.ctx.get === 'function' ? this.ctx.get('jobs') : this.ctx.jobs;
      if (!registry) return false;
      const owners = new Set([sessionId, ...(snapshot.team?.members ?? []).map(member => member.id)]);
      const root = identities.get(sessionId);
      for (const owner of owners) for (const job of registry.list(owner)) {
        if (job.owner !== owner) continue; // list(caller) also exposes unowned Jobs.
        if (typeof job.id !== 'string' || !job.id.length || Buffer.byteLength(job.id) > 256 || !['running', 'stopping', 'completed', 'killed', 'failed'].includes(job.status)) { available = false; continue; }
        if (!['running', 'stopping'].includes(job.status) || outcomes.has(job.id)) continue;
        const identity = identities.get(owner), agent = this.ctx.agents.get(owner);
        const rootValid = root?.agent && sameRuntime(this.ctx, sessionId, root) && root.session === root.registeredSession
          && root.session?.header.id === sessionId && !root.session.header.parentSession;
        const ownerValid = rootValid && agent && sameRuntime(this.ctx, owner, identity) && identity.session === identity.registeredSession
          && identity.session?.header.id === owner && (owner === sessionId || (identity.session.header.parentSession === sessionId && this.ctx.agentTeams.listMembers(root.agent).some(member => member.id === owner)));
        if (!available || !rootValid || !ownerValid) { outcomes.set(job.id, { id: job.id, owner, cancellation: 'failed', code: 'OWNER_OR_SCOPE_UNAVAILABLE' }); continue; }
        try {
          const cancellation = registry.kill(job.id, owner, 'Managed Team stop requested.');
          outcomes.set(job.id, { id: job.id, owner, cancellation: ['requested', 'already-finished'].includes(cancellation) ? cancellation : 'failed' });
        }
        catch { outcomes.set(job.id, { id: job.id, owner, cancellation: 'failed', code: 'NATIVE_JOB_CANCEL_FAILED' }); }
      }
    } catch { available = false; }
    return available;
  }

  /** Interrupt owned Jobs and children before Lead; delivery can wake the Lead. */
  async stop(sessionId) {
    this.roles?.stopping?.add(sessionId);
    const outcomes = new Map();
    const jobOutcomes = new Map();
    let jobsAvailable = false, execution = null;
    let quiescent = false;
    const deadline = Date.now() + 5000;
    try {
      for (let pass = 0; pass < 6 && Date.now() < deadline; pass++) {
        const identities = new Map();
        const snapshot = await this.snapshot(sessionId, identities);
        jobsAvailable = this.cancelOwnedJobs(sessionId, snapshot, identities, jobOutcomes);
        const roster = snapshot.team?.members ?? [];
        const ids = [...new Set([...roster.filter(member => member.id !== sessionId).map(member => member.id), sessionId])];
        for (const id of ids) {
          const agent = this.ctx.agents.get(id);
          if (agent && !sameRuntime(this.ctx, id, identities.get(id))) { outcomes.set(id, { sessionId: id, cancellation: 'failed', code: 'OWNER_CHANGED' }); continue; }
          if (agent?.status !== 'running') { if (!outcomes.has(id)) outcomes.set(id, { sessionId: id, cancellation: 'inactive' }); continue; }
          try {
            if (id === sessionId) await this.cancel(id);
            else {
              const lead = this.ctx.agents.get(sessionId);
              const member = roster.find(item => item.id === id);
              if (!lead || !member) throw new TeamError('TEAM_UNAVAILABLE', 'Native Team authority is unavailable for interruption.');
              this.ctx.agentTeams.interrupt(lead, member.name);
            }
            if (agent.whenIdle) {
              let timer;
              try { await Promise.race([agent.whenIdle(), new Promise(resolve => { timer = setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now()))); })]); }
              finally { clearTimeout(timer); }
            }
            await this.flush(id);
            outcomes.set(id, { sessionId: id, cancellation: 'requested' });
          } catch (error) { outcomes.set(id, { sessionId: id, cancellation: 'failed', code: error.code ?? 'NATIVE_FAILURE', message: error.message }); }
        }
        // Allow native child-delivery microtasks to settle, then inspect afresh.
        await new Promise(resolve => setTimeout(resolve, 10));
        const after = await this.snapshot(sessionId);
        execution = executionEvidence(after, await this.jobs(sessionId, 1));
        const stillActive = after.consistent !== true || this.roles?.tails?.has(sessionId) || after.runtimeState === 'running'
          || after.teamActivity.members.some(member => member.runtimeState === 'running' || member.nativeStatus === 'running' || member.phase === 'provisioning'
            || member.observationAvailable !== true || member.openTurn || member.pendingInputs !== 0);
        if (!stillActive && execution.ownedJobsSettled === true && pass > 0) { quiescent = true; break; }
      }
      const jobs = [...jobOutcomes.values()];
      return { teamId: sessionId, accepted: jobsAvailable && [...outcomes.values(), ...jobs].every(item => item.cancellation !== 'failed'), quiescent,
        outcomes: [...outcomes.values()], execution,
        jobCancellations: { observed: jobs.length, failed: jobs.filter(job => job.cancellation === 'failed').length, items: jobs.slice(0, 25), omitted: Math.max(0, jobs.length - 25) },
        filesRolledBack: false, pendingInputsRetained: true };
    } finally { this.roles?.stopping?.delete(sessionId); }
  }

  close() { return this.peer.dispose(); }
}
