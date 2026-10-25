# Native integration checks

The keyless suite covers shared-host scenarios, validation scope, native Settings transactions, full host composition and removed-role recovery against official source `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`. Run `npm run runtime:connect`, `npm run runtime:verify`, then `npm run test:native` against that complete source build. The connector only links plugin-local dependencies; it does not build or install DSH.

Tests use public native ESM packages, generated SessionController reflection, one native Session store, the shared Gateway and the actual bridge plugin. Startup verifies the complete host/frontend manifest and serving service identities. Local Unix socket listening must be permitted.

The native suite checks:

- Shared SessionController listing, native Team projections and native Workspace grouping.
- Completed Team observation after children unload, retaining durable request evidence without activation. Pure native-port regressions also reject a still-open child turn despite an earlier completed turn.
- Awaited role selection and instructions before first request, simultaneous members, multiple role instances and follow-up identity reuse.
- Cold recovery with changed roles, and recovery of the same flushed native Lead/child after terminating only the owned test process.
- Native member model selection surviving recovery separately from immutable configured roles and actual last-request evidence.
- Concurrent queue/steer, per-input conflicts and native request-ID deduplication after durable create/prompt reply loss.
- Actual stdio MCP EOF leaving the shared native host and running Session alive.
- Native approval refusal without answerers, passive-owner restrictions, cancellation and retained file changes.
- Denial of original spawn and unreserved native Team provisioning for managed Leads, while unmanaged Web Teams remain available.
- Denial of aliased native delegation and direct unreserved child activation under managed Leads and members, including role-service unload/reload. Independent Web forks remain ordinary Sessions.
- External-delegation aliases denied before provider start through plain and admitted-tool-set execution, with an unmanaged-provider fixture control.
- Rejection of serving-service facades outside the verified native runtime.

All inference adapters in these suites are deterministic fixtures. Complete model-visible payloads are audited before responses. Agents receive native Team coordination and two restricted synthetic-file tools, with no general shell, network, repository-reading or personal-file tools. Credential records exist only in memory and are never used in a browser. Temporary logs, sockets and files are removed after quiescent teardown.

`node --test test/native/synthetic-fixtures.test.mjs` separately checks the two fixture operations and auditor, including traversal, symlinks, hardlinks, outside files, oversized content and historical tool declarations.

The validation-scope regression confines tool visibility, request caps and output caps to its synthetic directory, leaving ordinary Web Sessions outside its auditor. Runtime identity/hash tests are separate: `npm run test:runtime` has passed five checks.

Live evidence is separate: the user host completed a two-call outer Codex subscription handoff, a same-Team OpenCode Go/DeepSeek account calculation with exact audited routes, and a second outer Codex send/result continuation reusing the same child ID. Native Chrome accessibility and PNGs show the real three-member Team and actual member tool/messages; earlier JPEGs use scripted adapters.

Live audits ended at 23 payloads within a 24-payload budget, with one preflight blocked before its adapter and 22 permitted submissions, all capped at 4096 output tokens. External HTTP retries and fees were not measured. The live inference permission was removed. Cold child recovery and changed-role recovery remain keyless-only claims. See [validation evidence](../../docs/validation.md).
