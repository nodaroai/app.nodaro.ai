/**
 * The failure alert of a routed model (docs/design/alternate-routes.md,
 * "Routing per model"): an `[ALERT]` when route failures of one model reach
 * the admin's count within the admin's window (`video_route_policy.failureAlert`),
 * counted across the FLEET of this environment in Redis: every worker adds to
 * one counter per model and window, and exactly one process (the one whose
 * write reaches the count first) raises the alert for that window.
 *
 * Fixed windows (the window's start is `now` rounded down to the window), so
 * two failures straddling a boundary count in different windows. Never throws:
 * when Redis cannot be reached it counts in this process instead.
 */
import { getAppSettings } from "./app-settings.js"
import { getRuntimeEnv } from "./runtime-env.js"
import { VIDEO_ROUTE_POLICY_DEFAULTS } from "./video-route-policy.js"

/** The two Redis calls the counter makes (injectable for tests). */
export interface FailureCounterStore {
  /** Adds one to `key` (created with a lifetime of `ttlMs`); the new count. */
  incr(key: string, ttlMs: number): Promise<number>
  /** True for the one caller that set `key` first (it lives `ttlMs`). */
  setOnce(key: string, ttlMs: number): Promise<boolean>
}

let store: FailureCounterStore | null = null

/** How long a Redis call of the video route may take before it counts as unreachable (never a hang on the offline queue). */
export const VIDEO_ROUTE_REDIS_TIMEOUT_MS = 2_000

/** `p`, or a rejection after `ms` (the timer never holds the process open). */
export function withRedisTimeout<T>(p: Promise<T>, ms = VIDEO_ROUTE_REDIS_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`redis did not answer within ${ms} ms`)), ms)
    timer.unref?.()
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

async function redisStore(): Promise<FailureCounterStore> {
  const { redis } = await import("./queue-connection.js")
  return {
    incr: async (key, ttlMs) => {
      const results = await withRedisTimeout(redis.multi().incr(key).pexpire(key, ttlMs).exec())
      const n = results?.[0]?.[1]
      return typeof n === "number" ? n : Number(n)
    },
    setOnce: async (key, ttlMs) => (await withRedisTimeout(redis.set(key, "1", "PX", ttlMs, "NX"))) === "OK",
  }
}

const local = new Map<string, number>()
const localStore: FailureCounterStore = {
  incr: async (key) => {
    const n = (local.get(key) ?? 0) + 1
    local.set(key, n)
    return n
  },
  setOnce: async (key) => {
    if (local.has(`once:${key}`)) return false
    local.set(`once:${key}`, 1)
    return true
  },
}

/** Records one route failure of `model`; resolves once the alert (if due) is written. */
export async function noteRouteFailure(model: string, now = Date.now()): Promise<void> {
  try {
    const rule = (await getAppSettings()).video_route_policy?.failureAlert ?? VIDEO_ROUTE_POLICY_DEFAULTS.failureAlert
    const windowMs = rule.windowMinutes * 60_000
    const windowStart = Math.floor(now / windowMs) * windowMs
    const key = `video-route:failures:${getRuntimeEnv()}:${model}:${windowStart}`
    let s = store
    if (!s) {
      try {
        s = await redisStore()
      } catch {
        s = localStore
      }
    }
    let count: number
    try {
      count = await s.incr(key, windowMs * 2)
    } catch {
      s = localStore
      count = await s.incr(key, windowMs * 2)
    }
    if (count < rule.failures) return
    if (!(await s.setOnce(`${key}:alerted`, windowMs * 2))) return
    console.error(`[ALERT] video route: ${count} failures of ${model} on the alternate route within ${rule.windowMinutes} minutes (this environment). Admin → Video route can put it back on the default provider.`)
  } catch {
    // An alert must never break the failure it observes.
  }
}

/** Test seam: the store to count in (null: Redis). */
export function _setRouteFailureStoreForTests(s: FailureCounterStore | null): void {
  store = s
  local.clear()
}

/** Test seam. */
export function _resetRouteFailuresForTests(): void {
  local.clear()
}
