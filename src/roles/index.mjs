/** Native DSH role policy and durable routing for the shared Agent Team service. */
import { Service } from '@deepseek-ai/cordis';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { resolveConfig, memberName, text, inputDigest, routeOf } from './config.mjs';
import { RESERVED, BOUND, initialState, foldRoleState, foldRoleEvents, needsInitialSelection } from './state.mjs';
import { LeadStore } from './lead-store.mjs';
import { disposeContributions } from './lifecycle.mjs';
import { creationGuard } from './admission.mjs';

const bindingSchema = z.object({
  name: z.string(), role: z.string(), description: z.string(), instructions: z.string(),
  provider: z.string(), model: z.string(), reasoningEffort: z.string().optional(),
  inputDigest: z.string(), memberId: z.string().optional(),
});
const requestSchema = z.object({
  provider: z.string(), model: z.string(), reasoningEffort: z.string().nullable(),
  adapterDefaultEffort: z.boolean(), seq: z.number(), time: z.number(),
}).nullable();
const stateSchema = z.object({
  ownFrom: z.number().int().nonnegative(), reservations: z.array(bindingSchema), bound: bindingSchema.nullable(), hasDurableSelection: z.boolean(), hasBoundRequest: z.boolean(), lastRequest: requestSchema,
});
const roleProjection = {
  key: 'dshRoles', stateVersion: 1, stateSchema,
  init: (_header, inheritedEventCount) => initialState(inheritedEventCount),
  apply: foldRoleState,
  wire: { viewSchema: stateSchema, summary: false, view: state => state },
};
const watchedParents = new WeakSet();

function isLocalSubagent(ctx, agent, parent) {
  return agent.session.header.origin === 'subagent'
    || (parent !== undefined && ctx.agents.isOwnedBy(agent.id, parent));
}

/** Keep native child admission closed while the role service is being replaced. */
function watchChildAdmission(parent) {
  if (watchedParents.has(parent)) return;
  const ownerCtx = parent.ctx;
  ownerCtx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession !== parent.id || ownerCtx.agents.get(parent.id) !== parent) return undefined;
    if (!isLocalSubagent(ownerCtx, agent, parent)) return undefined;
    const current = ownerCtx.get('dshRoles');
    if (current === undefined || typeof current.isReady !== 'function' || !current.isReady()) {
      throw new Error('managed role service is unavailable during native child creation');
    }
    return undefined;
  }, { global: true, prepend: true });
  watchedParents.add(parent);
}

/** Service loaded in the same native host as SessionController, Agent Teams, and Web. */
export class DshRoles extends Service {
  static inject = ['agents', 'sessions', 'agentTeams', 'sessionProjections', 'sessionPersistence', 'tools', 'systemPrompt', 'llm'];

