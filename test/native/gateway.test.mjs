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

test('external roleTeams Remote shares native identities, survives disconnect, and guards whole-host shutdown', { timeout: 20000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-role-gateway-'));
  let hang = true;
  const host = await mountNativeHost({ root, respond: () => hang ? 'hang' : [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: 'DONE' }, { type: 'block-end', index: 0, block: { type: 'text', text: 'DONE' } }, { type: 'finish', reason: { kind: 'stop' } }] });
  await host.ctx.plugin(web.default, { host: '127.0.0.1', port: 0 });
  const { NativeClient } = await import('../fixtures/client.mjs');
  const url = host.ctx.connection.authenticatedUrl(host.ctx.webServer.getOrigin());
  const first = new NativeClient({ url });
  const second = new NativeClient({ url });
  t.after(async () => { await first.close(); await second.close(); await host.dispose(); await rm(root, { recursive: true, force: true }); });
  assert.equal((await first.request('health')).transport, 'native-typert-gateway');
  const input = { key: 'external-create', cwd: host.fixtureRoot, text: 'Synthetic bounded Gateway Team.' };
  const created = await first.request('create', input);
  await until(() => host.requests.length > 0);
  assert.equal(created.accepted, true);
  assert.equal((await first.request('create', input)).teamId, created.teamId);
  assert.equal((await first.request('prepareShutdown')).safeToStop, false);
  await first.close();
  assert.equal(host.ctx.agents.get(created.teamId).status, 'running');
  const status = await second.request('status', { teamId: created.teamId });
  assert.equal(status.members[0].memberId, created.teamId);
  assert.equal(status.rootTurnCompleted, false);
  assert.equal((await second.request('result', { teamId: created.teamId })).completed, false);
  await second.request('send', { teamId: created.teamId, inputId: 'external-steer', text: 'Synthetic steer.', mode: 'steer' });
  assert.equal((await second.request('stop', { teamId: created.teamId })).quiescent, true);
  hang = false;
  await second.request('send', { teamId: created.teamId, inputId: 'external-followup', text: 'Synthetic finish.', continue: true });
  await until(async () => (await second.request('result', { teamId: created.teamId })).completed === true);
  const result = await second.request('result', { teamId: created.teamId });
  assert.equal(result.output, 'DONE');
  assert.equal(result.inputs.filter(item => item.id === 'external-followup').length, 1);
  assert.equal((await second.request('prepareShutdown')).safeToStop, true);
});

test('shutdown refuses a native Web writer admitted before its fence', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-shutdown-writer-'));
  const host = await mountNativeHost({ root, respond: () => 'hang' });
  await host.ctx.plugin(web.default, { host: '127.0.0.1', port: 0 });
  const { NativeClient } = await import('../fixtures/client.mjs');
  const client = new NativeClient({ url: host.ctx.connection.authenticatedUrl(host.ctx.webServer.getOrigin()) });
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let held = true;
  host.ctx.on('connection/request', async (request, _response, next) => {
    if (request.url === '/api/session/prompt' && held) { held = false; entered.resolve(); await release.promise; }
    return next();
  });
  t.after(async () => { release.resolve(); await client.close(); await host.dispose(); await rm(root, { recursive: true, force: true }); });
  const ordinary = await host.ctx.sessionController.create({ cwd: host.fixtureRoot });
  await client.request('health');
  // Use a second native API caller to exercise an unmanaged Web Session write.
  const origin = host.ctx.webServer.getOrigin();
  const connect = new URL(host.ctx.connection.authenticatedUrl(origin)); connect.pathname = '/connect';
  const exchanged = await fetch(connect, { redirect: 'manual' });
  const cookie = exchanged.headers.get('set-cookie').split(';')[0];
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/remote.mux', { headers: { Cookie: cookie } });
  t.after(() => socket.close()); await once(socket, 'open');
  const writing = fetch(new URL('/api/session/prompt', origin), { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'held-web-input', method: 'session/prompt', payload: { args: { request: { sessionId: ordinary.sessionId, requestId: 'held-web-input', content: [{ type: 'text', text: 'Synthetic admitted Web work.' }], mode: 'queue' } } } }) });
  await entered.promise;
  assert.equal((await client.request('prepareShutdown')).safeToStop, false);
  release.resolve(); assert.equal((await writing).status, 200);
  await until(() => host.requests.length > 0);
  assert.equal((await client.request('prepareShutdown')).safeToStop, false);
  await host.ctx.sessionController.cancel({ sessionId: ordinary.sessionId });
});

test('a lost Web create reply survives navigation/reload with the same request and Team', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-retry-'));
  const host = await mountNativeHost({ root });
  t.after(async () => { await host.client.close(); await host.dispose(); await rm(root, { recursive: true, force: true }); });
  const { saveCreationDraft, loadCreationDraft, clearCreationDraft } = await import('../../src/client/creation-draft.mjs');
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const request = { key: 'browser-reload', cwd: host.fixtureRoot, text: 'Synthetic persisted browser creation.' };
  saveCreationDraft(request, null, storage);
  const lost = await host.client.request('create', request);
  // Remount with no component state or response retained, as after a lost reply.
  const restored = loadCreationDraft(storage);
  assert.deepEqual(restored.request, request);
  const retry = await host.client.request('create', restored.request);
  assert.equal(retry.teamId, lost.teamId);
  assert.equal(retry.duplicate, true);
  await host.ctx.agents.get(retry.teamId).whenIdle();
  assert.equal(host.requests.length, 1);
  saveCreationDraft(restored.request, retry, storage);
  assert.equal(loadCreationDraft(storage).receipt.teamId, lost.teamId);
  clearCreationDraft(storage); assert.equal(loadCreationDraft(storage), null);
});

test('completed cold history permits host shutdown and an expired shutdown lease reopens admission', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-shutdown-history-'));
  let host = await mountNativeHost({ root });
  t.after(async () => { await host.client.close(); await host.dispose(); await rm(root, { recursive: true, force: true }); });
  const created = await host.client.request('create', { key: 'cold-complete', cwd: host.fixtureRoot, text: 'Synthetic completed history.' });
  await host.ctx.agents.get(created.teamId).whenIdle();
  await host.client.close(); await host.dispose();
  host = await mountNativeHost({ root });
  assert.equal((await host.client.request('activity')).safeToStop, true);
  const prepared = await host.client.request('prepareShutdown');
  assert.equal(prepared.safeToStop, true);
  assert(prepared.leaseExpiresAt > Date.now());
  await until(() => Date.now() >= prepared.leaseExpiresAt, { timeout: 7000 });
  assert.equal((await host.client.request('health')).ok, true);
});
