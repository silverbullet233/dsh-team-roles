# Native managed-Team Remote API

The ordinary DSH Web host exposes `roleTeams` through the official authenticated Connection and Typert Gateway. There is no private socket, SDK composition, second server or prerequisite global daemon. Import `dsh-team-roles/remote` and mount its `remote` contribution on a native Node Gateway client. The same methods serve the native Web page.

Authenticate through the process launch URL's `/connect` exchange with `interactions=none`. Keep the returned API cookie separate from browser cookies and attach it to both HTTP and the Gateway Mux socket. Socket closure or host restart requires a fresh exchange and capability check. A bearer header is not supported. Never log launch tokens or cookies. Passive clients use direct calls or generated raw Session streams; they cannot use forwarded `$on` or supervised `$stream`.

| Method | Request |
| --- | --- |
| `health` | `{}` |
| `create` | `{ key, cwd, text, workspaceId?, agentPreset?, leadRole?, permissionPreset? }` |
| `send` | `{ teamId, inputId, text, mode?: "queue" or "steer", continue?: boolean }` |
| `status`, `result`, `stop` | `{ teamId }` |
| `turnResult` (development capability) | `{ teamId, turn? or resultRef?, offset?, maxBytes? }` |
| `input` (development capability) | `{ teamId, inputId }` |
| `withdrawInput` (development capability) | `{ teamId, inputId, expectedMessageId }` |

| `jobs` (development capability) | `{ teamId, limit? }` |
| `activity`, `prepareShutdown` | `{}` |

Call `ctx.remote.roleTeams.create(request)` and inspect its native `{ ok, value }` or `{ ok: false, error }` result. Health advertises `api: { name: "dsh-team-roles", version: 1, capabilities }`, native runtime evidence, process identity and the public role catalog. API 1 is a business capability contract, not the removed IPC wire protocol. Errors use `team-roles/<CODE>`.

## Creation and continuation

The page retains its pending request and receipt in per-tab session storage across Settings navigation and reloads. Starting a separate request explicitly clears that identity.

In **Settings → Team roles → Create a role-managed Team**, enter an allowed workspace and text task. The page reserves the saved Lead role before native Session creation. **Open Team** opens the same Session in the ordinary Web workspace. Native New Session and independent forks retain native behavior. An empty catalog preserves native model inheritance.

External clients use a durable caller `key`, reused only for identical content. A reservation stores the root Session ID before native creation and flushes before acknowledging input. Native `session.create` alone is not the idempotency contract. Send uses an `inputId` and native prompt request-ID deduplication. Retain IDs after uncertain outcomes; inspect status before retrying. Cold or interrupted work requires explicit `continue: true`. A cold create retry can return reserved IDs with `requiresContinuation: true` and false or unknown acceptance.

Acceptance means admitted input, not processing or completion. Result reports native turn and Team evidence separately. Lead completion does not imply child completion. Unloaded selections and unknown usage/fees remain null. Text input only; native workspace, tool and approval policies still apply. A passive API client cannot answer approvals.

## Input evidence (development)

Optional API-1 capability `input-observations` is absent from published host 0.6.0. `input` reads a known create/send `inputId` on its managed root without activating cold execution. Unknown roots and unknown admission intents are rejected before reading native state. No prompt content or stored digest is returned.

`admission.state` is `acknowledged` only for a saved successful receipt; `unconfirmed` preserves uncertain outcomes, not a rejection. Independently, `native` reports one root projection cut (`asOfSeq`): `pending` includes exact native `messageId` and `next-turn`/`next-step` placement; `entered-turn` identifies the consuming turn/event; `turn-ended` retains its native outcome, including error or abortion. None proves the input was implemented or the goal achieved (`goalAccepted: null`). Multiple pending matches or simultaneous pending/entered evidence is `ambiguous`; samples are bounded with explicit counts.

The bridge retains at most 4096 entered-input observations. `not-observed` and unavailable/migration/missing-session evidence do **not** prove absence, withdrawal or non-admission (`coverage.absenceIsConclusive: false`). Public projection read failures are sanitized. This is read-only evidence, not queue cancellation, supersession or a safe basis for automatically resending uncertain work. Retain the original IDs and investigate before any retry.

## Live input withdrawal (development)

