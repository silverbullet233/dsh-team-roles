# Native source runtime

The plugin connects to the complete native DSH source installation at commit `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`. The absolute CLI is `/Users/mxr/.local/bin/dsh`; its installed target is `/Users/mxr/github/deepseek/deepseek-harness/apps/cli/lib/bin.js`. The packaged Desktop application remains separate and unchanged. An identical `0.2.1-rc.3` version string does not establish that a runtime has the pinned Agent APIs.

## Connect and verify

From the plugin checkout:

```sh
node scripts/runtime/connect.mjs /Users/mxr/github/deepseek/deepseek-harness
node scripts/runtime/verify.mjs
node --test test/runtime/runtime.test.mjs
```

The connector changes only plugin-local dependency symlinks. It first checks the complete existing build against the sealed manifest, refuses regular files and unrelated symlinks, and then links public DSH and third-party dependencies to the same source installation. It never builds, installs, modifies the source checkout, changes authentication, starts a host, or changes Codex configuration. Repeated connection to the same build is harmless.

`DSH_SOURCE_ROOT` selects another source directory, or callers may pass `runtimeDirectory` to `verifyRuntime()`. The complete build must still match the sealed source and artifact hashes; selecting a directory cannot authorize different code. Run the connector before importing the plugin when changing directories. The CLI entrypoint must resolve to that same verified installation.

The mandatory host-plugin verifier checks:

- Exact source commit and a clean tracked worktree.
- Source and installed pnpm locks, install metadata, official patch files, TypeScript `6.0.3` implementation bytes, and patched pi-ai `1.3.0` files.
- A sealed manifest of 12,902 generated artifact files, including 12,742 native package files and the complete native Web artifacts.
- The official source build's native Web record: source commit/version plus all 358 frontend files, using the source's own digest algorithm.
- Actual public Cordis, Agent, SessionController, generated Typert reflection, Team and gateway module paths from the same source checkout, plus the required `agent.model.select/current` capabilities.

`runtime-lock.json` seals `scripts/runtime/source-build-manifest.json`. The latter contains relative artifact paths and byte hashes without machine paths or timestamps. The bridge calls `verifyRuntime()` before opening IPC. A changed source tree, dependency installation or built artifact fails closed and requires an explicit reviewed lock update after the corresponding complete build; the connector never silently reseals it.

## One native host for Web and Codex

The plugin's two native plugins are `dsh-agent-team/roles` and `dsh-agent-team/bridge`. Load them into the same source-built native Web profile that provides SessionController and native Agent Team services. Keep native collaboration tools, workspace policies, tools and approvals in that profile. Point the disposable stdio MCP client at that host's private Unix socket. Closing the client leaves the native host running.

Run `npm run test:native` for keyless validation using temporary native Contexts and synthetic stores. The earlier isolated browser-host launch helpers have been removed; live validation and ordinary use attach to the installed user's native Web host. Start only one native host per writable DSH data directory. Use the native URL and supported authentication flow; do not copy browser credentials or disable Host, Origin or Cookie checks. The plugin does not provide a second Web interface or scheduler.

## Build evidence and limits

The separate source-install task ran the official `pnpm run build`: all ten reported build/check stages passed. It also reported 132 focused unit tests and one built Team test. Its plain-Node built-library probe confirmed the new Agent APIs and native Team task operations without model requests. Its native HTTP smoke confirmed unauthorized `401`, the supported token exchange, authenticated native index/assets and Session listing. It did not verify browser rendering.

The current source build uses the ordinary local build profile from official source, rather than the release branding profile. Its frontend records commit `22ddee3`, version `0.2.1-rc.3`, and artifact digest `2656444b8a8921d549798696e7eb2d1dbb717d71481c4746b07ac0eeeb0551fe`. The plugin runtime checks do not independently rerun the upstream source build or upstream tests; those reported checks are recorded separately from current plugin tests.

The old experimental archive/transpilation scripts have been removed. The connector and verifier consume no packaged application DSH code, old generated descriptors or old frontend assets. They do not read or modify global pi-ai. Live provider requests and rendered native Team verification are recorded separately in [validation evidence](validation.md).
