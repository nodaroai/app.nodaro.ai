import { randomBytes } from "node:crypto"
import { redis } from "./queue.js"

/**
 * Redis leases: at most ONE holder of a key across every process and replica.
 *
 * `SET key token PX ttl NX` takes the lease; renewing and releasing are
 * compare-and-extend / compare-and-delete in Lua, so a holder whose lease
 * expired and was taken over by someone else can neither extend nor delete
 * the new holder's lease (`services/social/connection-lock.ts` is the same
 * shape for one fixed use). Exposed to private plugins as `tk.redis.lease`.
 *
 * Keys live under `LEASE_KEY_PREFIX`, so whatever a caller passes can never
 * land on a key the app itself uses.
 */

/** Every lease key lives under this prefix, whatever key the caller names. */
export const LEASE_KEY_PREFIX = "plugin:lease:"

const MIN_TTL_MS = 1_000
const MAX_TTL_MS = 24 * 60 * 60 * 1_000
const MAX_KEY_LENGTH = 200

const RENEW_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`

const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`

function leaseKey(key: string): string {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new Error(`lease key must be 1-${MAX_KEY_LENGTH} characters`)
  }
  return `${LEASE_KEY_PREFIX}${key}`
}

function assertTtl(ttlMs: number): void {
  if (!Number.isInteger(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
    throw new Error(`lease ttl must be a whole number of ms between ${MIN_TTL_MS} and ${MAX_TTL_MS}`)
  }
}

/** The owner token, or null while someone else holds the lease. */
export async function acquireLease(key: string, ttlMs: number): Promise<string | null> {
  const fullKey = leaseKey(key)
  assertTtl(ttlMs)
  const token = randomBytes(16).toString("hex")
  const ok = await redis.set(fullKey, token, "PX", ttlMs, "NX")
  return ok === "OK" ? token : null
}

/** True while `token` still owns the lease; it then lives `ttlMs` more. */
export async function renewLease(key: string, token: string, ttlMs: number): Promise<boolean> {
  const fullKey = leaseKey(key)
  assertTtl(ttlMs)
  return (await redis.eval(RENEW_LUA, 1, fullKey, token, String(ttlMs))) === 1
}

/** True when `token` owned the lease and it is now gone. */
export async function releaseLease(key: string, token: string): Promise<boolean> {
  return (await redis.eval(RELEASE_LUA, 1, leaseKey(key), token)) === 1
}
