import { config } from "./config.js"
import { constantTimeEqualStr } from "./constant-time.js"
import { firstHeaderValue } from "./request-helpers.js"

type Headers = Record<string, string | string[] | undefined>

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * True when `provided` is the internal orchestrator secret. The ONE check
 * behind every reader of that secret on the API: the auth hook's door
 * (`middleware/auth.ts`) and the rate limiter's key (`app.ts`), so the two
 * cannot disagree about who is internal. Timing-safe, and never throws: a
 * missing configured secret (a test config) matches nothing.
 */
export function internalSecretMatches(provided: unknown): boolean {
  const secret = config.INTERNAL_ORCHESTRATOR_SECRET
  if (typeof provided !== "string" || typeof secret !== "string" || secret.length === 0) return false
  return constantTimeEqualStr(provided, secret)
}

/**
 * The user an internal request acts for, as the rate limiter keys it: the
 * `x-internal-user-id` of a request whose secret matches, when it is a user
 * id. Null for everything else, including a forged secret, so an outside
 * caller cannot mint a fresh bucket per request by naming random users.
 */
export function internalRequestUser(headers: Headers): string | null {
  if (!internalSecretMatches(firstHeaderValue(headers["x-internal-orchestrator-secret"]))) return null
  const user = firstHeaderValue(headers["x-internal-user-id"])
  return typeof user === "string" && USER_ID.test(user) ? user.toLowerCase() : null
}