Optional `live-input-withdrawal` is absent from published host 0.6.0. After inspecting `input` evidence, explicitly withdraw a known pending input using its exact native `expectedMessageId`. The existing live managed Lead must still own one uniquely matching pending message with text matching the saved intent. Cold, already claimed, ambiguous, replaced or changed-content state is refused without activation. Placement may have moved between next-turn and next-step. The public Inbox removal is synchronous after final identity/content checks; native Session events are flushed before the private acknowledgement.

A durable withdrawal intent prevents create/send retries from resurrecting that input ID. A successful receipt says `state: withdrawn`, includes its native `asOfSeq`, and can be reread idempotently after disconnect/restart without activating work. It withdraws only that pending message: no running work is cancelled and no files are rolled back. Later new work needs a new, explicitly authorized input ID; this is not automatic supersession.

Intent, native removal and private acknowledgement are not a single transaction. Races or flush/storage failures preserve `unconfirmed` and return `WITHDRAWAL_UNCERTAIN`; absence never manufactures success. An explicit same-ID retry can succeed only if the exact message is still pending. A confirmed past receipt is historical evidence, not a ban on unrelated native writers. Preserve the Home/IDs for investigation when uncertainty remains; do not resume cold execution, clear queues or resend to bypass it.

## Owned Job observations (development)

Optional `owned-job-observations` is absent from published host 0.6.0. `jobs` passively reads the root's public native Team roster, then metadata from the live Job registry for exactly those declared Session owners. Native caller visibility also includes unowned Jobs; this API deliberately excludes them and unrelated owners. Member IDs and arbitrary owners are not query targets. No Job output cursor is consumed, no spill file is read, and no execution or cancellation is exposed.

The response counts every observed owned Job by native status and samples up to `limit` entries (default 20, maximum 25), prioritizing running/stopping work. `omitted` is explicit. IDs stay whole, producer `kind` is omitted if oversized, and optional progress previews are limited to 160 UTF-8 bytes without cutting valid Unicode scalars. Command labels, terminal details, output payloads and spill paths are excluded; output metadata contains byte positions only. Missing progress/metadata stays null.

`rootAsOfSeq` identifies the roster's root cut; `ownerScopeUnchangedAtCheck` reports a follow-up Agent/Session identity and root-sequence check, or null when no live sequence is available. `coverage.atomic: false` does not claim a simultaneous Team/Job snapshot. Unavailable/malformed scope or registry observations return `available: false` and null counts rather than an empty-success assertion. The registry is process-local and drops records; cold reads do not activate work, and an empty result is neither historical completeness nor a stop, resource-release or goal-success verdict. Use normal Lead coordination for execution decisions. Installation pins remain unchanged until a compatible release is published.

## Create-time permissions (0.6.0)

Version 0.6.0 adds API-1 capability `create-permission-preset`; it is absent from 0.5.0. Health exposes native `permissionPresets.options` with resolved `sandboxMode` and `approvalPolicy`. After explicit user selection, pass an exact option value as `permissionPreset`; omission preserves native defaults. Do not infer a bundle from its name, automatically upgrade to avoid approval or fall back after refusal.

The host applies the native preset only to a fresh blank root, flushes and verifies it before submitting the first task or allowing member creation. Create returns effective `permissions: { preset, sandbox, approvalPolicy, asOfSeq }`, or null if native permission services are unavailable and no preset was requested. Intent is part of the create digest. Guarded text admission uses public SessionController/Agent APIs and checks live permissions synchronously immediately before the native queue write, after asynchronous attachment and receipt work. This is a point-in-time admission check, not a ban on later owner permission changes. Identical retries and restored Sessions verify read-only; changed content, effective permissions, catalog definitions or partial initialization fail closed, including sends. An incomplete reservation is not automatically repaired: inspect its ID before creating another Team.

The usual `danger-full-access` bundle is sandbox full access with approval `never`; configuration may redefine it. `never` denies still-required approval, not approve-all. New children snapshot parent sandbox and pin approval to `never`; later Lead changes do not update existing children. Workspace admission is not complete process confinement and presets grant no OS privileges. Existing Teams, global defaults and separate explicit approval decisions are unchanged.

## Historical ended-turn text (development)

API-1 capability `ended-turn-results` is additive development work, absent from the published 0.6.0 host. Keep released installation pins unchanged until a compatible host is published. Legacy `result` is unchanged.

