# dsh-team-roles

Role configuration for native DeepSeek Harness Teams. Edit role instructions and model routes in **Settings → Team roles**, while DSH manages Sessions, members, tasks, tools and approvals.

- Let the Lead choose roles using their descriptions and spawn members with the configured provider, model and reasoning effort.
- Preserve member identity and role snapshots across follow-ups and recovery. Configuration changes apply to new Leads and members.
- With no roles configured, retain native main Agent model selection and teammate inheritance.

## Requirements

- Node.js **>=24.9.0**; macOS is validated.
- Official npm runtime **`@deepseek-ai/dsh@0.2.2-alpha.2`** for the published **[0.6.0](https://github.com/silverbullet233/dsh-team-roles/releases/tag/v0.6.0)** archive. That archive certifies this exact runtime; other versions are not certified. Earlier `0.2.1-rc.3`, `rc.4` and `rc.5` lack required model-selection APIs.
- The native Web/base profile with **`@deepseek-ai/dsh-experimental-agent-team-profile`** enabled, and existing native provider registrations for any configured routes.

**Unreleased 0.6.1 candidate (this branch):** the candidate moves the exact runtime pin to `@deepseek-ai/dsh@0.2.2-alpha.3` and is validated locally against that official npm graph. It is **not tagged, released or published**; there is no release asset, URL or checksum for it. Install it only from a locally built archive (see [Local candidate validation](#local-candidate-validation)) in an isolated native profile. The published v0.6.0 installation below remains the only released path and stays on `0.2.2-alpha.2`.

See [runtime requirements](docs/runtime.md) for the required services. Installing this plugin does not install or upgrade DSH.

## Installation

These installation pins target **[0.6.0](https://github.com/silverbullet233/dsh-team-roles/releases/tag/v0.6.0)** with the exact supported DSH CLI **`0.2.2-alpha.2`**. Use them only after that exact release is published and its assets are verified. Download the versioned assets and check their SHA-256 checksum first:

```sh
mkdir dsh-team-roles-0.6.0
cd dsh-team-roles-0.6.0
curl -fL https://github.com/silverbullet233/dsh-team-roles/releases/download/v0.6.0/dsh-team-roles-0.6.0.tgz -o dsh-team-roles-0.6.0.tgz
curl -fL https://github.com/silverbullet233/dsh-team-roles/releases/download/v0.6.0/SHA256SUMS -o SHA256SUMS
shasum -a 256 -c SHA256SUMS
dsh plugin --profile web add "$(pwd)/dsh-team-roles-0.6.0.tgz" --ignore-scripts
```

Enable the official Agent Team profile if needed: `dsh plugin --profile web add @deepseek-ai/dsh-experimental-agent-team-profile@0.2.2-alpha.2 --ignore-scripts`. Use the attached versioned `.tgz`; GitHub's automatic source archives omit the built Web asset. Do not substitute a floating `latest` URL or a source branch for normal installation. Host 0.3.0 uses an older runtime and private IPC and is incompatible with the native-Gateway client. Installation does not upgrade a global runtime. A Codex-owned profile uses the same ordinary Web/base and native Agent Team bundles, with its own Harness home and persistent data.

## Local candidate validation

The unreleased 0.6.1 candidate is verified against the official `@deepseek-ai/dsh@0.2.2-alpha.3` npm graph without claiming published assets. From a reviewed source checkout of this branch:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
mkdir -p dist/release
npm pack --pack-destination dist/release
```

Install the built `dsh-team-roles-0.6.1.tgz` only in an isolated native profile whose CLI is exactly `@deepseek-ai/dsh@0.2.2-alpha.3`, together with the matching npm package `@deepseek-ai/dsh-experimental-agent-team-profile@0.2.2-alpha.3` (by package name and version; no profile archive URL is claimed here). Do not present this candidate as a release: tagging, GitHub Release creation and npm publication remain separate maintainer decisions documented in [CONTRIBUTING.md](CONTRIBUTING.md).

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

The unreleased 0.6.1 candidate supports exact caller-selected native profiles and policy propagation before Lead/member/delegated work. The companion requests enabled network by product default, identifies it separately from inherited filesystem rules, and preserves supported launcher state unchanged. Restricted/unknown opaque network cannot safely be split from filesystem/admin policy and is refused before startup/work. Missing supported inheritance without a retained incompatible network contract uses an explicit full-access fallback; no OS refusal triggers retry. Raw native calls without profiles retain their existing behavior. These native settings grant no outer OS/network privilege. See [configuration](docs/configuration.md#candidate-codex-permission-profiles) and the [historical real-model report](docs/acceptance-2026-11-08.md).
