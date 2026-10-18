/**
 * `@nodaro/sdk/core` — `NodaroClientCore`, the client without its resources
 * (config, auth, the request transport and the account-identity calls), and
 * the auth strategies it takes.
 *
 * `NodaroClient` (from `createClient`) extends it with every resource. Extend
 * it yourself with only the resources you use, and the other resource modules
 * are never loaded:
 *
 *   import { NodaroClientCore, StaticTokenAuth } from "@nodaro/sdk/core"
 *   import { JobsResource } from "@nodaro/sdk/jobs"
 *   import { NodesResource } from "@nodaro/sdk/nodes"
 *
 *   class AppClient extends NodaroClientCore {
 *     readonly jobs = new JobsResource(this)
 *     readonly nodes = new NodesResource(this) // polls through `jobs`
 *   }
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { NodaroClientCore } from "../core.js"

// Also exported by `@nodaro/sdk/client`, next to `createClient` — the same
// bindings, so either entry's user gets them without loading the other.
export {
  type Auth,
  StaticTokenAuth,
  CallbackAuth,
  supabaseAuth,
} from "../auth.js"
