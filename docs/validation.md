# Validation evidence

The plugin runs against the complete pinned official source build and is installed as a linked bundle in the user's native Web profile. Keyless native execution, scripted browser rendering and real-provider inference are separate evidence categories.

## Complete source and native tests

| Check | Evidence |
| --- | --- |
| Runtime | Official source `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`; sealed complete host/dependency/frontend manifest; actual public imports and serving-service identity checks |
| `test/runtime/runtime.test.mjs` | 5 passed, including complete-build verification and invalid source/import/artifact controls |
| `test/native/shared-session.test.mjs` | 17 passed using actual native Gateway, SessionController, Team, persistence and private IPC |
| `test/native/validation-scope.test.mjs` | 1 passed; synthetic restrictions do not capture ordinary native Web Sessions |
| Aggregate tests | Final 84/84 passed, including four backup-safety and six exact-request regressions |
| Build/package | ESM package build and package inspection passed |

The native suite covers shared Workspace/Session visibility, roles before first request, concurrent members, repeat instances, same-member follow-up, cold and process-crash recovery, changed roles, native model selection, idempotency/reply-loss windows, queue/steer, cancellation, approval refusal, passive-owner restrictions, MCP EOF, host identity and delegation bypasses. Completed unloaded children retain route evidence and can be observed without reactivation. See [the native test guide](../test/native/README.md).

Unit checks additionally cover protocol handling, private IPC ownership, metadata durability, role records, read-only credentials and fixture confinement. ESM/metadata checks and package inspection passed; repeat affected checks after remaining changes. An earlier npm cache permission issue used a temporary cache without changing global ownership. These checks do not establish real inference.

The source-install task's upstream `pnpm run build` and source checks are recorded in [runtime evidence](runtime.md), separately from the plugin suites. No archived implementation, old generated descriptors or packaged application's frontend is used.

## Native browser rendering

Native Chrome accessibility and screenshot inspection of the user's existing authenticated Web UI showed the real three-member Team in Session `307febae-d8c0-4f59-b442-6ecd8a7efec1`, its successful responses and actual member tool/message traces:

- [Live native Team](../.test-output/live-native-team.png)
- [Live native member tools and messages](../.test-output/live-native-member-tools.png)

The root page title began `Synthetic fixture request: reply exactly`; the child title began `Synthetic fixture task. Use fixture_read`, at `http://127.0.0.1:3080/`. Both carried the native local-build suffix. The child view showed actual `fixture_read`, `fixture_write`, initial `send_message` and follow-up `send_message` operations. Native accessibility and screenshots worked with existing authentication even though browser CDP debugging was not attached.

Earlier isolated keyless rendering used a Lead and two scripted members:

- [Native Team screenshot](../.test-output/native-team.jpg)
- [Native member tools screenshot](../.test-output/native-member-tools.jpg)

These older JPEGs demonstrate native UI with deterministic adapters; the live PNGs above are separate real user-host evidence. Screenshot files are local ignored artifacts. No custom dashboard was built.

## Live results

The installed user host runs `/Users/mxr/.local/bin/dsh web --no-open` with its existing Web profile. Direct CLI and explicit MCP clients attach to that host's UID-restricted socket; neither creates another execution host.

The audited synthetic preflight for Team `d1237bcc…` deliberately blocked inference before its reviewed payload was authorized. A subsequent minimal real DeepSeek account request on native Session `307febae-d8c0-4f59-b442-6ecd8a7efec1` returned `completed: true`, exact output `SYNTHETIC_fa56b94b8b` and an empty errors list.

The same Session completed its explicit dual-provider continuation with output `DUAL_SYNTHETIC left=5 right=11`, `completed: true` and an empty errors list:

| Native member | Immutable role | Actual request route | Result |
| --- | --- | --- | --- |
| `calc-left`, `528fd81b-e17a-4eff-8b99-126958d7a713` | `implementer` | `opencode-go/deepseek-v4.1-flash`, `max` | `left=5` |
| `calc-right`, `22120e1e-eace-44d0-b3b0-0bcdd7996c3a` | `reviewer` | `deepseek-account/deepseek-flash`, `max` | `right=11` |

Both members actually used `fixture_read`, `fixture_write` and native `send_message`. Their durable first request headers and complete payload audits recorded the exact routes before inference. Both children subsequently unloaded: selected routes became `null`, while last-request route evidence remained available.

