import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveBridge } from '../../src/bridge/ipc.mjs';

test('unsupported IPC versions refuse writes before native dispatch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-protocol-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const socketPath = join(root, 'ipc.sock');
  let calls = 0;
  const server = await serveBridge({ socketPath, bridge: { dispatch: async () => { calls++; return {}; } } });
  t.after(() => server.close());
  for (const protocol of [undefined, 0, 2, '1']) {
    const response = await new Promise((resolve, reject) => {
      const socket = createConnection(socketPath); let body = '';
      socket.on('error', reject); socket.on('data', chunk => { body += chunk; });
      socket.on('end', () => resolve(JSON.parse(body)));
      socket.once('connect', () => socket.write(JSON.stringify({ protocol, id: 'synthetic', method: 'create', params: {} }) + '\n'));
    });
    assert.equal(response.protocol, 1);
    assert.equal(response.error.code, 'PROTOCOL_MISMATCH');
  }
  assert.equal(calls, 0);
});
