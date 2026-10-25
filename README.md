# dsh-team-roles

Role profiles and model routing for **native DeepSeek Harness Agent Teams**. This package owns the role catalog, immutable member bindings, native Session/Team integration, private IPC server and the **Team roles** page inside native DSH Web Settings. Codex's independent `dsh-agent-team` MCP client lives in `oh-my-codex`; neither package imports the other repository's source.

## Versions and publication

The plugin's `package.json` version is **0.2.0**. It is independent of DSH's version, the Git commit and the private IPC protocol version (currently 1). A GitHub push only updates repository source. A Git tag such as `v0.2.0`, a GitHub Release and an npm publication are separate operations; none happens automatically in this repository.

| Distribution | Version users select | Native installer syntax, after that artifact exists |
| --- | --- | --- |
| npm registry | Published package version `0.2.0` | `dsh plugin --profile web add dsh-team-roles@0.2.0 --save-exact --ignore-scripts` |
| GitHub source | Existing tag `v0.2.0` or full commit SHA | `dsh plugin --profile web add 'github:silverbullet233/dsh-team-roles#v0.2.0' --ignore-scripts` |
| GitHub Release asset | Built npm `.tgz` attached to a release | `dsh plugin --profile web add 'https://github.com/silverbullet233/dsh-team-roles/releases/download/v0.2.0/dsh-team-roles-0.2.0.tgz' --ignore-scripts` |
| Local built archive | Absolute `.tgz` path | `dsh plugin --profile web add /absolute/path/dsh-team-roles-0.2.0.tgz --ignore-scripts` |

These forms were checked against the pinned DSH install-spec parser and its CLI forwarding to pnpm. They document accepted package sources, **not a claim that an npm version, tag or Release has been published**. npm `@0.2.0` looks in the configured npm registry; it does not select a GitHub tag. A GitHub Release's automatically generated source archive is not the built npm tarball. GitHub commit pins are more precise than movable tags. See [DSH plugin management](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/boot/plugin-manager/README.md), [pnpm package sources](https://pnpm.io/package-sources) and [npm publishing](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

### Current installation limitation

Version selection and a working runtime are separate requirements. This package currently consumes one sealed source-built DSH installation through **package-local symlinks** created by `scripts/runtime/connect.mjs`. npm archives do not include those links, and this package does not declare substitute registry DSH dependencies. The source tree also ignores generated `lib/client.js`; GitHub source plus `--ignore-scripts` does not build it. There is deliberately no automatic install/prepare hook that discovers or modifies the user's DSH installation.

Consequently, the linked checkout procedure below is the supported, tested installation. A built tarball can be unpacked into a writable directory, connected to the same verified runtime, and installed from that prepared directory with `link:`. The exact-version npm and remote-tarball commands above are valid installer syntax, but **bare direct installation is not yet a portable, zero-setup release workflow**. Registry installation alone does not supply runtime links, configuration or the native Team profile.

The current lock also records the tested CLI entrypoint `/Users/mxr/.local/bin/dsh` and source directory `/Users/mxr/github/deepseek/deepseek-harness`. The connector accepts another source directory and `DSH_SOURCE_ROOT` selects it for verification, but the host verifier still uses the lock's CLI entrypoint by default. Portable runtime/entrypoint binding needs a separate implementation and validation; editing a version range or granting a DSH compatibility exemption cannot replace the required APIs or artifact checks.

## Prerequisites

### DSH build and APIs

The only verified runtime is the **complete official source build** at **`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`**, including matching generated host reflection, dependencies and Web assets. The required APIs include `agent.model.select()`, `agent.model.current()`, durable native model selection, native Team membership/spawn/messages, Session projections/persistence and SessionController create/prompt/projections/cancel. Startup verifies sealed artifact hashes, actual public imports and the serving service identities before opening IPC. Having similarly named services from another runtime is insufficient.

The released **`dsh-v0.2.1-rc.3` / `1f81c047fc48fa190a683e469daa699857e9afe8` is unsupported**: it shares `0.2.1-rc.3` version text but lacks the model APIs. No other released DSH version is certified here. This is an exact source/build requirement, not `>=0.2.1-rc.3`; the package intentionally does not encode a misleading `engines.dsh` semver range. There is no legacy adapter, custom runtime or DSH source patch. [Runtime verification](docs/runtime.md) records the tested build.

### Node and package tools

