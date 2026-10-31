import { TypertRemoteService, RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { remote } from './remote.mjs';

/** Owner authority and request authentication are enforced by the native Gateway. */
export class RoleTeamsRemote extends TypertRemoteService {
  static inject = ['typert'];
  constructor(ctx, { teams }) {
    super(ctx, 'roleTeams');
    this.teams = teams;
    ctx.effect(() => ctx.typert.register({ package: remote.package, face: 'host', schemas: [], invocations: remote.descriptors, model: { services: [], events: [], objects: [] } }));
  }
  async invoke(method, request) {
    try { return await this.teams.dispatch(method, request); }
    catch (error) { throw new RemoteError(`team-roles/${error.code ?? 'NATIVE_FAILURE'}`, error.message, {}); }
  }
  health(request) { return this.invoke('health', request); }
  create(request) { return this.invoke('create', request); }
  send(request) { return this.invoke('send', request); }
  status(request) { return this.invoke('status', request); }
  result(request) { return this.invoke('result', request); }
  stop(request) { return this.invoke('stop', request); }
  prepareShutdown(request) { return this.invoke('prepareShutdown', request); }
  activity(request) { return this.invoke('activity', request); }
}
