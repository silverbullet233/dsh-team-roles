# Optional native authentication helpers

`src/auth/provider.mjs` exports `ReadOnlyNativeCredentials` for validation hosts that must use existing native registrations without modifying them. It is not required to replace an ordinary Web profile's credential provider.

When needed, mount it before native Connection/LLM services with an explicit canonical `path` to the existing native credential document. Reads require an owner-only regular file, reject symlinks and malformed data, and recheck stability. Writes, replacement, creation, migration and refresh are refused. Missing browser signing credentials therefore fail rather than being created. Renew credentials through the normal authorized DSH workflow.

Native Host, Origin and Cookie checks remain active. Credential values stay inside the host and are never returned by IPC health/status.

`registeredRouteCatalog` reports registered route/model/effort availability; `nativeCredentialPresence` reports presence and writability only. Neither starts inference.
