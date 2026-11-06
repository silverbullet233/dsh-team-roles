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

The unreleased client supplies a fresh-Team permissionProfile with sandboxMode, native approvalPolicy (ask/never), exact writableRoots, networkAccess (enabled/restricted/unknown), and binding. Unknown network is retained as unknown, not displayed as disabled. The host applies/verifies policy before first input, and actual native Team/delegated children inherit before queued work. Ordinary native forks are excluded. Restored policy is verified without rewriting, including partial-initialization guards. Existing native API calls without a profile retain their prior behavior.

Health reports immutable startup host.permissionBinding and host.permissionExecution, separate from the saved Team profile and current native root permission snapshot. These are launch metadata, not OS attestation. Changes to later process.env values cannot change the captured execution report. Native workspace-write requires exact host roots. Host-wide writable roots/network are never silently rewritten.

The companion has three ordinary paths: native-default read-only + ask with Codex sandbox/approval/network unknown; a private user-selected --permission-profile with source explicit-configuration; and protocol codex/sandbox-state with an official whole-host sandbox launcher. The latter passes the complete opaque state and starts the native CLI inside it, covering all host user-work routes structurally: shell, filesystem, Web APIs/tools and background descendants. Native danger-full-access + ask is then an inner projection, not proof of YOLO or removal of that outer sandbox. The same boundary may prevent host state writes, configuration reads, listening or model networking; no exceptions are added. External/unknown state or missing launcher refuses new work rather than native fallback. Passive observation/control retains original identity guards.

Complete Codex approval/reviewer and managed-network policy are absent from the experimental protocol. DSH ask does not equal Codex on-request + auto_review; never alone does not imply YOLO. The optional signed strict contract remains an external publisher integration, not a required ordinary-install prerequisite or an OS probe. Native restricted network is rejected by the companion because DSH has no matching setter. A configured invalid strict context is never downgraded. Signatures, environment values and matching fingerprints cannot establish confinement.

Reuse fingerprints include source/cwd/backend/policy and the full opaque state/launcher. Retained and responding host identity must match. Older/mismatched instances are retained without restart, termination or upgrade; their process-start guards remain intact. No keys or production trust enrollment are created. The companion's only real local sandbox attempt was denied before probe execution by sandbox_apply (exit 71); actual whole-host confinement/availability, Web/network and real initiating-session acceptance remain unverified. Both PRs stay Draft. See the companion [permission documentation](https://github.com/silverbullet233/oh-my-codex/blob/feat/codex-permission-handoff/plugins/dsh-agent-team/docs/permissions.md).
