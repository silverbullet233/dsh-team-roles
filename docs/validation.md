# Migration validation — 2026-10-25

The native package is now **dsh-team-roles 0.2.0** at `/Users/mxr/github/silverbullet233/dsh-team-roles`. The independent Codex client remains **dsh-agent-team 0.2.0** in `oh-my-codex`, finalized at commit `786426e` on branch `dsh-agent-team`. The native package's initial migration/settings commit is `a565f02`; subsequent local fixes and validation are in this branch. Nothing was pushed or published.

## Executed checks

| Surface | Result |
| --- | --- |
| Native package unit suite | 50/50 passed |
| Native integration suite | 23/23 passed |
| Complete source runtime verification suite | 5/5 passed |
| Independent Codex client suite | 17/17 passed |
| Native/client builds | Passed |
| Actual npm packages | Native 52 files, client 17 files; unpack/import/connection smokes passed |
| Independent read-only review | Startup/lifecycle/schema/mirror findings fixed; final review found no blocker |

The 23 keyless native checks include actual native Session/Team execution, private IPC, idempotency, interrupted/cold/process-crash recovery, exact route selection, immutable bindings, approval refusal and validation confinement. Added actual Loader/Settings tests cover save/reopen, stale revision refusal, invalid provider/model/effort/name/Lead rejection without a write, direct Settings bypass refusal, role removal/addition and HMR disposal during async validation. The fixture uses the real legacy configuration expression form. Full-host composition tests cover dynamic catalog freshness, new Lead routing, old Lead/member snapshots and recovery after role removal.

These are keyless providers with fresh synthetic fixtures. They do not establish new real-provider inference. Final logs are local ignored artifacts; `/tmp/dsh-roles-final-{unit,native,runtime}.log` and `/tmp/dsh-client-final-unit.log` record the executed counts. Standard npm package checks use a temporary cache because the user's default npm cache contains unrelated permission problems; no global ownership was changed.

The native tarball was unpacked into an independent temporary directory, connected through its own local dependency links to the sealed official source build, verified and imported successfully. It contains its native Settings client and no MCP implementation. The Codex tarball was unpacked into a separate directory with no DSH or node_modules; its stdio MCP process initialized, read protocol-1 health and fetched the existing Team result. Neither production package imports the other repository's source. esbuild 0.28.2 is pinned with registry integrity metadata; TypeScript 6.0.3 and pi-ai 1.3.0 were already present and were not reinstalled globally.

## Actual native Web and persisted configuration

Verified authenticated URL: **http://127.0.0.1:3080/**. Navigation is **account menu → Settings → Team roles** (the surrounding shell is localized; the page label is English). The installed native plugin list shows **dsh-team-roles**, linked to the new repository. Browser verification used the existing native authentication without extracting tokens/cookies, changing credentials or bypassing access checks.

The real browser page rendered all three existing roles and native DeepSeek Account/opencode-go model/effort options. A temporary Lead description edit saved successfully through the actual Typert Remote and Settings editor. The native profile gained the `catalog` field under stable entry id `dsh-agent-team`, package `dsh-team-roles`. Submitting `deepseek-account/synthetic-invalid-model` was rejected with `Model deepseek-account/synthetic-invalid-model is not in the native catalog`. Reload discarded the invalid draft. The original description was restored, saved and verified after a complete browser reload/reopen. No test text remains in the saved catalog.

Local screenshot evidence:

- [Reopened native role settings](../.test-output/native-role-settings-reopened.png)
- [Invalid model refusal](../.test-output/native-role-settings-invalid.png)
- [Preserved native Team, three members](../.test-output/native-team-after-migration.png)
- [Preserved member tools/messages](../.test-output/native-member-after-migration.png)

Native Team `307febae-d8c0-4f59-b442-6ecd8a7efec1` still has the same Lead, `calc-left` and `calc-right`. Its member view shows the existing `fixture_read`, `fixture_write` and native `send_message` trace. Independent CLI and packaged MCP health/status/result reads attach to that same native host and return `completed: true`, output `REUSE_fa56b94b8b`. These are retained historical results, not new inference. The native browser page remains open on Team roles.

## Runtime, installation and rollback

The Web host stayed **PID 13438** on loopback **3080** throughout migration. No host restart, user Session cancellation, source patch or global DSH upgrade occurred. The supported runtime remains exact official source **22ddee3792402c3e70ec5f86a63c3e3e895a2f60**, with its sealed complete matching Web build and actual `agent.model.select/current` capabilities. Released `dsh-v0.2.1-rc.3` at **1f81c047fc48fa190a683e469daa699857e9afe8** is unsupported despite sharing the version text.

Installed link: `/Users/mxr/.dsh/profiles/web/node_modules/dsh-team-roles` → the new repository. Profile configuration: `/Users/mxr/.dsh/profiles/web/cordis.patch.yml`. Legacy deployment/configuration: `/Users/mxr/.dsh/dsh-agent-team.json`. Durable binding/correlation state: `/Users/mxr/.dsh/dsh-agent-team/state`. Private socket remains `/tmp/dsh-agent-team-501/native.sock`, mode 0600, in the UID-private parent.

Guarded nonsecret rollback backup: `/Users/mxr/.dsh/dsh-agent-team/install-backup-2026-10-25T15-42-53.245Z/`. The original JSON was also backed up as `config-before-repository-migration-1792943807621.json` before adding only the user-selected new repository to the preserved workspace allowlist. Existing roots, role values, state paths and native credentials were retained. HMR reconciliation backups remain alongside. See [migration and rollback](migration.md), including the matching old host/client checkpoint `71e9f7a`.

## Lead selection and limits

Lead's dynamic `dsh-agent-team-role-catalog` prompt includes each role's name, description and exact provider/model/effort at every prompt assembly. `spawn_role_teammate` accepts a role string and the server validates new reservations against the current catalog. Selection is the Lead model's decision; there is no deterministic complexity scoring/router. Complete role instructions bind to that role's member; existing bindings remain immutable.

No new real inference was run during migration. The prior synthetic audit remains at **23 payloads**, and its inference permission file remains absent. Historical real-provider/outer-Codex evidence is preserved in old Git checkpoint `71e9f7a` and the initial migrated validation document at `a565f02`. Cold/changed/removed-role recovery in this migration is keyless evidence only. Usage and fees remain unknown; inputs remain text-only. No remaining blocker was observed.