- **Node.js >=24.9.0**, as required by this package and the pinned DSH source; an OS supporting UID-owned Unix sockets and symlinks. macOS is the validated installation. Windows transport compatibility is not established.
- An already built official DSH CLI and its complete installed source dependencies. Building DSH itself follows its [development documentation](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/development.md) and declared package manager; this plugin does not build or upgrade DSH.
- npm for package/build commands. `dsh plugin` forwards package operations to its configured/bundled pnpm; a separate global pnpm install is not this plugin's requirement. Git is needed for source/tag checkout and runtime revision verification.
- Build-only **esbuild 0.28.2**, pinned in the npm lockfile. `runtime:connect` reuses it, `zod`, `js-yaml`, React and the matching `@deepseek-ai/*` modules from the sealed source installation. It refuses unmanaged existing dependency directories/symlinks. Follow the connector workflow rather than running `npm ci` over its managed links. Neither global TypeScript nor global pi-ai installation is required by this plugin; the verifier checks the source build's pinned TypeScript 6.0.3/pi-ai 1.3.0 artifacts.

### Native profile plugins and services

Use the official native Web profile and enable **`@deepseek-ai/dsh-experimental-agent-team-profile`** after the base profile, before this bundle. This is the official experimental Team layer, not an unrelated community Team implementation. It supplies entries `agent-team`, `tool-agent-team` and `ui-agent-team`, selects the registered native `spawn` backend and disables the ordinary delegation tool entries it replaces. In the existing tested profile it is already enabled; do not compose a second Team service.

The standard profile must retain the following services and their supporting providers. The entry IDs below identify the pinned official composition; service keys are what this plugin injects.

| Native entries / owning packages | Required service or purpose |
| --- | --- |
| `agent` (`@deepseek-ai/dsh-agent`), `agent-loop` | `agents`, native execution and model APIs |
| `session`, `session-projection`, `session-persistence-jsonl` | `sessions`, `sessionProjections`, `sessionPersistence`; durable records and recovery |
| `subagent`, `subagent-spawn-in-process` | Native child lifecycle and registered backend `spawn` |
| `agent-team` (`@deepseek-ai/dsh-experimental-agent-team`), `tool-agent-team` | `agentTeams` and native collaboration tools |
| `session-controller`, `connection`, `typert`, `typert-loader`, `typert-gateway`, `remote-access` | `sessionController`, `connection`, `typert`, `typertGateway`; generated reflection, authenticated native Remote transport and access policy |
| `workspace` (`@deepseek-ai/dsh-workspace`) | `workspaceRegistry`; authorized native workspaces |
| `llm`, `tools`, `system-prompt` | Exact model registry, native tools/guards and instructions |
| `config-editor`, `settings` | Native profile persistence, atomic/revisioned role editing; mandatory even when no browser is open |
| `api-remotes`, browser module loader, `ui-settings`, `ui-settings-general` | Web **Settings → Team roles** page; client modules declared in this package's `dsh.client.inject` |
| `ui-agent-team` | Native browser Team/member visualization |

The base and Web bundles provide these core entries; they are prerequisites, not a request to install every package separately. Native approval, sandbox, workspace and credential policies must remain enabled according to that profile.

The browser UI entries provide rendering; the core role/IPC logic runs in the native host and clients can attach without a browser being open. The **shipped bundle nevertheless requires** Connection/Gateway/SessionController, Settings and the verified complete Web build. Installing it into the stock `dsh headless` profile is not a supported shortcut: that profile does not automatically provide this composition. A UI-free custom host would need the same host services and separate validation. No headless launch/install claim is made here.

### Providers and local configuration

Configure each role's provider in native DSH first, including its normal existing sign-in or credential reference. Every saved `provider` must be a registered provider ID, every `model` must appear in its native catalog, and any `reasoningEffort` must be supported by that exact model. Unknown routes are rejected without fallback. Example role IDs use `deepseek-account/deepseek-flash/max` and `opencode-go/deepseek-v4.1-flash/max`; these are example existing registrations, not providers this package creates or subscriptions it supplies. Your own valid registered routes may replace them.

Keep credentials in DSH's supported credential/account configuration or inherited launch environment. Role JSON contains only provider references, model IDs and instructions. The installer creates `~/.dsh/dsh-agent-team.json` only when absent and preserves an existing file; check its role routes, `allowedRoots`, absolute state path and private socket path before activation. Native Web authentication remains required. One native host owns each writable state directory/socket; Codex's independent client attaches to that host.

## Install a prepared checkout into native Web

For a future tagged release, check out that existing tag first, for example `git clone --branch v0.2.0 --depth 1 https://github.com/silverbullet233/dsh-team-roles.git`. A versioned local directory or unpacked built npm tarball works with the same preparation. Do not replace an actively used linked directory in place.

From the prepared plugin directory, use the runtime paths recorded by the current lock (these are the tested local paths):

```sh
node scripts/runtime/connect.mjs /Users/mxr/github/deepseek/deepseek-harness
node scripts/runtime/verify.mjs
npm run build
node scripts/install-native.mjs
/Users/mxr/.local/bin/dsh plugin --profile web add link:/absolute/path/to/dsh-team-roles --ignore-scripts
```

