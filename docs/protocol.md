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

The existing durable idempotency and continuation semantics remain unchanged. A transport failure can leave admission uncertain; keep the original key/input ID and inspect status. Disconnect/EOF never cancels native work. `stop` retains file changes. Unknown costs and usage remain null. `selected` can be null for unloaded members while `lastRequest` remains durable evidence. Only text input is supported.

Settings writes use the authenticated native Typert Gateway and Settings editor, not this IPC surface. The IPC API does not grant access to modify roles or native provider credentials.