  constructor(ctx, config) {
    super(ctx, 'dshRoles');
    this.config = resolveConfig(config);
    this.leads = new LeadStore(this.config.stateDirectory);
    this.tails = new Map();
    this.stopping = new Set();
    this.installed = new Map();
    this.installing = new Map();
    this.uninstalling = new Map();
    this.lifecycle = new AbortController();
    this.ready = false;
    ctx.effect(() => async () => {
      this.lifecycle.abort(new Error('role policy is unloading'));
      await Promise.allSettled([...this.tails.values(), ...this.installing.values()]);
      for (const agent of this.installed.keys()) void this.uninstall(agent);
      const settled = await Promise.allSettled(this.uninstalling.values());
      const errors = settled.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length > 0) throw new AggregateError(errors, 'role service cleanup failed');
    }, 'dshRoles.operations()');
  }

  async [Service.init]() {
    this.projection = await this.ctx.sessionProjections.register(roleProjection);
    await this.leads.prepare();
    this.ctx.on('agent/created', async ({ agent, signal }) => {
      signal?.throwIfAborted();
      await this.install(agent, signal);
      return undefined;
    });
    this.ctx.on('agent/disposed', ({ agent }) => this.uninstall(agent));
    for (const agent of this.ctx.agents.list()) await this.install(agent);
    this.ready = true;
  }

  /** Admission watchers use the current service instance across native HMR replacements. */
  isReady() { return this.ready && !this.lifecycle.signal.aborted; }

  /** Store the Lead profile before the application service calls native session.create. */
  async prepareLead(sessionId, roleName) {
    const old = await this.leads.read(sessionId);
    if (old !== null) {
      if (roleName !== undefined && old.role !== roleName) throw new Error('Lead role conflicts with the durable reservation');
      return old;
    }
    const catalog = this.currentCatalog();
    // No reservation means native model selection and delegation remain in charge.
    // Durable reservations above always win, including after the catalog is cleared.
    if (roleName === undefined && Object.keys(catalog.roles).length === 0) return null;
    return this.leads.reserve(sessionId, this.role(roleName ?? catalog.leadRole));
  }

  currentCatalog() { return this.catalogSource?.() ?? this.config; }

  role(name) {
    if (typeof name !== 'string' || !Object.hasOwn(this.currentCatalog().roles, name)) throw new Error(`role ${String(name)} is not allowlisted`);
    return this.currentCatalog().roles[name];
  }

  /** Public catalog omits model-visible instructions and contains no credentials. */
  catalog() {
    return { configured: Object.keys(this.currentCatalog().roles).length > 0, leadRole: this.currentCatalog().leadRole, roles: Object.entries(this.currentCatalog().roles).map(([name, role]) => ({ name, description: role.description, ...routeOf(role) })) };
  }

  async validateRoute(binding, signal) {
    const info = await this.ctx.llm.resolveModelInfo(binding.provider, binding.model, signal);
    if (binding.reasoningEffort !== undefined && !info.reasoning?.efforts.some(effort => effort.id === binding.reasoningEffort)) {
      throw new Error(`reasoning effort ${binding.reasoningEffort} is unsupported by ${binding.provider}/${binding.model}`);
    }
  }

  /** Resolve only binding metadata. Native Team remains the roster and execution owner. */
  async bindingFor(agent) {
    const state = this.projection.stateOf(agent.session);
    if (state.bound !== null) {
      if (state.bound.memberId !== agent.id) throw new Error('durable role binding identifies a different native member');
      return state.bound;
    }
    const lead = await this.leads.read(agent.id);
    if (lead !== null) return lead;
    const rootId = agent.session.header.parentSession;
    if (rootId === undefined) return null;
    const parent = this.ctx.agents.get(rootId);
    const membership = this.ctx.agentTeams.tryMembership(agent);
    // Native SessionController uses origin or exact runtime ownership to
    // distinguish delegated children from independent Web forks.
    const localSubagent = isLocalSubagent(this.ctx, agent, parent);
    if (!localSubagent && membership?.role !== 'teammate') return null;
    const root = this.ctx.sessions.get(rootId);
    const rootState = root === undefined ? await this.coldState(rootId) : this.projection.stateOf(root);
    const binding = rootState.reservations.find(candidate => candidate.memberId === agent.id) ?? null;
    if (rootState.bound !== null && binding === null) {
      throw new Error('native subagent under a managed parent has no durable role reservation');
    }
    if (binding !== null && (membership?.role !== 'teammate' || membership.root.id !== rootId)) {
      throw new Error('durable role reservation does not match native Team membership');
    }
    return binding;
  }

  /** Awaited by serial agent/created before native queued work can run. */
  install(agent, signal) {
    const pending = this.installing.get(agent);
    if (pending !== undefined) return pending;
    const run = this.installOne(agent, AbortSignal.any([this.lifecycle.signal, ...(signal === undefined ? [] : [signal])]));
    this.installing.set(agent, run);
    const settled = () => { if (this.installing.get(agent) === run) this.installing.delete(agent); };
    void run.then(settled, settled);
    return run;
  }

  async installOne(agent, signal) {
    if (this.installed.has(agent)) return;
    await this.uninstalling.get(agent);
    signal.throwIfAborted();
    const binding = await this.bindingFor(agent);
    if (binding === null) return;
    if (needsInitialSelection(this.projection.stateOf(agent.session))) await this.validateRoute(binding, signal);
    signal.throwIfAborted();
    const state = this.projection.stateOf(agent.session);
    if (state.bound === null) appendPluginRecord(agent.session, BOUND, binding);
    if (needsInitialSelection(state)) agent.model.select(routeOf(binding));
    const disposers = [];
    try {
      disposers.push(agent.ctx.systemPrompt.context({
        name: 'dsh-agent-team-role', order: 126, required: true, interpolate: false,
        text: `Role: ${binding.role}\nResponsibility: ${binding.description}\n\n${binding.instructions}`,
      }));
      // This Agent-owned monotonic policy survives role-service reloads. Removing
      // the enhanced tool must never reopen native unrestricted creation.
      agent.ctx.tools.guard(creationGuard);
      watchChildAdmission(agent);
      if (binding.name === 'lead') this.installSpawn(agent, disposers);
      await this.ctx.sessions.flush(agent.session);
      signal.throwIfAborted();
      this.installed.set(agent, disposers);
    } catch (error) {
      try { await disposeContributions(disposers); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'role installation and rollback failed'); }
      throw error;
    }
  }

  uninstall(agent) {
    const pending = this.uninstalling.get(agent);
    if (pending !== undefined) return pending;
    const disposers = this.installed.get(agent);
    this.installed.delete(agent);
    if (disposers === undefined) return Promise.resolve();
    const run = disposeContributions(disposers);
    this.uninstalling.set(agent, run);
    const settled = () => { if (this.uninstalling.get(agent) === run) this.uninstalling.delete(agent); };
    void run.then(settled, settled);
    return run;
  }

  installSpawn(agent, disposers) {
    disposers.push(agent.ctx.tools.register(defineTool({
      name: 'spawn_role_teammate',
      description: 'Create a native durable teammate using one allowlisted role. Existing names preserve the same member and role snapshot.',
      parameters: {
        name: { type: 'string', required: true, description: 'Unique lower-kebab-case instance name. Multiple instances may use the same role.' },
        role: { type: 'string', required: true, description: 'Allowlisted role with its configured instructions and LLM route.' },
        prompt: { type: 'string', required: true, description: 'Complete text-only synthetic or explicitly authorized task.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          target: { type: 'string', required: true }, memberId: { type: 'string', required: true }, role: { type: 'string', required: true },
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args, exec) => {
        if (exec.agent !== agent) throw new Error('role spawn requires the exact Lead Agent');
        const result = await this.spawn(agent, { ...args, signal: exec.signal });
        return { target: result.member.name, memberId: result.member.id, role: args.role };
      },
    })));
    disposers.push(agent.ctx.systemPrompt.context({
      name: 'dsh-agent-team-role-catalog', order: 127, required: true, interpolate: false,
      text: () => `Create teammates only through spawn_role_teammate and an allowlisted role. The native spawn_teammate tool remains visible for native compatibility, but this Team's policy always refuses its execution. The native spawn backend is not an LLM provider. Role catalog:\n${Object.entries(this.currentCatalog().roles).map(([name, role]) => `${name}: ${role.description} (${role.provider}/${role.model}${role.reasoningEffort ? `, effort ${role.reasoningEffort}` : ''})`).join('\n')}`,
    }));
  }

  /** Reserve the immutable snapshot before calling native Team provisioning. */
  async spawn(caller, request) {
    request = { ...request, signal: AbortSignal.any([request.signal, this.lifecycle.signal]) };
    memberName(request.name);
    text(request.prompt, 'prompt');
    request.signal.throwIfAborted();
    if (this.stopping.has(caller.id)) throw new Error('Team stopping is in progress; retry explicitly afterwards');
    const membership = this.ctx.agentTeams.membership(caller);
    if (membership.role !== 'lead') throw new Error('only the native Team Lead can spawn a role');
    const leadBinding = this.projection.stateOf(caller.session).bound;
    if (leadBinding?.name !== 'lead' || leadBinding.memberId !== caller.id) throw new Error('Lead must have a matching durable role binding');
    const prior = this.tails.get(caller.id) ?? Promise.resolve();
    const run = prior.then(async () => {
      request.signal.throwIfAborted();
      if (this.stopping.has(caller.id)) throw new Error('Team stopping is in progress');
      const digest = inputDigest({ name: request.name, role: request.role, prompt: request.prompt });
      let binding = this.projection.stateOf(caller.session).reservations.find(item => item.name === request.name);
      if (binding !== undefined) {
        if (binding.role !== request.role || binding.inputDigest !== digest) throw new Error('member name conflicts with the durable role or initial content');
        if (binding.memberId !== undefined) {
          const member = this.ctx.agentTeams.listMembers(caller).find(item => item.id === binding.memberId);
          if (member === undefined) throw new Error('bound member is missing from the native roster');
          if (member.status === 'failed' || member.status === 'provisioning') throw new Error(`native member is ${member.status}; inspect status and continue explicitly`);
          return { member };
        }
      } else {
        const snapshot = this.role(request.role);
        await this.validateRoute(snapshot, request.signal);
        binding = { name: request.name, ...snapshot, inputDigest: digest };
        appendPluginRecord(caller.session, RESERVED, binding);
        await this.ctx.sessions.flush(caller.session);
      }
      return this.ctx.agentTeams.spawnTeammate(caller, {
        name: request.name, description: binding.description,
        prompt: [{ type: 'text', text: request.prompt }], context: 'fresh',
        provider: this.config.spawnProvider, signal: request.signal,
      });
    });
    const tail = run.then(() => undefined, () => undefined);
    this.tails.set(caller.id, tail);
    try { return await run; }
    finally { if (this.tails.get(caller.id) === tail) this.tails.delete(caller.id); }
  }

  /** Explicit bounded-lifetime cold metadata inspection through the native read service. */
  async coldState(sessionId) {
    const handle = await this.ctx.sessionPersistence.open(sessionId, 'read');
    try {
      const { events } = await handle.read(0);
      return foldRoleEvents(events, handle.inheritedEventCount);
    } finally { await handle.close(); }
  }

  /** Current selection is unknown for unloaded members; lastRequest remains durable evidence. */
  async status(memberId, binding) {
    const session = this.ctx.sessions.get(memberId);
    const state = session === undefined ? await this.coldState(memberId) : this.projection.stateOf(session);
    const live = this.ctx.agents.get(memberId);
    const actualBinding = state.bound ?? binding;
    if (actualBinding === undefined || actualBinding === null) throw new Error('member has no role binding');
    return {
      memberId, name: actualBinding.name, role: actualBinding.role, description: actualBinding.description,
      configured: routeOf(actualBinding), selected: live?.model.current() ?? null,
      lastRequest: state.lastRequest,
    };
  }

  /** Native roster identities plus role metadata; does not maintain a second roster. */
  async bindings(rootSessionId) {
    const session = this.ctx.sessions.get(rootSessionId);
    const state = session === undefined ? await this.coldState(rootSessionId) : this.projection.stateOf(session);
    const result = [];
    if (state.bound !== null) result.push(await this.status(rootSessionId, state.bound));
    for (const binding of state.reservations) {
      if (binding.memberId === undefined) {
        result.push({ memberId: null, name: binding.name, role: binding.role, description: binding.description,
          configured: routeOf(binding), selected: null, lastRequest: null });
      } else {
        try { result.push(await this.status(binding.memberId, binding)); }
        catch (error) {
          result.push({ memberId: binding.memberId, name: binding.name, role: binding.role,
            configured: routeOf(binding), selected: null, lastRequest: null, error: String(error.message) });
        }
      }
    }
    return result;
  }
}

export default DshRoles;
