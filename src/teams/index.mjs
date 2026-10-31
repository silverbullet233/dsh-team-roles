/** Transport-neutral managed-Team operations on the ordinary native host. */
import { join } from 'node:path';
import { TeamStore } from './private-store.mjs';
import { ManagedTeams } from './service.mjs';
import { NativeSessionPort } from './native-port.mjs';
import { teamObservationProjection } from './projection.mjs';
import { RoleTeamsRemote } from './remote-service.mjs';
import { TeamError } from './errors.mjs';
import { verifyRuntime } from '../../scripts/runtime/verify.mjs';

export const name = 'dsh-role-teams';
export const inject = ['connection', 'typertGateway', 'sessionController', 'sessionProjections', 'sessions', 'agents', 'agentTeams', 'workspaceRegistry', 'dshRoles'];

/** A plugin-local verified import cannot establish the identity of an unrelated serving host. */
export async function assertNativeHost(ctx) {
  const [agent, session, controller, team, connection, gateway] = await Promise.all([
    import('@deepseek-ai/dsh-agent'), import('@deepseek-ai/dsh-session'),
    import('@deepseek-ai/dsh-api-session-controller'), import('@deepseek-ai/dsh-experimental-agent-team'),
    import('@deepseek-ai/dsh-client-connection'), import('@deepseek-ai/dsh-api-gateway'),
  ]);
  for (const [name, implementation] of [
    ['agents', agent.AgentRegistry], ['sessions', session.SessionStore],
    ['sessionController', controller.SessionController], ['agentTeams', team.TeamService],
    ['connection', connection.HostConnectionService], ['typertGateway', gateway.TypertGatewayService],
  ]) {
    if (!(ctx[name] instanceof implementation)) {
      throw new TeamError('HOST_RUNTIME_MISMATCH', `The serving ${name} service does not belong to the verified native runtime.`);
    }
  }
}

/** Compose into an ordinary matching host; Connection owns authentication and transport. */
export async function apply(ctx, config) {
  if (!config || typeof config.stateDirectory !== 'string') {
    throw new TeamError('INVALID_CONFIG', 'stateDirectory is required.');
  }
  const runtimeEvidence = await verifyRuntime({ context: ctx });
  await assertNativeHost(ctx);
  const { z } = await import('zod');
  const projection = await ctx.sessionProjections.register(teamObservationProjection(z));
  const store = await new TeamStore(join(config.stateDirectory, 'bridge')).open();
  let native;
  let teams;
  try {
    native = new NativeSessionPort(ctx, ctx.dshRoles);
    teams = new ManagedTeams({ native, store, allowedRoots: config.allowedRoots, sourceSha: runtimeEvidence.sourceSha, runtimeEvidence });
    // Fence every native HTTP API writer while the owner requests safe shutdown.
    // Existing work and the ordinary Web host remain native runtime concerns.
    ctx.on('connection/request', async (_request, response, next) => {
      if (teams.quiescing) { response.writeHead(503); response.end('Host admission is quiescing.'); return; }
      teams.httpAdmissions = (teams.httpAdmissions ?? 0) + 1;
      try { return await next(); } finally { teams.httpAdmissions--; }
    });
    await ctx.plugin(RoleTeamsRemote, { teams });
  } catch (error) {
    await native?.close();
    await store.close();
    await projection.dispose?.();
    throw error;
  }
  ctx.effect(() => async () => {
    await teams.close();
    await native.close();
    await store.close();
  }, 'dsh-role-teams: drain admission and release native resources');
}
