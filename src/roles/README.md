# Native role policy

`index.mjs` provides the Cordis `dshRoles` service in the same host as native Agent Teams and SessionController. Configure roles through [native settings](../../docs/configuration.md).

`prepareLead(sessionId, roleName?)` preserves an existing reservation or writes an immutable Lead role snapshot before native Session creation. An empty catalog with no explicit role leaves the new Session unmanaged, retaining native model inheritance.

The awaited `agent/created` hook validates membership and applies initial model selection and role context before work starts. Own durable selection/request events prevent later recovery from resetting explicit model changes. Fork-inherited records never grant a new binding.

`spawn_role_teammate` reserves and flushes an immutable member snapshot before native Team provisioning. Names identify instances; multiple names may use one role. Follow-up messaging resumes the same member. Changed/removed roles affect new reservations, while bound members retain their snapshots.

Bound Agents use a lifetime tool guard against unreserved native or external delegation, regardless of alias. Admission stays closed during role-service replacement. Independent native Sessions, unmanaged Teams and Web forks retain native behavior. Keep general unrestricted delegation tools disabled in the managed Team composition.

`bindings(rootSessionId)` separates configured routes, current native selections and durable last-request evidence. Unloaded selections are null. Native workspace/approval policies still govern tools; usage and billing are not inferred.
