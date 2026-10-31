# Native Gateway refactor validation

Validated on macOS with Node 26.0.0 and the exact official DSH 0.2.2-alpha.2 npm graph. All automated native fixtures use test-owned stores, bounded deterministic adapters and in-memory credential records. No live provider inference was performed.

- Unit regressions: role snapshots, native admission, immutable members, writer locks, create/input retry conflicts and uncertain reply windows, projection evidence and drain-before-disposal.
- Native regressions: same-member follow-up, running queue/steer, Team interruption, configuration edits and cold/process-crash recovery, empty catalog inheritance and independent Web forks.
- Real Node Connection/Gateway over HTTP/Mux: launch-token exchange, role-managed Team creation, duplicate create, processing/result distinction, disconnect without cancellation, fresh API Peer and shutdown guard.
- Exact runtime and release-safety suites; built tarball install/load in a fresh native profile, negative API checks and outside-launcher rejection.
- Browser inspected in Chrome using the ordinary official Web/base and Team bundles. Settings → Team roles created a synthetic Team, Open Team selected that same Session, and the native view showed KEYLESS_WEB_COMPLETE with the configured fixture model.

The Web fixture has a read-only in-memory credential provider and a synthetic model. This certifies the integration path, not paid inference or all user-installed plugin combinations. Published host 0.3.0 is incompatible with the new client. Install the actual locally built host candidate first; publish/release only through a separate maintainer decision.