The CLI entrypoint must also satisfy the lock binding described above. On migration, follow [the migration guide](docs/migration.md) before relinking so the old server and new server cannot both own the socket. `scripts/start-native.mjs --shell-env` uses ordinary interactive zsh initialization for existing provider references without copying credentials. Starting another host is not a client connection. No global dependencies, Codex preferences or provider authentication are changed by preparation. Apply lifecycle changes through native HMR where supported; coordinate any restart that could interrupt work.

## Prepare a versioned release

Run this locally in a connected, verified checkout before creating a release:

```sh
npm run test:unit
npm run test:native
npm run test:runtime
npm run build
npm pack --dry-run
npm pack
```

`npm pack` produces `dsh-team-roles-0.2.0.tgz` for the current manifest version. The `prepack` check rejects missing declared entrypoints, the generated native Web client and runtime verification files. It does not build assets or connect a runtime automatically. `--ignore-scripts` skips lifecycle checks; use the ordinary pack command to prepare release archives. A clean Git source archive without `lib/client.js` must be built first. Package archives intentionally exclude local node_modules/symlinks, secrets and native state. If your existing npm cache is not writable, use an owned cache directory with `--cache /tmp/dsh-team-roles-npm-cache`; no global ownership change is required.

For each release, update `package.json` and the npm lockfile together, build/test the exact source revision, and keep any chosen Git tag consistent with that plugin version. After review, the maintainer can attach the built `.tgz` to a GitHub Release. Publishing that same artifact to npm is a **separate** authorized release action, for example `npm publish ./dsh-team-roles-0.2.0.tgz --access public`; an npm package name/version cannot be republished with different contents. No publish, tag or push is performed by the commands above. This repository has no automatic publication workflow or configured publishing credentials.

Before a public release, choose an available npm name/scope and publishing owner, and decide whether to distribute prepared source-build integrations or implement portable runtime binding for direct registry installation. The unscoped name `dsh-team-roles` is the current package name, not a verified registry reservation. A GitHub-only release with a built tarball supports versioned artifacts without npm publication, while still retaining the runtime preparation requirements.

## Configure roles

Open the authenticated native Web UI, choose **Settings → Team roles**, edit roles and click **Save roles**. Each role has `name`, `description`, `instructions`, an existing native `provider`, a native `model` and optional `reasoningEffort`. The page reads the native model registry; save rechecks the exact provider/model/effort on the server and rejects unavailable routes with an explicit error. No inference or fallback occurs during editing. Provider registration names refer to native credentials; role configuration contains no credentials or endpoint overrides.

The catalog is one volatile Config field, persisted atomically by native Settings into the active Web profile's `cordis.patch.yml`. The page retains the revision at which editing began; concurrent edits are rejected. **Reload saved roles** discards a draft. A successful save takes effect immediately for **new Leads and new members**, without restarting the host or rewriting member records. Existing members, follow-ups and cold recovery preserve their immutable snapshots and native model selection. Removed roles cannot provision new members; members already bound to them still recover.

The preserved `~/.dsh/dsh-agent-team.json` supplies deployment fields and the catalog's initial inherited values. After the first save, the profile catalog is authoritative. An array of role entries makes removal persist across configuration layers. Home patches and command-line overlays retain native precedence and cause a conflicting form write to be refused. Editing the legacy catalog does not override a saved profile catalog. See [configuration and rollback](docs/migration.md).

## IPC and client contract

IPC remains at the configured socket, normally `/tmp/dsh-agent-team-<uid>/native.sock`, with a UID-owned `0700` parent and `0600` socket. Protocol **`dsh-team-roles` version 1** supports `health`, `create`, `send`, `status`, `result` and `stop`. [The wire contract](docs/protocol.md) defines version and capability checks. Use `oh-my-codex`'s independent CLI or MCP client; this host package has no MCP server or client implementation.

The bridge attaches through a native owner Peer with `interactions: none`; it cannot answer approvals and creates no network authentication endpoint. Native Host/Origin/Cookie/workspace/approval policy remains in force. Native DSH owns scheduling, messages, tasks and the Team/member UI.

## Verification

```sh
npm run test:unit
npm run test:native
npm run test:runtime
npm run build
npm run pack:check
```

The native suite uses actual official Session/Team/Loader/Settings services with scripted keyless providers. It checks settings persistence, stale/invalid refusals, snapshot changes, cold recovery, routing and IPC lifetime. Local Unix sockets require host permission in restricted executors. [Validation evidence](docs/validation.md) distinguishes current migration checks from earlier live inference. Text input only; usage and fees remain unknown. No new live inference is needed for this migration.
