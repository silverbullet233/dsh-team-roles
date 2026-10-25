# dsh-team-roles

Role profiles and model routing for **native DeepSeek Harness Agent Teams**. This package owns the role catalog, immutable member bindings, native Session/Team integration, private IPC server and the **Team roles** page inside native DSH Web Settings. Codex's independent `dsh-agent-team` MCP client lives in `oh-my-codex`; neither package imports the other repository's source.

## Required native runtime

The supported runtime is the complete official source build at **`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`**, including its matching Web frontend. This requires `agent.model.select()`, `agent.model.current()`, durable model selection, native Agent Teams, SessionController, Gateway, Connection, projections and persistence services from that same build. Startup checks the complete sealed artifacts, public imports and actual serving service identities before opening IPC.

The released **`dsh-v0.2.1-rc.3` / `1f81c047fc48fa190a683e469daa699857e9afe8` is unsupported**: it shares version text but lacks the model APIs. This is an exact source/capability requirement, not `>=0.2.1-rc.3`. There is no legacy adapter, custom runtime or DSH source patch. [Runtime verification](docs/runtime.md) records the build evidence.

## Install into native Web

Connect the checkout to that already built official runtime. This creates only package-local dependency links:

```sh
node scripts/runtime/connect.mjs /absolute/path/to/deepseek-harness
node scripts/runtime/verify.mjs
npm run build
node scripts/install-native.mjs
/absolute/path/to/dsh plugin --profile web add link:/absolute/path/to/dsh-team-roles --ignore-scripts
```

The native Web composition must provide the official Agent Teams profile bundle. On migration, follow [the migration guide](docs/migration.md) before relinking so the old server and new server cannot both own the socket. Use one host per writable native data directory. The client attaches to an existing host; it does not launch another one. `scripts/start-native.mjs --shell-env` uses ordinary interactive zsh initialization for existing provider references without copying credentials. No global dependencies, Codex preferences or provider authentication are changed.

Build tooling pins esbuild 0.28.2 with npm integrity metadata. `runtime:connect` can reuse the copy already in the pinned source build. It does not rebuild or upgrade DSH.

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
