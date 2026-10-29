# dsh-team-roles

Role configuration for native DeepSeek Harness Teams. Edit role instructions and model routes in **Settings → Team roles**, while DSH manages Sessions, members, tasks, tools and approvals.

- Let the Lead choose roles using their descriptions and spawn members with the configured provider, model and reasoning effort.
- Preserve member identity and role snapshots across follow-ups and recovery. Configuration changes apply to new Leads and members.
- With no roles configured, retain native main Agent model selection and teammate inheritance.

## Requirements

- Node.js **>=24.9.0** and UID-owned Unix sockets; macOS is validated.
- Official npm runtime **`@deepseek-ai/dsh@0.2.2-alpha.2`**. This exact release is supported; other versions are not certified. Earlier `0.2.1-rc.3` and `rc.4` lack required model-selection APIs.
- The native Web/base profile with **`@deepseek-ai/dsh-experimental-agent-team-profile`** enabled, and existing native provider registrations for any configured routes.

See [runtime requirements](docs/runtime.md) for the required services. Installing this plugin does not install or upgrade DSH.

## Installation

Install/select the supported DSH release, then add the built plugin tarball:

```sh
npm install --global @deepseek-ai/dsh@0.2.2-alpha.2
dsh plugin --profile web add /path/to/dsh-team-roles-0.4.0.tgz --ignore-scripts
dsh web
```

Enable the official Agent Team profile first if it is not active: `dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile@0.2.2-alpha.2 --ignore-scripts`. Use built tarballs from [releases](https://github.com/silverbullet233/dsh-team-roles/releases) or a local build; source archives omit the Web asset. No source checkout, manual dependency links or runtime connector is required.

## Configuration

Open **account menu → Settings → Team roles** in native Web. Add roles with a name, description, instructions, registered provider, model and optional reasoning effort, then select a default Lead role and save. Invalid routes and stale edits are rejected.

Settings saves the role catalog. With roles configured, [create a role-managed Team through the plugin IPC API](docs/protocol.md#create-a-role-managed-team) to apply its Lead route and `spawn_role_teammate` tool. Ordinary Sessions/Teams created directly in Web retain native behavior; IPC-created Teams are also visible in Web.

An empty catalog allows new Teams to use native model inheritance. Existing managed members keep their saved bindings when roles change or are removed; existing unmanaged Teams stay unmanaged when roles are added. Role selection is model-driven.

See [configuration and upgrades](docs/configuration.md) for storage paths and precedence. Text prompts are supported; native workspace and approval rules still apply.

## Development

In a clean source checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
```

Dependencies and tests use the released npm packages, with no running user DSH or provider credentials required. See [CONTRIBUTING.md](CONTRIBUTING.md) for native tests and release maintenance. Local integrations can use the [private IPC API](docs/protocol.md).
