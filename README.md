# dsh-team-roles

Role configuration for native DeepSeek Harness Teams. Edit role instructions and model routes in **Settings → Team roles**, while DSH manages Sessions, members, tasks, tools and approvals.

- Let the Lead choose roles using their descriptions and spawn members with the configured provider, model and reasoning effort.
- Preserve member identity and role snapshots across follow-ups and recovery. Configuration changes apply to new Leads and members.
- With no roles configured, retain native main Agent model selection and teammate inheritance.

## Requirements

- Node.js **>=24.9.0** and UID-owned Unix sockets; macOS is validated.
- The complete official DSH source build at **`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`**, including matching Web artifacts. The published `dsh-v0.2.1-rc.3` lacks required `agent.model.select/current` APIs despite sharing its version string.
- The native Web/base profile with **`@deepseek-ai/dsh-experimental-agent-team-profile`** enabled, and existing native provider registrations for any configured routes.

See [runtime requirements](docs/runtime.md) for the required services. Installing this plugin does not install or upgrade DSH.

## Installation

Use the built `.tgz` from a published [release](https://github.com/silverbullet233/dsh-team-roles/releases):

```sh
dsh plugin --profile web add \
  'https://github.com/silverbullet233/dsh-team-roles/releases/download/v0.3.0/dsh-team-roles-0.3.0.tgz' \
  --ignore-scripts
```

A downloaded file can also be installed with `dsh plugin --profile web add /path/to/dsh-team-roles-0.3.0.tgz --ignore-scripts`. Source archives and direct Git tag installs omit the built Web asset. Installed packages require no manual dependency links.

## Configuration

Open **account menu → Settings → Team roles** in native Web. Add roles with a name, description, instructions, registered provider, model and optional reasoning effort, then select a default Lead role and save. Invalid routes and stale edits are rejected.

Settings saves the role catalog. With roles configured, [create a role-managed Team through the plugin IPC API](docs/protocol.md#create-a-role-managed-team) to apply its Lead route and `spawn_role_teammate` tool. Ordinary Sessions/Teams created directly in Web retain native behavior; IPC-created Teams are also visible in Web.

An empty catalog allows new Teams to use native model inheritance. Existing managed members keep their saved bindings when roles change or are removed; existing unmanaged Teams stay unmanaged when roles are added. Role selection is model-driven.

See [configuration and upgrades](docs/configuration.md) for storage paths and precedence. Text prompts are supported; native workspace and approval rules still apply.

## Development

In a clean source checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:release
npm run test:release
```

These commands need public network access, but no running DSH or provider credentials. See [CONTRIBUTING.md](CONTRIBUTING.md) for native tests and release maintenance. Local integrations can use the [private IPC API](docs/protocol.md).
