# Native integration tests

Tests use the supported npm release. In a clean checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
```

The suites cover native Session/Workspace/Team projections, role admission and route selection, immutable bindings, idempotent input, cancellation, cold recovery, model-selection persistence, Settings transactions and validation isolation. Native-port tests distinguish root completion from pending or interrupted child work.

Adapters are deterministic synthetic fixtures. Audited model payloads expose native Team coordination and restricted fixture-file operations only. Tests use temporary stores and loopback Web listeners and in-memory credential records, with no provider inference, user files or active Web profile changes. Local loopback listening must be allowed.

For package installation/loading in an isolated native profile, run `node scripts/test-portable-package.mjs ./node_modules/@deepseek-ai/dsh <built-tarball>`.
