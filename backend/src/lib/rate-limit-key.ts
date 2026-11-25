import { createHash } from "node:crypto"
import { rateLimitAddressKey } from "./client-address.js"
import { internalRequestUser } from "./internal-caller.js"

/**
 * Rate-limit key derivation.
 *
 * SECURITY: authenticated requests are keyed by a hash of the credential
 * (Bearer JWT / `ndr_app_` OAuth token / `ndr_` API token), NOT by the
 * client-supplied `X-Forwarded-For`. The previous XFF-only keyer let any caller
 * escape a per-route limit (e.g. suno `/voice/generate` 5/min, 20 cr each) just
 * by rotating the header — a stolen JWT could drain a balance at full speed.
 * Keying by the credential is unspoofable (the attacker would need the token)
 * and gives a stable per-identity bucket regardless of source IP. We only fall
 * back to the client's network for UNauthenticated routes (e.g. OAuth
 * dynamic-client registration), where there is no credential to key on —
 * `lib/client-address.ts`, the one derivation every address reader shares.
 *
 * Exported for the app's limiter, for a route that keys its own buckets on
 * top of it, and for unit testing.
 */
export function rateLimitKeyGenerator(req: {
  headers: Record<string, string | string[] | undefined>
  ip?: string
  socket?: { remoteAddress?: string | undefined } | null
}): string {
  // An internal request (an MCP tool, the orchestrator) acts for the user it
  // names: one bucket per user. It carries no credential, so it used to key
  // on the loopback address: ONE bucket per instance, where one user's MCP
  // fan-out 429'd every other user's (#1888). Checked first, as the auth hook
  // checks the secret first. A forged secret names no user here, so it falls
  // through to the address key and cannot mint a fresh bucket per request.
  const internalUser = internalRequestUser(req.headers)
  if (internalUser) return "user:" + internalUser
  const auth = req.headers["authorization"]
  if (typeof auth === "string" && auth.length > 0) {
    return "cred:" + createHash("sha256").update(auth).digest("hex")
  }
  return rateLimitAddressKey(req)
}
