# Scoped permission acceptance — 2026-11-08 UTC

This is a bounded, completed real-provider integration check on macOS. It supplements the synthetic suites; it does not certify complete Codex permission inheritance. The candidates remain **unreleased**: no tag, Release asset or npm publication is implied by this report or by merging their PRs.

| Component | Tested identity |
| --- | --- |
| Client | 0.4.1, `b92be5a89829de83cbfe484a045d69c33469e945`, [PR #26](https://github.com/silverbullet233/oh-my-codex/pull/26) |
| Host | 0.6.1, `5dbea78dd347751cc5730cc8a3ef1f9f44644bd4`, [PR #17](https://github.com/silverbullet233/dsh-team-roles/pull/17) |
| Codex / DSH / Node | `0.167.0-alpha.3.2` / `0.2.2-alpha.3` / `26.0.0` |

## Observed result

A normal `gpt-6.1-sol` controller called the candidate MCP health/create/wait/result/shutdown tools. Codex supplied protocol metadata automatically, outside model tool arguments. The initiating session used `workspace-write`, automatic review and network enabled. Complete opaque state, the official launcher and the permission binding matched through launch, owned-host health and the native Lead. Runtime/home/PID/start-time/nonce identity was checked. This exercised `codex-request-metadata`; it did not use fallback.

One tool-free Lead used `deepseek-account / deepseek-flash / max`, with a 512-token output cap, and returned exactly `DSH_CODEX_TASK7_OK_20261108`. The guard recorded one dispatch and one finish, zero provider errors, no extra members and no model tool calls. Native usage was 1,137 input + 46 output = 1,183 tokens. HTTP request counts, internal transport retries and monetary cost were not measured; one dispatch does not mean one HTTP request.

Create returned `accepted: true, processed: null`. Passive wait/result then confirmed turn 1 completed, native Team completion, observed owned Jobs settled, no errors or pending tasks, and untruncated output. Admission alone was not counted as completion. The native `danger-full-access + ask + unknown network` snapshot is the expected projection **inside** the official host sandbox; it does not identify YOLO.

Production guarded shutdown succeeded. Six exactly attributed processes, including the launcher and host, were absent afterward, and instance/starting/ready/launch lifecycle records were empty. No force-kill or user-data deletion was required. Four formal, single-session approvals covered preflight, execution and cleanup. No persistent security, firewall, VPN or global configuration was changed. Existing authentication stayed in the official helper; this report contains no credentials or authenticated URL.

Before execution, 41 offline harness checks covered health/identity (15), payload (7), asynchronous completion/cleanup (18), and cross-language serialization review (1). All 120 sealed inputs remained unchanged afterward; the execution-manifest SHA-256 was `47951f422d394bb7edcf9dda63e4c6d3d302f4d761aebfdcbfa12224991ab6ab`. Source/archive/installed-file identity was checked before and after. The PR descriptions retain this result against the exact tested heads; later documentation or test commits do not become additional real-model runs.

## Remaining boundaries

- Actual YOLO and complete initiating-session approval/reviewer inheritance are unverified. The current protocol does not supply the full approval/reviewer policy; DSH `ask` remains explicit. Native `never` is not approve-all.
- Restricted/managed-allowlist networking, arbitrary inbound access, and all filesystem/descendant denial boundaries were not certified by this run. Network-enabled inference establishes only this successful route. Ordinary local stdio sandbox metadata does not carry the complete managed proxy/allowlist/local-binding configuration.
- The full-access-fallback path has synthetic/native policy coverage, not real-provider acceptance. OS/runtime startup refusals remain failures and never select fallback.
- Browser/authenticated-URL UI, arbitrary user plugins, HTTP/retry counts and cost remain unverified.

`signatureVerified: false`, `osLimitsVerified: false`, `ownsExecution: false`, `codexApproval: unknown` and partial/opaque network provenance remain intact. A matching binding is not an OS or approval-policy probe. Earlier read-only startup `EPERM` and `sandbox_apply` failures remain historical failed attempts; this later successful configuration does not overturn them.

## Repeatable checks and evidence handling

The committed client `sandbox-handoff.test.mjs` exercises production permission parsing/admission and retained/responding host fencing with synthetic protocol data. Host unit/native suites verify policy before Lead/member/recursive work and cold restoration without rewriting policy. The isolated gates require no provider or new security settings; full CI additionally covers listener/lifecycle fixtures. None of these reruns are additional real-provider or OS-boundary acceptance.

The one-off real-model harness depends on local approval, runtime and authentication context. It is intentionally not installed as a default test or copied with raw sessions, payloads, private paths or credentials. The durable record is this sanitized report and the scoped acceptance in both PR descriptions. A future real-model run needs its own bounded execution authorization and independent cleanup evidence.
