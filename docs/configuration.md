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

The companion's ordinary startup now selects `full-access-default`: native `danger-full-access`, approval `never`, writableRoots `[]`, network enabled intent. It starts the native CLI directly and does not automatically inherit Codex sandbox/approval/network metadata or use an official launcher. Full access allows changes outside the project wherever the host process has access. Existing OS/process/container/admin restrictions still apply; enabled network is requested intent, not verified connectivity. Native `never` does not approve still-required authority decisions.

Explicit companion profiles and optional signed attestation remain supported; restricted/invalid selections are not silently replaced by full access. Native restricted user-tool network cannot be enforced by that backend and is refused before work. Ordinary raw native calls without profiles keep their prior defaults. No unrelated user approval/question or bearer-URL disclosure protection is removed.

Reuse fingerprints distinguish source, cwd, backend and selected policy. Captured `permissionExecution` is checked against retained metadata and responding health, alongside PID/birth/nonce/home/runtime ownership. Old inherited/fallback/restricted/unknown boundaries cannot be silently reused, restarted, terminated or upgraded by the new default. Use a separate dedicated home or explicitly coordinate guarded shutdown of a settled old host. Legacy uncertain startup identities remain uncertain. Actual errors propagate without added roots, alternate paths or broader retry.

The [2026-11-08 scoped real-model acceptance](acceptance-2026-11-08.md) remains historical at its recorded client/host hashes; it exercised the removed launcher path and does not validate this full-access default. No release, tag or npm publication is implied. See the companion [permission documentation](https://github.com/silverbullet233/oh-my-codex/blob/main/plugins/dsh-agent-team/docs/permissions.md).
