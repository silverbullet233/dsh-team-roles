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

The companion requests enabled network as product-default intent, not inherited Codex network policy. Supported network-enabled state is passed unchanged to the official whole-host launcher, retaining filesystem rules; native ask remains distinct from unknown Codex approval/reviewer. Restricted/unknown opaque network cannot reliably be separated from filesystem/admin policy: `NETWORK_POLICY_SPLIT_UNAVAILABLE` stops startup/work without rewriting or full-access retry. Without a retained incompatible network contract, missing metadata/launcher or unsupported state uses explicit native danger-full-access/never fallback with network enabled intent and a reported reason. Private explicit profiles and optional strict attestation remain available; source conflicts and invalid configuration fail closed. All paths retain outer process/OS/network/admin limits. Enabled intent does not certify actual connectivity.

Complete Codex approval/reviewer and managed-network policy are absent from the experimental protocol. DSH ask does not equal Codex on-request + auto_review; never alone does not imply YOLO. The optional signed strict contract remains an external publisher integration, not a required ordinary-install prerequisite or an OS probe. Native restricted network is rejected by the companion because DSH has no matching setter. A configured invalid strict context is never downgraded. Signatures, environment values and matching fingerprints cannot establish confinement.

Reuse fingerprints include source, fallback reason, cwd/backend/policy, network-default version and the full offered opaque state/launcher. The current enabled-network intent does not silently reuse an older unknown-network binding. Captured permissionExecution retains the fallback source/reason separately from native policy; fallback cannot masquerade as verified inheritance. Retained and responding host identity must match. Older/mismatched instances are retained without restart, termination or upgrade; their process-start guards remain intact. No keys or production trust enrollment are created. Prior real Codex tools/call metadata injection succeeded. A candidate host with that real read-only state then reached DSH 0.2.2-alpha.3 runCli and failed with OS EPERM writing its profile configuration, before model inference. This is distinct from the earlier sandbox_apply failure and must never become a full-access retry. A later [scoped real-model acceptance](acceptance-2026-11-08.md) passed one network-enabled whole-host/Lead/model path and cleanup. Full approval/reviewer, YOLO, managed-network and complete OS-boundary inheritance remain unverified; merging does not certify them or publish the candidate. See the companion [permission documentation](https://github.com/silverbullet233/oh-my-codex/blob/feat/codex-permission-handoff/plugins/dsh-agent-team/docs/permissions.md).
