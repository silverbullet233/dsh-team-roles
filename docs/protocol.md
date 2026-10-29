# Private IPC protocol 1

Transport: one newline-delimited JSON request/response per Unix connection, private to the current UID. Requests are at most 131072 bytes; responses at most 1048576 bytes. No credentials or endpoints are carried in role records.

```json
{"protocol":1,"id":"caller-request-id","method":"health","params":{}}
```

Success is `{ "protocol": 1, "id": "caller-request-id", "result": ... }`; failure is the same envelope with `error: { code, message }`. The request version is checked **before dispatch**, including before mutating methods. Missing or incompatible versions return `PROTOCOL_MISMATCH`; no native operation is dispatched.

Health returns `ok`, `protocol: { name: "dsh-team-roles", version: 1, capabilities }`, exact native runtime evidence and the public role catalog (without instructions). Version 1 capabilities are `native-session`, `durable-role-snapshots`, `native-role-settings`, `text-input`, `idempotent-admission`. Integrations can inspect `health` to check the advertised capabilities before submitting work. The server enforces request protocol version before dispatch; it does not negotiate a caller's capability requirements.

Methods and parameters:

- `health`: `{}`.
- `create`: `{ key, cwd, text, workspaceId?, agentPreset?, leadRole? }`.
- `send`: `{ teamId, inputId, text, mode?: "queue" | "steer", continue?: boolean }`.
- `status`, `result`, `stop`: `{ teamId }`.

## Create a role-managed Team

With a nonempty saved role catalog, IPC `create` reserves the default Lead role before native Session creation. Ordinary Web creation does not reserve that role. The resulting Session/Team remains visible in native Web.

This example starts work. Replace the socket with the configured `socketPath` and the directory with an allowlisted workspace. Use a unique `key` for each new Team; retain it when checking an uncertain admission.

```sh
node --input-type=module - /path/to/native.sock /absolute/allowed/workspace <<'JS'
import { createConnection } from 'node:net';
const [socketPath, cwd] = process.argv.slice(2);
const request = { protocol: 1, id: 'create-example', method: 'create', params: {
  key: 'example-team-001', cwd,
  text: 'Handle this synthetic example using configured roles.',
} };
const socket = createConnection(socketPath);
socket.on('error', error => { console.error(error.message); process.exitCode = 1; });
socket.on('data', chunk => process.stdout.write(chunk));
socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
JS
```

The response contains `result.teamId` for subsequent `status`, `send` or `result` requests. Without configured roles, `create` preserves native model inheritance.

The existing durable idempotency and continuation semantics remain unchanged. A transport failure can leave admission uncertain; keep the original key/input ID and inspect status. Disconnect/EOF never cancels native work. `stop` requests cancellation of active turns and retains inboxes and file changes; native child-result delivery can wake the Lead again. Unknown costs and usage remain null. `selected` can be null for unloaded members while `lastRequest` remains durable evidence. Only text input is supported.

Settings writes use the authenticated native Typert Gateway and Settings editor, not this IPC surface. The IPC API does not grant access to modify roles or native provider credentials.
