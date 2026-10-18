---
"@nodaro/sdk": minor
---

New `NodaroClientCore` (`@nodaro/sdk/core`, also exported from the root): the client without its resources — config, auth, the request transport and `me()` / `connectedApps()` / `revokeConnectedApp()`. Extend it with only the resources you use, and the other resource modules are never loaded:

```ts
import { NodaroClientCore, StaticTokenAuth } from "@nodaro/sdk/core"
import { JobsResource } from "@nodaro/sdk/jobs"
import { NodesResource } from "@nodaro/sdk/nodes"

class AppClient extends NodaroClientCore {
  readonly jobs = new JobsResource(this)
  readonly nodes = new NodesResource(this) // polls through `jobs`
}
```

`NodaroClient` (what `createClient` returns) now extends it, with the same public members, types and behavior: every resource is still built when the client is. In its type declarations the transport and identity members are now inherited from `NodaroClientCore`, and `Object.keys(client)` lists `workspaceId` before the resources rather than after them. Every resource constructor now takes a `NodaroClientCore` (`NodesResource` one that also has `jobs`, `Scene3DResource` one that also has `nodes`), so a `NodaroClient` is still accepted everywhere. The auth strategies are exported by `@nodaro/sdk/core` as well as `@nodaro/sdk/client`.

The transport and identity methods (`request`, `requestText`, `requestBytes`, `me`, `connectedApps`, `revokeConnectedApp`, the `fetch` getter) now live on `NodaroClientCore.prototype`, one level up from `NodaroClient.prototype`: `Object.getOwnPropertyNames(NodaroClient.prototype)` no longer lists them and `NodaroClient.prototype.hasOwnProperty("request")` is `false`, while calling them is unchanged; and `ConstructorParameters<typeof XResource>[0]` is now the core type (`NodaroClientCore`, or the core plus `jobs` / `nodes`) instead of `NodaroClient`.
