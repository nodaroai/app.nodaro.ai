/**
 * LEAF module: the in-memory credit-balance cache behind `GET /credits/balance`
 * (ee/routes/credits.ts), keyed by userId. It lives apart from the route so
 * the billing code that invalidates it after a credit mutation (credits.ts,
 * provision-credits, signup-grant, consent-record, pipeline credits) does not
 * load the route module and, through it, every estimate route it registers.
 * The route re-exports `invalidateBalanceCache`, so both paths share this one
 * Map.
 */
const BALANCE_CACHE_TTL_MS = 15_000 // 15 seconds
const balanceCache = new Map<string, { data: unknown; expiry: number }>()

export function getCachedBalance(userId: string): unknown | null {
  const entry = balanceCache.get(userId)
  if (!entry) return null
  if (Date.now() > entry.expiry) {
    balanceCache.delete(userId)
    return null
  }
  return entry.data
}

export function setCachedBalance(userId: string, data: unknown): void {
  balanceCache.set(userId, { data, expiry: Date.now() + BALANCE_CACHE_TTL_MS })
  if (balanceCache.size > 10_000) {
    const now = Date.now()
    for (const [k, v] of balanceCache) {
      if (now > v.expiry) balanceCache.delete(k)
    }
  }
}

/** Invalidate cached balance for a user (call after credit mutations) */
export function invalidateBalanceCache(userId: string): void {
  balanceCache.delete(userId)
}
