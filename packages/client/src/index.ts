export { createClient, NodaroClient } from "./client.js"
export type { ClientOptions } from "./client.js"

export {
  type Auth,
  StaticTokenAuth,
  CallbackAuth,
  supabaseAuth,
} from "./auth.js"

export {
  NodaroError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  InsufficientCreditsError,
  StorageExceededError,
  throwFromResponse,
} from "./errors.js"

// Re-export selected types from @nodaro/shared for convenience
export type { GenericNode, GenericEdge } from "@nodaro/shared"