A real outer Codex invocation authenticated through the ChatGPT subscription used `gpt-6.1-sol` with reasoning effort `high`. Two explicit MCP calls, create and result, created native Session `8fb3cd21-2009-4f03-b05c-0ab6c14195fb` and returned exact output `SYNTHETIC_fa56b94b8b`, `completed: true` and an empty errors list. This proves the outer Codex-to-MCP-to-native-Session handoff; it is separate from the dual-provider collaboration above.

Two earlier outer Codex invocations failed locally: the first had code-host tools disabled and made no MCP call; the second was refused by a local MCP `never` approval rule and made no DSH create call. Invocation-only official per-tool approval rules enabled the successful third attempt, using the requested subscription/model and changing no saved Codex configuration.

A second real outer Codex invocation, again `gpt-6.1-sol` / `high`, successfully continued Session `307febae-d8c0-4f59-b442-6ecd8a7efec1`. One send and three result MCP calls returned exact output `REUSE_fa56b94b8b`, `completed: true` and an empty errors list. Input `reuse-fa56b94b8b` was recorded as processed with outcome `completed`. `calc-left` retained native ID `528fd81b-e17a-4eff-8b99-126958d7a713`; no new member was created.

This was an idle follow-up using the default `queue` mode. The three user inputs changed the objective from a nonce reply to two-member arithmetic and then a reused-member nonce reply; native member completion also produced a fourth Lead turn. Running `steer` and queued-input behavior are verified by keyless native integration tests, not by paid live steering.

After those live calls, independent review added an invocation-only exact request policy to the test client: fixed create/send arguments and result reads limited to the authorized Team, before IPC dispatch. Six new regressions cover refusal and ordinary defaults. The final stdio client replayed both captured successful call sequences against the same native host: both writes returned `duplicate: true`, the same IDs and completed outputs were preserved, and audited payloads remained 23 before and after. No additional inference occurred. This final-policy replay is separate from the earlier real outer-model runs; its evidence is `.test-output/final-policy-replay.json`.

The final native audit contains 23 payloads within its 24-payload budget: one intentionally blocked preflight and 22 permitted adapter submissions. Every request had `maxTokens: 4096`. External HTTP retry counts were not measured, so these submission counts are not asserted as HTTP-attempt counts. Usage and fees remain unknown.

The validation permission file `/private/tmp/dsh-team-native-live/inference-permission.json` was removed after the successful checks. No further live inference is enabled. Live evidence covers normal same-member follow-up; cold child recovery and changed-role recovery are proven only by the keyless native suites. The user-host restart preserved the root Session before these live children were created; it does not establish live child recovery.

Native catalog checks offered `deepseek-account/deepseek-flash` as `DeepSeek-V4.1-Flash` with `max`, and `opencode-go/deepseek-v4.1-flash` with `low`, `high` and `max`. Catalog availability is not inference evidence. After the user-authorized native host restart through its ordinary interactive shell, the host reported its existing OpenCode authentication present. No credential was copied from another process or browser, and no provider/model fallback is used. Earlier standalone catalog results in [catalog evidence](live-catalog.md) describe that command's own launch environment.

Cross-provider inference is restricted to fresh assistant-authored synthetic prompts, trivial fixture text/numbers, complete pre-inference payload audits and two narrow fixture tools. Traversal, symlinks, hardlinks, outside reads and historical forbidden tool declarations are rejected. Test agents receive no repository/personal files, inherited conversations or general shell/network tools. Inputs remain text-only; unknown usage/fees remain `null`.

## Process and installation state

The linked package is registered in the native Web profile, loading `dsh-agent-team/host` through its bundle patch. The user-authorized native host restart was reported as PID `13438`; this is a checkpoint observation, not a stable identifier. Earlier isolated keyless hosts are not user-host live evidence.

Native test fixtures and their owned child processes exited after cleanup. The current user host remains available as PID `13438` on native loopback port `3080` and private IPC, with its existing profile and approved plugin installation. Live validation has finished and its inference permission has been removed. No credential or global Codex configuration was created, copied or changed.

The installer now defaults to roles/bridge configuration without a temporary validation-run dependency; an explicit optional validation `run.json` argument opts into that scope. Guarded nonsecret rollback backups are under `~/.dsh/dsh-agent-team/install-backup-<timestamp>/`, with reconciliation backups alongside as `profile-before-reconcile-<timestamp>.yml`. The startup helper's `--shell-env` uses ordinary `zsh -ic` inheritance and suppresses raw shell/host output. Independent review findings were fixed and the final 84-test aggregate passed.
