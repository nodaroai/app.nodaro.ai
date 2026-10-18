/**
 * `@nodaro/sdk/client` — `createClient`, the `NodaroClient` it returns, and the auth strategies it takes.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { createClient, NodaroClient } from "../client.js"

export type { ClientOptions, UserIdentity, ConnectedApp } from "../client.js"

export {
  type Auth,
  StaticTokenAuth,
  CallbackAuth,
  supabaseAuth,
} from "../auth.js"
