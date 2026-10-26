# Native integration tests

Use the [complete compatible DSH build](../../docs/runtime.md):

```sh
npm run runtime:connect -- /absolute/path/to/built-dsh
npm run runtime:verify
npm run test:native
npm run test:runtime
```

The suites cover native Session/Workspace/Team projections, role admission and route selection, immutable bindings, idempotent input, cancellation, cold recovery, model-selection persistence, Settings transactions and validation isolation. Native-port tests distinguish root completion from pending or interrupted child work.

Adapters are deterministic synthetic fixtures. Audited model payloads expose native Team coordination and restricted fixture-file operations only. Tests use temporary stores/sockets and in-memory credential records, with no provider inference, user files or active Web profile changes. Local Unix socket listening must be allowed.

For package installation/loading in an isolated native profile, run `node scripts/test-portable-package.mjs <compatible-runtime> <built-tarball>`.
