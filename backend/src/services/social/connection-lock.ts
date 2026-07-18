import { randomBytes } from "node:crypto"
import { redis } from "../../lib/queue.js"

/**
 * Per-connection publish serialization: at most ONE in-flight publish per
 * `connection_id`, across ALL worker instances. This solves two problems at
 * once — per-account platform rate limits, and the token-refresh race (two
 * concurrent publishes both refreshing a rotating refresh token invalidate
 * each other and kill the connection).
 *
 * Redis SET NX PX lock with an owner token; release only deletes the lock if
 * we still own it (Lua compare-and-delete), so an expired-and-reacquired lock
 * is never released by the previous holder.
 */

const LOCK_TTL_MS = 10 * 60 * 1000 // generously above the longest publish

const key = (connectionId: string) => `social:lock:conn:${connectionId}`

const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`

export async function acquireConnectionLock(connectionId: string): Promise<string | null> {
  const token = randomBytes(16).toString("hex")
  const ok = await redis.set(key(connectionId), token, "PX", LOCK_TTL_MS, "NX")
  return ok === "OK" ? token : null
}

export async function releaseConnectionLock(connectionId: string, token: string): Promise<void> {
  try {
    await redis.eval(RELEASE_LUA, 1, key(connectionId), token)
  } catch {
    // Lock will expire via TTL; never fail a publish over a release hiccup.
  }
}
