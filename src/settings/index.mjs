/** Native Settings persistence with asynchronous registry validation before any write. */
import { TypertRemoteService, RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { inputDigest } from '../roles/config.mjs';
import { catalogValue, validateCatalog } from './catalog.mjs';
import { remote } from './remote.mjs';

export class TeamRoleSettings extends TypertRemoteService {
  static inject = ['settings', 'llm', 'typert'];
  constructor(ctx, { hostContext, config }) {
    super(ctx, 'teamRoleSettings');
    this.hostContext = hostContext;
    this.config = config;
    this.tail = Promise.resolve();
    this.approved = null;
    this.lifetime = new AbortController();
    ctx.effect(() => ctx.typert.register({ package: remote.package, face: 'host', schemas: [], invocations: remote.descriptors, model: { services: [], events: [], objects: [] } }));
    ctx.effect(() => ctx.settings.configure({ auto: false }, hostContext.fiber));
    // ConfigEditor invokes this synchronous hook before its atomic write. Only
    // the currently accepted catalog or the exact asynchronously checked save
    // may cross that boundary; raw Settings writes cannot skip route validation.
    const service = this;
    hostContext.on('internal/config', function (_raw, next) {
      if (this !== hostContext.fiber) return next();
      const candidate = next();
      const value = candidate.catalog?.get?.() ?? candidate.catalog;
      catalogValue(value);
      const digest = inputDigest(value);
      if (digest !== inputDigest(config.catalog.get()) && digest !== service.approved) throw new Error('Save role changes from the Team roles settings page to validate the native route');
      return candidate;
    }, { prepend: true });
    ctx.effect(() => () => { this.lifetime.abort(new Error('Role settings were reloaded; reopen the editor before saving')); });
  }

  /** Preserve stale-edit fences from the page while native Settings owns locking and rollback. */
  save(catalog, revision) {
    const task = this.tail.then(async () => {
      try {
        this.lifetime.signal.throwIfAborted();
        await validateCatalog(this.ctx.llm, catalog, this.lifetime.signal);
        this.lifetime.signal.throwIfAborted();
        this.approved = inputDigest(catalog);
        const ns = this.hostContext.fiber.entry?.options.id ?? 'dsh-agent-team';
        await this.ctx.settings.mutate(ns, [{ op: 'set', path: ['catalog'], value: catalog }], revision);
        const descriptor = this.ctx.settings.describe().find(item => item.ns === ns);
        if (!descriptor || inputDigest(this.config.catalog.get()) !== inputDigest(catalog)) throw new Error('Role catalog was not applied; reload settings before retrying');
        return { revision: descriptor.revision, applies: 'new-members' };
      } catch (error) {
        throw new RemoteError(error.code === 'SETTINGS_CONFLICT' ? 'team-roles/conflict' : 'team-roles/rejected', error.message, {});
      } finally { this.approved = null; }
    });
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }
}