Select an explicit positive `turn`, then retain its `resultRef`. Read further pages with that same reference and `page.nextOffset`, omitting `turn`. References pin the managed Lead identity, native start/end sequence, source/content SHA-256 and rendering format; append-only later turns do not change them. Reconnect and cold reads use public native `session.events` without activation. References are untrusted selectors, not credentials; only roots created by this service are readable. Changed or cross-Team references fail explicitly.

`format: assistant-text-events-v1` describes UTF-8 JSONL, one committed `assistant/message` event per line: `{seq, surfaceOp, sourceEventSeqs?, text:[...]}`. Join page text before parsing lines; individual pages may split JSON tokens, but never UTF-8 scalars. Replacement markers are retained rather than silently concatenating obsolete/replacement messages as a final answer. This audit event log is **not** the canonical Web conversation projection. Empty text arrays are valid for tool-only assistant messages. Reasoning, tool payloads, artifacts and member Sessions are excluded. `outcome` is the native terminal reason, `inputIds` names consumed user RPC inputs, and `coverage.goalAccepted` stays null; none proves task or business success.

Default page text is 8192 bytes, configurable from 4 to 32768; `page.sha256` and `totalBytes` describe the entire JSONL transcript. Nonzero offsets require a reference and an in-range UTF-8 scalar boundary. Native page/turn scanning is limited to 64 pages, 20000 events and 8 MiB of fetched wire records/rendered text, with at most 128 bounded input IDs. These are application limits after native reads, not a native storage-I/O byte guarantee. `HISTORY_LIMIT`, `HISTORY_INCOMPLETE`, `HISTORY_UNAVAILABLE`, `MIGRATION_REQUIRED`, `TURN_NOT_FOUND`, `TURN_NOT_ENDED` and `RESULT_CHANGED` return no partial/latest substitute.

## Result attribution and freshness (development)

Optional capability `result-attribution` is development work absent from published host 0.6.0. Status observation/result metadata separates the latest started turn, active turn, last native-ended turn and last native-completed turn. Native completion is not goal acceptance. `outputSource: {turn, seq, truncated}` identifies the current turn's latest nonempty text preview; starting another turn clears it. A subsequent tool-only assistant message preserves text from the same turn and updates `latestAssistant: {turn, seq, hasText}` separately. No-text assistant activity is visible even when output is empty; it is not proof that a tool executed. The legacy preview remains limited to 8192 UTF-16 units, avoids cutting valid surrogate pairs and explicitly reports truncation. Use the historical read reference for complete event text.

`asOfSeqScope: root-session` labels the legacy root cursor. `freshness.atomic` is always false: `freshness.projections` carries each Session's own `asOfSeq`, or null when unavailable. `unchangedAtCheck` compares its live sequence and sampled runtime identity after the reads; cold/unavailable checks remain null. It is a point-in-time check, not an atomic Team snapshot or future stability guarantee. Changed live source/identity samples downgrade consistency/completion evidence. Live runtime/route fields are sampled separately after projection reads.

The native `dshBridge` projection cache version advances to 2. Public native cache restoration discards V1 rows and refolds the full event log; it does not rewrite Session history or activate an Agent. Missing logs or unsupported migration remain explicit failures. Older hosts lack these fields; do not infer attribution from their latest body or treat a root cursor as a whole-Team revision.

## Stop and host lifetime

Disconnect never cancels native execution. During `stop`, this service serializes its managed sends/stops and temporarily refuses role spawning; arbitrary native producers/timers are not fenced. It interrupts children before Lead and rechecks activity after child-result delivery. Pending inboxes and file changes remain intact. Future admission is not closed by the returned response.

Development capability `job-aware-execution`, absent from published 0.6.0, adds normal native cancellation of running/stopping Jobs owned by the managed root and declared roster. Job control requires a consistent scope, the same checked live root, and a live owner whose Session identity and parent relation still match. Cold/replaced/reparented owners are refused without activation. Unowned and unrelated Jobs are excluded. Control scans all observed owned Jobs, independently of presentation samples, with bounded repeated passes for late work. Native cancellation is requested once per observed Job; the producer can remain stopping or fail. `jobCancellations` reports counts and at most 25 outcome entries, with omissions, without consuming output.

