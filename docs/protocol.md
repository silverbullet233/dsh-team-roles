# Native managed-Team Remote API

The ordinary DSH Web host exposes `roleTeams` through the official authenticated Connection and Typert Gateway. There is no private socket, SDK composition, second server or prerequisite global daemon. Import `dsh-team-roles/remote` and mount its `remote` contribution on a native Node Gateway client. The same methods serve the native Web page.

Authenticate through the process launch URL's `/connect` exchange with `interactions=none`. Keep the returned API cookie separate from browser cookies and attach it to both HTTP and the Gateway Mux socket. Socket closure or host restart requires a fresh exchange and capability check. A bearer header is not supported. Never log launch tokens or cookies. Passive clients use direct calls or generated raw Session streams; they cannot use forwarded `$on` or supervised `$stream`.

| Method | Request |
| --- | --- |
| `health` | `{}` |
| `create` | `{ key, cwd, text, workspaceId?, agentPreset?, leadRole? }` |
| `send` | `{ teamId, inputId, text, mode?: "queue" or "steer", continue?: boolean }` |
| `status`, `result`, `stop` | `{ teamId }` |
| `activity`, `prepareShutdown` | `{}` |

Call `ctx.remote.roleTeams.create(request)` and inspect its native `{ ok, value }` or `{ ok: false, error }` result. Health advertises `api: { name: "dsh-team-roles", version: 1, capabilities }`, native runtime evidence, process identity and the public role catalog. API 1 is a business capability contract, not the removed IPC wire protocol. Errors use `team-roles/<CODE>`.

## Creation and continuation

In **Settings → Team roles → Create a role-managed Team**, enter an allowed workspace and text task. The page reserves the saved Lead role before native Session creation. **Open Team** opens the same Session in the ordinary Web workspace. Native New Session and independent forks retain native behavior. An empty catalog preserves native model inheritance.

External clients use a durable caller `key`, reused only for identical content. A reservation stores the root Session ID before native creation and flushes before acknowledging input. Native `session.create` alone is not the idempotency contract. Send uses an `inputId` and native prompt request-ID deduplication. Retain IDs after uncertain outcomes; inspect status before retrying. Cold or interrupted work requires explicit `continue: true`. A cold create retry can return reserved IDs with `requiresContinuation: true` and false or unknown acceptance.

Acceptance means admitted input, not processing or completion. Result reports native turn and Team evidence separately. Lead completion does not imply child completion. Unloaded selections and unknown usage/fees remain null. Text input only; native workspace, tool and approval policies still apply. A passive API client cannot answer approvals.

## Stop and host lifetime

Disconnect never cancels native execution. `stop` fences managed input admission and role spawning, interrupts children before Lead, and rechecks native activity after child-result delivery. `accepted` describes cancellation requests; `quiescent` separately confirms observed execution inactivity. Pending inboxes and file changes remain intact.

`activity` conservatively checks managed Teams, all live native Agents (including unmanaged Web work), inboxes and pending admission. `prepareShutdown` first fences new native HTTP API requests and returns `safeToStop`. If unsafe it reopens admission. A successful response keeps admission closed so an owning process manager can terminate only its attributed host. It does not itself kill a process. Do not use process exit as completion evidence. Unknown/cold unfinished work prevents automatic teardown.

## Durable upgrades

The former `bridge` metadata directory and `dshBridge` Session projection key remain storage identities for existing receipts and histories. They do not enable the old transport. Role Lead reservations, member snapshots, Session storage and attachment storage retain their existing locations. Run one writer per Harness home/state directory.
