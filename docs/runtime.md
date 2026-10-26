# Runtime requirements

Supported runtime: complete official DSH source build **`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`**, with matching generated reflection and Web artifacts. Released `dsh-v0.2.1-rc.3` at `1f81c047fc48fa190a683e469daa699857e9afe8` lacks required model APIs. A semver match alone is insufficient.

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

Native peers resolve through the official profile resolver, preserving shared service identities. Optional package-manager peer metadata prevents installing another DSH runtime; host services remain required. Startup verifies APIs, source/build evidence and serving service identities before opening IPC. Missing peers return `DSH_NATIVE_PEERS_UNAVAILABLE`; incompatible APIs, source or build return `DSH_RUNTIME_INCOMPATIBLE`.

`runtime-lock.json` and the sealed manifest bind source, dependencies and artifacts. Installation-directory metadata is excluded so a compatible build can relocate. Changing the seal requires an explicit compatibility review.

Node >=24.9.0 and UID-owned Unix sockets are required. macOS is validated; Windows is not established. The current bundle is not a drop-in for the default headless profile, even if no browser stays open. Preserve native workspace, approval and authentication policies. The IPC owner Peer cannot answer approvals.