`accepted` describes cancellation requests, not terminal work. `quiescent` is conservative observed native inactivity: no running/provisioning/open/unknown member execution or pending input, and known settled Job records at a checked root cut. Missing/stale Job evidence keeps it false. It is not a global barrier, future stability or proof that OS resources were released. `execution` explicitly reports `atomic: false`, `admissionBarrier: false` and `resourceReleaseVerified: false`. Task records, permissions and inboxes are never rewritten to manufacture success. Inspect retained inputs and explicitly choose keep/withdraw/resume within existing caller authority before submitting more work; a cold queue is never resumed just to remove it.

With this capability, `result.completed` requires native Team completion **and** known settled owned Job records. `nativeTeamCompleted` preserves the separate Session/Task verdict; `execution.ownedJobsSettled` is false for running/stopping records and null for unavailable/cold/stale evidence. Status remains the native Session/Task view. Result includes separate root cuts and counts; these reads are not atomic. Terminal failed/killed Job records can mean execution ended, not that delivery or business goals succeeded (`goalAccepted: null`). The process-local registry can drop records and producer reporting does not prove resource release. Earlier hosts lack this coverage; preserve release pins until a compatible version is published.

`activity` conservatively checks managed Teams, all live native Agents (including unmanaged Web work), inboxes, pending admission and the native Job registry when loaded. Job reads include unowned Jobs and every known live or managed-roster owner; running/stopping Jobs, read failures or a changing Job baseline refuse shutdown. These reads never consume Job output or cancel work. Additive `blockers` identify native Jobs, unavailable/changing Job observations, unfinished task counts and unloaded members whose last turn did not complete. Existing `running`, `unsettled` and `admissions` remain available.

`prepareShutdown` first fences new native HTTP API requests and returns `safeToStop`. If unsafe it reopens admission. A successful response leases the HTTP admission fence for five seconds (`leaseExpiresAt`) so an owning process manager can terminate only its attributed host. It does not itself kill a process. If the response is lost or termination fails, the fence expires and HTTP admission reopens. This is conservative observed activity plus an HTTP fence, not a global native admission barrier for arbitrary in-process producers or timers. Do not use process exit as completion evidence.

Unfinished task records and closed failed/unloaded members still prevent automatic teardown, even when execution is idle. Preserve their status, ownership, inbox and history; never mark work completed just to pass shutdown. A record-preserving restart needs an explicit native execution-admission/drain guarantee; this API does not offer one. Inspect the returned blockers and coordinate normal cancellation through the Lead. If the guard still refuses, retain the Home and host rather than force-killing or bypassing it.

## Tool-call receipts (development)

Development capability `tool-call-observations` adds `toolActivity` to existing root-only status/result responses; no request schema or native method changes. Published host 0.6.0 lacks it. The `native-tool-receipts-v1` format samples at most 32 root/declared-roster Sessions with per-Session cuts and freshness, never an atomic Team snapshot. Missing projections stay unavailable. Public native projection `dshToolReceipts` reconstructs receipts passively from Session events without activating cold Agents or changing the existing `dshBridge` projection version.

The scope is each Session's latest-started turn. `tool/call` proves a model request, not actual handler/process execution; `tool/result` proves a committed native receipt, not business acceptance. Observed call/result counters and native error flags are separate from unsettled correlation. A terminal turn can still have unmatched receipts. Arguments, commands, result payloads, reasoning and credentials are excluded; bounded opaque IDs are omitted whole when invalid/oversized.

The projection retains up to 16 unsettled identities and the latest result metadata; status/result sample four unsettled identities per Session. Overflow, duplicate/unmatched correlation or invalid call identity makes `unsettledCount` null while preserving known samples, observed event counts and explicit omissions. Incomplete correlation also omits the result's request-side tool name and call sequence. New turns reset this view. Native tagged fork-seed boundaries discard inherited parent receipts; ordinary restore boundaries retain the Session's own evidence. This is not complete task history, a waiting-reason detector, a tool controller or extra completion/stop authority. Optional clients can discover the capability and recognize the format; older status/result requests remain compatible.

## Durable upgrades

The former `bridge` metadata directory and `dshBridge` Session projection key remain storage identities for existing receipts and histories. They do not enable the old transport. Role Lead reservations, member snapshots, Session storage and attachment storage retain their existing locations. Run one writer per Harness home/state directory.
