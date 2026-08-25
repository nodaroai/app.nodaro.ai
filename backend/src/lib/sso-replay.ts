import { redis } from "./queue.js"

/**
 * One-time-use guard for SSO assertions (§5.6 rule 2). A verified assertion may
 * be redeemed at most once; the jti is the token identity, namespaced per
 * provider. Backed by Redis (multi-instance safe on Railway — an in-memory Map
 * would let a replay land on a sibling process). TTL ≥ the assertion's own
 * remaining lifetime PLUS the clock-tolerance grace band (see
 * sso-assertion.ts::expSeconds), so the key outlives every window in which the
 * assertion is still cryptographically valid.
 *
 * Returns true on first use (claimed), false on a replay (already seen).
 */
export async function claimAssertionJti(providerId: string, jti: string, ttlSeconds: number): Promise<boolean> {
  const key = `sso:jti:${providerId}:${jti}`
  const ttl = Math.max(Math.ceil(ttlSeconds), 1)
  const res = await redis.set(key, "1", "EX", ttl, "NX")
  return res === "OK"
}
