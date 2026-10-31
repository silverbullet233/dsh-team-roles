import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { installConnection } from '@deepseek-ai/dsh-client-connection/client';
import * as gateway from '@deepseek-ai/dsh-api-gateway/client';
import * as registry from '@deepseek-ai/dsh-typert-registry';
import sessionRemote from '@deepseek-ai/dsh-api-session-controller/remote';
import WebSocket from 'ws';
import * as web from '@deepseek-ai/dsh-host-webserver';
import { mountNativeHost, until } from '../fixtures/native-harness.mjs';

test('official Node Gateway admits a role Session and retires API authentication on mux close', {timeout:15000}, async () => {
const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-proof-'));
const host = await mountNativeHost({root, bridge:false});
const client = new Context();
let socket;
try {
  await host.ctx.plugin(web.default, {host:'127.0.0.1',port:0});
  const origin = host.ctx.webServer.getOrigin();
  const connect = new URL(host.ctx.connection.authenticatedUrl(origin));
  connect.pathname = '/connect'; connect.searchParams.set('interactions','none');
  const response = await fetch(connect,{redirect:'manual'});
  assert.equal(response.status,302);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  await client.plugin(registry.TypertRegistry);
  installConnection(client,{interactions:'none',transport:{streamBaseUrl:origin, fetch:(input,init)=>fetch(new URL(input,origin),{...init,headers:{...init.headers,Cookie:cookie}}),createWebSocket:url=>(socket=new WebSocket(url,{headers:{Cookie:cookie}}))}});
  await client.plugin(gateway);
  await client.remote.$mount(sessionRemote);
  if (socket.readyState !== WebSocket.OPEN) await once(socket,'open');
  const sessionId = randomUUID();
  await host.ctx.dshRoles.prepareLead(sessionId);
  const created = await client.remote.session.create({sessionId,cwd:host.fixtureRoot});
  assert.equal(created.ok,true); assert.equal(created.value.sessionId,sessionId);
  const admitted = await client.remote.session.prompt({sessionId,requestId:'proof-input',content:[{type:'text',text:'Synthetic Gateway proof.'}],mode:'queue'});
  assert.equal(admitted.ok,true);
  await host.ctx.agents.get(sessionId).whenIdle();
  assert.equal(host.requests[0].provider,'fixture-lead');
  assert.equal((await host.ctx.dshRoles.bindings(sessionId))[0].memberId,sessionId);
  socket.close(); await once(socket,'close');
  await until(async () => (await fetch(new URL('/api/session/projections',origin),{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({rpcId:'expired',request:{sessionId}})})).status === 401, {description:'API peer retirement'});
  
} finally {
  socket?.close(); await client.fiber.dispose(); await host.dispose(); await rm(root,{recursive:true,force:true});
}

});
