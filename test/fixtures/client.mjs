/** Test callers use the same native Gateway methods as Web and the Node client. */
import { Context } from '@deepseek-ai/cordis';
import { installConnection } from '@deepseek-ai/dsh-client-connection/client';
import * as gateway from '@deepseek-ai/dsh-api-gateway/client';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import WebSocket from 'ws';
import { once } from 'node:events';
import { remote } from '../../src/teams/remote.mjs';

export class NativeClient {
  constructor({ ctx, url } = {}) { this.host = ctx; this.url = url; }
  async initialize() {
    if (this.host) {
      this.peer ??= this.host.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' });
      return;
    }
    const url = new URL(this.url), origin = url.origin;
    url.pathname = '/connect'; url.searchParams.set('interactions', 'none');
    const exchange = await fetch(url, { redirect: 'manual' });
    if (exchange.status !== 302) throw new Error('Native API authentication failed.');
    const cookie = exchange.headers.get('set-cookie').split(';')[0];
    this.ctx = new Context();
    await this.ctx.plugin(TypertRegistry);
    installConnection(this.ctx, { interactions: 'none', transport: {
      streamBaseUrl: origin,
      fetch: (input, init) => fetch(new URL(input, origin), { ...init, headers: { ...init.headers, Cookie: cookie } }),
      createWebSocket: address => (this.socket = new WebSocket(address, { headers: { Cookie: cookie } })),
    } });
    await this.ctx.plugin(gateway);
    await this.ctx.remote.$mount(remote);
    if (this.socket.readyState !== WebSocket.OPEN) await once(this.socket, 'open');
  }
  async request(method, request = {}) {
    this.ready ??= this.initialize(); await this.ready;
    try {
      if (this.host) return await this.host.typertGateway.invoke({ namespace: 'roleTeams', method, args: { request }, peer: this.peer });
      const result = await this.ctx.remote.roleTeams[method](request);
      if (!result.ok) throw result.error;
      return result.value;
    } catch (error) {
      if (error.code?.startsWith('team-roles/')) error.code = error.code.slice('team-roles/'.length);
      throw error;
    }
  }
  close() { this.ready = undefined; this.peer?.dispose(); this.peer = undefined; return this.ctx?.fiber.dispose(); }
}
