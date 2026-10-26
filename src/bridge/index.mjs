/** Native host plugin: one Session service shared by Web and explicit MCP clients. */
import { join } from 'node:path';
import { BridgeStore } from './private-store.mjs';
import { SessionBridge } from './service.mjs';
import { NativeSessionPort } from './native-port.mjs';
import { bridgeProjectionDefinition } from './projection.mjs';
import { serveBridge } from './ipc.mjs';
import { BridgeError } from './errors.mjs';
import { verifyRuntime } from '../../scripts/runtime/verify.mjs';

export const name = 'dsh-agent-team-bridge';
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
      throw new BridgeError('HOST_RUNTIME_MISMATCH', `The serving ${name} service does not belong to the verified native runtime.`);
    }
  }
}

/** Compose into an existing matching native host. No host, account, token or HTTP server is created. */
export async function apply(ctx, config) {
  if (!config || typeof config.stateDirectory !== 'string' || typeof config.socketPath !== 'string') {
    throw new BridgeError('INVALID_CONFIG', 'stateDirectory and socketPath are required.');
  }
  const runtimeEvidence = await verifyRuntime({ context: ctx });
  await assertNativeHost(ctx);
  const { z } = await import('zod');
  const projection = await ctx.sessionProjections.register(bridgeProjectionDefinition(z));
  const store = await new BridgeStore(join(config.stateDirectory, 'bridge')).open();
  let native;
  let server;
  try {
    native = new NativeSessionPort(ctx, ctx.dshRoles);
    const bridge = new SessionBridge({ native, store, allowedRoots: config.allowedRoots, sourceSha: runtimeEvidence.sourceSha, runtimeEvidence });
    server = await serveBridge({ socketPath: config.socketPath, bridge });
  } catch (error) {
    await native?.close();
    await store.close();
    await projection.dispose?.();
    throw error;
  }
  ctx.effect(() => async () => {
    await server.close();
    await native.close();
    await store.close();
  }, 'dsh-agent-team-bridge: local transport');
}
