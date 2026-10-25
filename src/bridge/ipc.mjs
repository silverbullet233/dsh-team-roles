/** A UID-restricted Unix socket. It exposes no browser authentication or network route. */
import { createConnection, createServer } from 'node:net';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { BridgeError, object } from './errors.mjs';
import { PROTOCOL_VERSION } from './protocol.mjs';
import { privateDirectory } from './private-store.mjs';

const MAX_REQUEST_BYTES = 131072;
const MAX_RESPONSE_BYTES = 1048576;

/** Refuse arbitrary files; reclaim a stale socket only after its listener is absent. */
async function removeStaleSocket(path) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!info.isSocket() || info.uid !== process.getuid?.()) throw new BridgeError('UNSAFE_SOCKET', 'Existing IPC path is not an owned Unix socket.');
  const state = await new Promise(resolve => {
    const socket = createConnection(path);
    socket.once('connect', () => { socket.destroy(); resolve('live'); });
    socket.once('error', error => { socket.destroy(); resolve(error.code); });
    socket.setTimeout(1000, () => { socket.destroy(); resolve('unknown'); });
  });
  if (state !== 'ECONNREFUSED' && state !== 'ENOENT') throw new BridgeError('SOCKET_HELD', 'An existing IPC listener is live or its state is unknown.');
  const current = await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (current?.ino === info.ino) await unlink(path);
}

/** Start only in an explicit private directory. Closing clients never closes this server. */
export async function serveBridge({ socketPath, bridge }) {
  if (!isAbsolute(socketPath) || Buffer.byteLength(socketPath) > 100) throw new BridgeError('INVALID_CONFIG', 'socketPath must be absolute and at most 100 bytes.');
  await privateDirectory(dirname(socketPath));
  await removeStaleSocket(socketPath);
  const sockets = new Set();
  let closing = false;
  const pending = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let body = Buffer.alloc(0);
    let handled = false;
    socket.on('error', () => { /* Transport loss does not cancel an accepted native operation. */ });
    socket.setTimeout(30000, () => socket.destroy());
    socket.on('data', chunk => {
      if (handled || closing) { socket.destroy(); return; }
      body = Buffer.concat([body, chunk]);
      if (body.length > MAX_REQUEST_BYTES) { handled = true; socket.end(`${JSON.stringify({ protocol: PROTOCOL_VERSION, id: null, error: { code: 'REQUEST_TOO_LARGE', message: 'IPC request exceeds the byte limit.' } })}\n`); return; }
      const end = body.indexOf(10);
      if (end < 0) return;
      handled = true;
      socket.pause();
      const run = (async () => {
        let id = null;
        try {
          if (body.subarray(end + 1).toString('utf8').trim()) throw new BridgeError('INVALID_REQUEST', 'One request is allowed per connection.');
          const request = object(JSON.parse(body.subarray(0, end).toString('utf8')), ['id', 'method', 'params', 'protocol']);
          if ((typeof request.id !== 'string' && typeof request.id !== 'number') || typeof request.method !== 'string') throw new BridgeError('INVALID_REQUEST', 'id and method are required.');
          id = request.id;
          if (request.protocol !== PROTOCOL_VERSION) throw new BridgeError('PROTOCOL_MISMATCH', 'Install a client supporting dsh-team-roles IPC protocol 1. No native operation was dispatched.');
          const result = await bridge.dispatch(request.method, request.params ?? {});
          const response = JSON.stringify({ protocol: PROTOCOL_VERSION, id, result });
          if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) throw new BridgeError('RESPONSE_TOO_LARGE', 'Native result exceeds the IPC response limit.');
          if (!socket.destroyed) socket.end(`${response}\n`);
        } catch (error) {
          const failure = error instanceof BridgeError ? { code: error.code, message: error.message }
            : error instanceof SyntaxError ? { code: 'INVALID_REQUEST', message: 'IPC request is not valid JSON.' }
              : { code: 'NATIVE_FAILURE', message: 'The native operation failed or its outcome is uncertain; inspect status before retrying.' };
          if (!socket.destroyed) socket.end(`${JSON.stringify({ protocol: PROTOCOL_VERSION, id, error: failure })}\n`);
        }
      })();
      pending.add(run);
      void run.finally(() => pending.delete(run));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  const identity = await lstat(socketPath);
  return {
    socketPath,
    async close() {
      if (closing) return;
      closing = true;
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled([...pending]);
      await closed;
      const current = await lstat(socketPath).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (current?.ino === identity.ino) await unlink(socketPath);
    },
  };
}
