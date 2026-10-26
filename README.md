# dsh-team-roles

**dsh-team-roles 0.3.0** adds configurable role profiles, immutable member bindings, private IPC and a **Team roles** settings page to native DeepSeek Harness. Native DSH owns Session/Team execution, tasks, messages, tools and approvals. The independent Codex MCP client is maintained separately as `dsh-agent-team`; this package contains no MCP server or second dashboard.

## Install by plugin version

Install a built package into a compatible native DSH Web profile:

```sh
dsh plugin --profile web add /absolute/path/dsh-team-roles-0.3.0.tgz --ignore-scripts
```

After the corresponding artifact is published, these native installer forms select a version:

```sh
# Requires a separately published npm version.
dsh plugin --profile web add dsh-team-roles@0.3.0 --save-exact --ignore-scripts

# Requires the built npm tarball attached to an existing GitHub Release.
dsh plugin --profile web add 'https://github.com/silverbullet233/dsh-team-roles/releases/download/v0.3.0/dsh-team-roles-0.3.0.tgz' --ignore-scripts
```

The **local versioned tarball** has been installed and loaded in an isolated native profile with a relocated compatible runtime. GitHub/npm publication has not been performed, and registry name availability/ownership has not been checked. A GitHub push updates source only: npm versions, Git tags and GitHub Releases are separate artifacts. See [DSH plugin management](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/boot/plugin-manager/README.md) and [npm publishing](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

The parser also accepts `github:silverbullet233/dsh-team-roles#v0.3.0` or a commit pin. This is source installation syntax, not the tested binary-asset path: Git source omits generated `lib/client.js`, and `--ignore-scripts` will not build it. Use the built `.tgz` for direct installation. A GitHub-generated source archive is not that npm tarball. [pnpm package sources](https://pnpm.io/package-sources) documents the syntax.

There is **no manual node_modules linking or runtime connector step for installed packages**. DSH's official profile resolver supplies the installation's native peers to ESM and CommonJS imports, retaining one Cordis and one set of native service constructors. Ordinary libraries (`zod` 4.4.3, `js-yaml` 4.3.2 and its dependency) install normally. Native peers are marked optional for package-manager installation so npm/pnpm does not fetch a second DSH runtime; the corresponding host services are still mandatory at runtime.

## Required DSH runtime

The supported runtime remains the **complete official source build** at **`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`**, with matching generated reflection, source dependencies and Web artifacts. Its source tree and artifacts may be installed at another path. The plugin discovers the actual Agent module selected by the official resolver and verifies it against the launcher's installation anchor; it saves no workstation-specific CLI/source location and does not depend on a CLI shim path.

Required APIs include `agent.model.select()`, `agent.model.current()`, durable model selection, native Team membership/spawn/messages, Session projections/persistence and SessionController create/prompt/projections/cancel. Startup checks these capabilities, sealed portable build evidence and actual serving service identities before provisioning managed roles or opening IPC. The seal omits package-manager installation-directory metadata, which changes on relocation; source/build/dependency/artifact verification remains. See [runtime verification](docs/runtime.md).

The released **`dsh-v0.2.1-rc.3` at `1f81c047fc48fa190a683e469daa699857e9afe8` is unsupported** because it lacks the model APIs, even though its version string matches the tested source build. Peer version compatibility is only a preliminary package check, not API certification. No newer DSH release is certified here; there is no legacy adapter, silent fallback or bundled copy of native DSH service implementations.

### Node and profile prerequisites

- **Node.js >=24.9.0** and UID-owned Unix sockets. macOS is validated; Windows transport support is not established.
- The already built supported official DSH installation. This plugin neither builds nor upgrades DSH. Native `dsh plugin` uses its configured/bundled pnpm; no separate global package-tool upgrade is required.
- The official native Web/base profile, with **`@deepseek-ai/dsh-experimental-agent-team-profile`** enabled before this bundle. Its entries are `agent-team`, `tool-agent-team`, `ui-agent-team`; it selects the registered native `spawn` backend. Do not replace it with an unrelated community Team implementation or create a second Team service.

The official profile supplies the following entries and their transitive dependencies; these are not instructions to install individual DSH packages from npm:

| Entries / owning packages | Host services or purpose |
| --- | --- |
| `agent` (`@deepseek-ai/dsh-agent`), `agent-loop` | `agents`, native execution/model APIs |
| `session`, `session-projection`, `session-persistence-jsonl` | `sessions`, `sessionProjections`, `sessionPersistence` |
| `subagent`, `subagent-spawn-in-process` | Native child lifecycle and backend `spawn` |
| `agent-team`, `tool-agent-team` | `agentTeams`, native collaboration tools |
| `session-controller`, `connection`, `typert`, `typert-loader`, `typert-gateway`, `remote-access` | `sessionController`, `connection`, `typert`, `typertGateway`, reflection and native access policy |
| `workspace` | `workspaceRegistry` and authorized workspaces |
| `llm`, `tools`, `system-prompt` | Registry, tool guards and role instructions |
| `config-editor`, `settings` | Atomic, revisioned native profile persistence |
| `modules`, `api-remotes`, `ui-settings`, `ui-settings-general` | Native Web role settings rendering |
| `ui-agent-team` | Native Team/member visualization |

Browser display components render the UI; a browser need not stay open for IPC/native execution. The shipped bundle still needs Connection/Gateway/SessionController and Settings, and its runtime check still verifies the complete Web build. It is not a drop-in package for the default `dsh headless` composition. A custom UI-free host needs the same host services and separate validation.

Keep native approval, sandbox, workspace, Host/Origin/Cookie and credential policies intact. The bridge's native owner Peer has `interactions: none` and cannot answer approvals. Run one native host per writable state directory/socket.

## Configure roles in native Web

Open the authenticated native Web UI and choose **account menu → Settings → Team roles**. A fresh installation loads an **empty catalog**, with no assumed provider/model. Teams can be created immediately: with no roles configured, the Lead uses the native main Agent selection and teammates inherit its provider, model and applicable reasoning options through native delegation. To use explicit role routes, add roles, choose a default Lead and save. Clearing the entire catalog (including the default Lead) restores native behavior for new Teams; malformed or invalid explicit routes still fail.

Each role has `name`, `description`, `instructions`, an existing native `provider`, `model` and optional `reasoningEffort`. Configure providers and their normal native sign-in/credential references in DSH first. Saving checks exact provider registration, native catalog membership and supported effort. The package creates no provider account, subscription or credential. The example routes `deepseek-account/deepseek-flash/max` and `opencode-go/deepseek-v4.1-flash/max` refer to previously configured registrations, not a promise every installation has them.

A save uses native Settings locking, atomic persistence and a revision fence; stale drafts are rejected. **Reload saved roles** discards a draft. Changes apply immediately to **new Leads and new members**. Existing member snapshots, follow-up, explicit model selections and cold recovery retain their original bindings. Removing a role blocks new reservations, while old bound members remain recoverable. An existing unmanaged native Lead stays unmanaged when roles are later configured; clearing the catalog does not change existing managed Lead/member snapshots.

Lead receives the current role names, descriptions and exact provider/model/effort on each prompt assembly. It chooses a role through `spawn_role_teammate`; the server validates the reservation. Selection is model-driven, with no deterministic complexity scoring. Complete instructions bind to the chosen member.

### Defaults and migration

Fresh defaults use the native Harness home: state under `dsh-agent-team/state`, socket under the OS temporary directory as `dsh-agent-team-<uid>/native.sock`, and the profile launch directory as the workspace allowlist. Adjust ordinary deployment fields through the native profile configuration when needed. Socket parent/socket permissions remain `0700`/`0600`.

If `dsh-agent-team.json` already exists in the native Harness home, its deployment fields and role catalog remain inherited initial values. Native Settings saves `catalog: { leadRole, roles: [...] }` under stable entry id **`dsh-agent-team`** in the active profile's `cordis.patch.yml`. Saved profile catalog values take precedence over the legacy JSON; higher home/CLI overlays keep native precedence and conflicting form writes are refused. No installer rewrites credentials, native account/session data or the legacy file. See [migration and rollback](docs/migration.md).

Apply installation changes through the native lifecycle; coordinate restarts if the selected profile requires one. Never run an old and new native role bridge against the same writable store/socket. The Codex client connects to the existing host rather than starting another writer.

## Build and release

For development, use the supported source build's dependencies through an explicit developer environment; `scripts/runtime/connect.mjs <source-directory>` remains a **source-checkout development helper**, is excluded from the published package and is not an installation requirement. Build-only esbuild 0.28.2 is locked. The plugin requires no global TypeScript/pi-ai install or DSH upgrade.

Before packaging a release from a prepared development checkout:

```sh
npm run test:unit
npm run test:native
npm run test:runtime
npm run build
npm pack --dry-run
npm pack

# Keyless isolated install/load of the actual built tarball.
node scripts/test-portable-package.mjs /absolute/path/to/compatible-dsh ./dsh-team-roles-0.3.0.tgz
```

The manifest currently produces **`dsh-team-roles-0.3.0.tgz`**. `prepack` rejects missing entrypoints, generated native Web client and verification files; it does not run provider inference or mutate an installation. `--ignore-scripts` on package installation is supported because the release already contains the browser asset and needs no prepare/postinstall step. Archives contain no development-checkout paths, native service bundles, manual dependency links, credentials or native state. If an existing npm cache is unwritable, use an owned cache with `--cache /tmp/dsh-team-roles-npm-cache`.

After review, a maintainer may attach the built tarball to a GitHub Release or separately publish it with `npm publish ./dsh-team-roles-0.3.0.tgz --access public`. This documentation does not perform either action. Choose an available npm name/scope and owner first; no registry reservation or publishing credentials have been configured. Keep plugin package version, Git tag and release asset consistent; a published npm name/version cannot be replaced with different bytes.

The plugin version **0.3.0**, native IPC protocol **1**, and supported DSH source/version are separate compatibility dimensions. [Validation evidence](docs/validation.md) distinguishes actual local tarball installation from parse-only GitHub/npm syntax and keyless tests from historical real inference.

## IPC and limits

Protocol **`dsh-team-roles` version 1** exposes `health`, `create`, `send`, `status`, `result`, `stop` over the private UID socket. The independent Codex client checks version/capabilities before work. See [wire details](docs/protocol.md). Disconnect/EOF leaves native work running; uncertain admission requires inspection with the same key/input ID before retry. Stop retains file changes.

Inputs remain text-only. Unknown usage/fees and unloaded selections remain null. Portability validation uses actual native services and scripted keyless adapters, with no paid inference or user files. Cross-platform and a different physical machine have not been independently tested.
