import { redis } from "./queue.js"

/**
 * Rate limits of the MCP assertion exchange (POST /v1/oauth/token with the
 * jwt-bearer grant, decided 2026-11-11), counted in Redis so every replica
 * shares them, in fixed one-minute windows like the sign-in's own limiter
 * (`routes/sso.ts`):
 *
 *  - by NETWORK (the caller's hashed address, `callerKeyHash` — the key the
 *    sign-in and dynamic registration use), every exchange attempt, before
 *    any work is done for it (the client-secret check is a deliberate bcrypt
 *    cost);
 *  - by CLIENT, every exchange whose client secret checked out. Counted only
 *    after the secret, so nobody who lacks it can use up the application's
 *    allowance by naming its client id.
 *
 * Both sized for one application exchanging for all of its people from one
 * server: an hour-long token per person per hour is 300 a minute for 18,000
 * people active in the same hour.
 *
 * A Redis error THROWS: the exchange fails closed (it could not check the
 * replay of the assertion without Redis either), unlike the browser sign-in,
 * which lets a person in when its limiter is down.
 */

export const EXCHANGE_WINDOW_SEC = 60
export const EXCHANGES_PER_NETWORK = 300
export const EXCHANGES_PER_CLIENT = 300

export type ExchangeAllowance = { readonly ok: true } | { readonly ok: false; readonly retryAfterSec: number }

async function take(key: string, max: number): Promise<ExchangeAllowance> {
  // The counter is created WITH its TTL on the first hit (SET .. EX .. NX): a
  // bare INCR followed by a separate EXPIRE would leave a key that never
  // expires if the EXPIRE failed.
  const created = await redis.set(key, "1", "EX", EXCHANGE_WINDOW_SEC, "NX")
  const n = created === "OK" ? 1 : await redis.incr(key)
  if (created !== "OK") {
    const ttl = await redis.ttl(key)
    if (ttl < 0) await redis.expire(key, EXCHANGE_WINDOW_SEC)
  }
  if (n <= max) return { ok: true }
  const ttl = await redis.ttl(key)
  return { ok: false, retryAfterSec: ttl > 0 ? ttl : EXCHANGE_WINDOW_SEC }
}

/** One exchange attempt from this network (a `callerKeyHash`). Throws when Redis cannot be reached. */
export function takeNetworkAllowance(networkKey: string): Promise<ExchangeAllowance> {
  return take(`rl:oauth-exchange:net:${networkKey}`, EXCHANGES_PER_NETWORK)
}

/** One authenticated exchange by this client. Throws when Redis cannot be reached. */
export function takeClientAllowance(clientId: string): Promise<ExchangeAllowance> {
  return take(`rl:oauth-exchange:client:${clientId}`, EXCHANGES_PER_CLIENT)
}
