# Role configuration and upgrades

Edit roles in native **Settings → Team roles**. Providers must already be registered and authenticated in DSH; role records contain no credentials or endpoint overrides.

| Field | Meaning |
| --- | --- |
| `name` | Unique lower-kebab-case role identifier |
| `description` | Responsibility exposed to the Lead for role selection |
| `instructions` | Instructions bound to the chosen member |
| `provider`, `model` | Exact native registration and model |
| `reasoningEffort` | Optional effort supported by that model; omitted uses the native adapter default |

A nonempty catalog requires a default Lead role. An empty catalog has `leadRole: ''` and `roles: []`, allowing native model inheritance for new Teams. Explicit invalid routes fail.

Saves validate native provider/model/effort availability and reject stale revisions. **Reload saved roles** discards a draft. Changes apply to new Leads and new member reservations; existing bindings, explicit native model selections and recovery snapshots persist. Removing a role does not invalidate its existing members.

## Persistence

- Native profile entry id: `dsh-agent-team`.
- Catalog override: `catalog: { leadRole, roles: [...] }` in the active profile's `cordis.patch.yml`.
- Default state: `dsh-agent-team/state` under the native Harness home.
- Default workspace allowlist: the profile's launch directory.

If `dsh-agent-team.json` exists under the Harness home, its state directory, workspace allowlist and role catalog supply inherited values. Saved profile catalog values override them; native home/CLI overlays retain their precedence. Conflicting form writes are refused.

## Upgrades

Version 0.5 removes the socket transport and `socketPath` option. Remove that field from existing profile overrides before upgrading. Keep `stateDirectory`, `allowedRoots`, the stable entry id, and the `bridge` metadata subdirectory: existing create keys/input receipts remain valid. The `dshBridge` projection key remains readable for historical Sessions.

Preserve the stable entry id, state/config paths and native records. Keep a recoverable nonsecret configuration backup and the previous package version. Use native lifecycle handling and coordinate any required restart with active work. Run one host per writable store; remove an older bundle registration before replacing it. Do not overwrite account/session stores or copy credentials.

## Candidate Codex permission profiles

The unreleased client supplies an exact `permissionProfile` to create, with `sandboxMode`, DSH `approvalPolicy` (`ask`/`never`), canonical explicit `writableRoots`, `networkAccess` (`enabled`/`restricted`) and a launch `binding` fingerprint. Health advertises `create-permission-profile` and reports the immutable startup `host.permissionBinding`. A profile request requires that binding and the host's actual resolved native writable roots to match. Unknown/older bindings and extra/missing roots fail before work; the API never changes host-wide writable roots or network settings. Root mode/approval setters operate only on fresh blank Leads, before input; new managed children inherit the same policy before queued work, including `ask`. Restored roots/members verify saved policy without reapplying it; partial initialization stops admission. Existing native API calls without a profile retain their prior native behavior.

The fingerprint and network field are **launch metadata**, not proof of OS enforcement or an authentication credential. The companion client verifies an Ed25519 context from an externally trusted supervisor, using a public key pinned by the user outside worker control and a per-MCP process challenge. The supervisor must inspect actual effective Codex restrictions and launch MCP/host descendants within that same boundary. Ordinary defaults, environment flags, model-written claims or a self-generated signing key are insufficient. No built-in Codex effective-permission discovery or supervisor is supplied. A signed configuration declaration is rejected by the client; unknown/unverifiable context prevents startup/work. Signature authenticity remains separate from OS verification (`osLimitsVerified: false`).

DSH has no matching network-policy setter. Network allowlists, denied subpaths, temp exceptions and other outer restrictions remain enforced by the supervisor's execution environment. Its stable boundary identity must change when any effective restriction changes. Native policy equality is not complete process confinement. Host reuse requires matching startup record and responding host boundary; a retained process never inherits a new Codex session's changed restrictions automatically. A native preset override additionally requires an explicit user grant in the supervisor's signed context, and cannot remove inherited OS limits. Neither repository installs production keys, changes macOS permissions, restarts hosts or bypasses PID/start-time guards for this feature.

The authenticated URL query is client-side `dsh_team_web_url({teamId})`, after an explicit user request. It returns the owned-host homepage for a managed root, not a Team permalink. It is a reusable host-process bearer credential; restart invalidates it. There is no invented short TTL or one-time-token facility. Errors and ordinary observations never return it.
