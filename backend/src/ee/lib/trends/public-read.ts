/**
 * What the public trend reads (the catalog, its tags, a trend's page) send
 * beside their data: their rate limit, and the cache headers that let a CDN
 * keep a guest's answer while no cache keeps a signed-in one.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { rateLimitAddressKey } from "../../../lib/client-address.js"

/**
 * This many a minute to each read, per address for a guest and per account
 * when signed in. Keyed after the auth hook (`preHandler`) on who it resolved,
 * never on the raw Authorization header: these routes serve a request with an
 * invalid bearer as a guest, so a header key would give every made-up bearer
 * its own bucket.
 */
export const PUBLIC_READ_LIMIT = {
  rateLimit: {
    max: 60,
    timeWindow: "1 minute",
    hook: "preHandler" as const,
    keyGenerator: (req: FastifyRequest) => (req.userId ? `user:${req.userId}` : rateLimitAddressKey(req)),
  },
}

/** How long a guest's answer may be served from a cache: a publish or an edit shows within this. */
export const GUEST_CACHE_SECONDS = 60

/** Adds `names` to the reply's `Vary`, keeping what is there (CORS's `Origin`). */
function addVary(reply: FastifyReply, names: string[]): void {
  const current = reply.getHeader("Vary")
  const have = (Array.isArray(current) ? current.join(",") : String(current ?? ""))
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
  const lower = new Set(have.map((v) => v.toLowerCase()))
  reply.header("Vary", [...have, ...names.filter((n) => !lower.has(n.toLowerCase()))].join(", "))
}

/**
 * Set on a public read's answer, never on a failure. A guest's answer is the
 * same for every guest asking in the same language, so a shared cache may keep
 * it; a signed-in one carries the caller's favorites and language, so none may.
 */
export function publicReadCache(reply: FastifyReply, userId: string | null): void {
  if (userId === null) {
    reply.header("Cache-Control", `public, max-age=${GUEST_CACHE_SECONDS}`)
    addVary(reply, ["Accept-Language", "Authorization"])
  } else {
    reply.header("Cache-Control", "private, no-store")
  }
}
