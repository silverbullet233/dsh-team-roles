# Runtime requirements

Supported runtime: official npm **`@deepseek-ai/dsh@0.2.2-alpha.2`**. The matching released package graph, reflection and Web assets are required. Earlier `0.2.1-rc.3` and `rc.4` lack `agent.model.select/current`; later versions need separate compatibility validation.
Use the official Web/base profile and `@deepseek-ai/dsh-experimental-agent-team-profile`. These profiles supply the required entries and transitive dependencies:

| Entries | Required capability |
| --- | --- |
| `agent`, `agent-loop` | Agent execution, `agent.model.select/current`, durable selection |
| `session`, `session-projection`, `session-persistence-jsonl` | Sessions, projections and persistence |
| `subagent`, `subagent-spawn-in-process` | Native child lifecycle and `spawn` backend |
| `agent-team`, `tool-agent-team`, `ui-agent-team` | Team service, collaboration tools and visualization |
| `session-controller`, `connection`, `typert`, `typert-loader`, `typert-gateway`, `remote-access` | Native session API, reflection and access policy |
| `workspace`, `llm`, `tools`, `system-prompt` | Workspaces, model registry, tool policy and instructions |
| `config-editor`, `settings` | Revisioned atomic settings writes |
| `modules`, `api-remotes`, `ui-settings`, `ui-settings-general` | Native Web settings |

Native peers resolve through the official profile resolver, preserving shared service identities. Optional package-manager peer metadata prevents installing another DSH runtime; host services remain required. Missing peers return `DSH_NATIVE_PEERS_UNAVAILABLE`.

The package declares the exact `engines.dsh` version and native peers. Startup checks matching package versions, public model/Team/Session APIs, generated Session reflection, Web entry assets and resolver identity. It does not require a Git checkout or source/build hash manifest. `DSH_RUNTIME_INCOMPATIBLE` errors identify unsupported versions, missing capabilities or mismatched serving packages; native service-instance checks remain mandatory.
Node >=24.9.0 is required. macOS is validated; Windows is not established. The current bundle is not a drop-in for the default headless profile, even if no browser stays open. Preserve native workspace, approval and authentication policies. Passive API clients cannot answer approvals.
