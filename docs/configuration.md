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
- Default socket: `dsh-agent-team-<uid>/native.sock` under the OS temporary directory, with private directory/socket permissions.
- Default workspace allowlist: the profile's launch directory.

If `dsh-agent-team.json` exists under the Harness home, its deployment fields and role catalog supply inherited values. Saved profile catalog values override them; native home/CLI overlays retain their precedence. Conflicting form writes are refused.

## Upgrades

Preserve the stable entry id, state/config paths and native records. Keep a recoverable nonsecret configuration backup and the previous package version. Use native lifecycle handling and coordinate any required restart with active work. Run one host per writable store/socket; remove an older bundle registration before replacing it. Do not overwrite account/session stores or copy credentials.
