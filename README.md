# dsh-team-roles

Role configuration for native DeepSeek Harness Teams. Edit role instructions and model routes in **Settings → Team roles**, while DSH manages Sessions, members, tasks, tools and approvals.

- Let the Lead choose roles using their descriptions and spawn members with the configured provider, model and reasoning effort.
- Preserve member identity and role snapshots across follow-ups and recovery. Configuration changes apply to new Leads and members.
- With no roles configured, retain native main Agent model selection and teammate inheritance.

## Requirements

- Node.js **>=24.9.0**; macOS is validated.
- Official npm runtime **`@deepseek-ai/dsh@0.2.2-alpha.2`**. This exact release is supported; other versions are not certified. Earlier `0.2.1-rc.3` and `rc.4` lack required model-selection APIs.
- The native Web/base profile with **`@deepseek-ai/dsh-experimental-agent-team-profile`** enabled, and existing native provider registrations for any configured routes.

See [runtime requirements](docs/runtime.md) for the required services. Installing this plugin does not install or upgrade DSH.

## Installation

Install the built **[0.5.0 release](https://github.com/silverbullet233/dsh-team-roles/releases/tag/v0.5.0)** with the exact supported DSH CLI. Download the versioned assets and check their SHA-256 checksum first:

```sh
mkdir dsh-team-roles-0.5.0
cd dsh-team-roles-0.5.0
curl -fL https://github.com/silverbullet233/dsh-team-roles/releases/download/v0.5.0/dsh-team-roles-0.5.0.tgz -o dsh-team-roles-0.5.0.tgz
curl -fL https://github.com/silverbullet233/dsh-team-roles/releases/download/v0.5.0/SHA256SUMS -o SHA256SUMS
shasum -a 256 -c SHA256SUMS
dsh plugin --profile web add "$(pwd)/dsh-team-roles-0.5.0.tgz" --ignore-scripts
```

Enable the official Agent Team profile if needed: `dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile@0.2.2-alpha.2 --ignore-scripts`. Use the attached versioned `.tgz`; GitHub's automatic source archives omit the built Web asset. Do not substitute a floating `latest` URL or a source branch for normal installation. Host 0.3.0 uses an older runtime and private IPC and is incompatible with the native-Gateway client. Installation does not upgrade a global runtime. A Codex-owned profile uses the same ordinary Web/base and native Agent Team bundles, with its own Harness home and persistent data.

## Configuration

Open **account menu → Settings → Team roles** in native Web. Add roles with a name, description, instructions, registered provider, model and optional reasoning effort, then select a default Lead role and save. Invalid routes and stale edits are rejected.

Create a managed Team from **Settings → Team roles → Create a role-managed Team** using the saved Lead role. **Open Team** opens its native Session. External integrations call the same [native Typert Remote API](docs/protocol.md). Ordinary New Session/Team creation keeps native behavior. No global daemon or custom Unix socket is required.

An empty catalog allows new Teams to use native model inheritance. Existing managed members keep their saved bindings when roles change or are removed; existing unmanaged Teams stay unmanaged when roles are added. Role selection is model-driven.

See [configuration and upgrades](docs/configuration.md) for storage paths and precedence. Text prompts are supported; native workspace and approval rules still apply.

## Development

In a clean source checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
```

Dependencies and tests use the released npm packages, with no running user DSH or provider credentials required. See [CONTRIBUTING.md](CONTRIBUTING.md) for native tests and release maintenance. Local integrations can use the [native Gateway API](docs/protocol.md).
