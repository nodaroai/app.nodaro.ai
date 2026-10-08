/**
 * The site's URL Inspection allowance is about 2,000 pages a day, and every
 * tool that inspects the site draws on it. Pages checked from the admin page
 * draw on a smaller budget, counted across the API's replicas in Redis per
 * Search Console day (Pacific), so a held-down "Check again" or a leaked
 * admin token runs out this budget — never Google's allowance.
 */

/** Per deployment: staging and production reading the same site stay under Google's ~2,000 together. */
export const INSPECTIONS_PER_DAY = 900

export interface InspectionBudget {
  /** Spends one inspection on `day` (YYYY-MM-DD, Pacific); false when that day's budget is used up. */
  take(day: string): Promise<boolean>
}

/** The one Redis operation the budget needs: add one to a count and keep it a while — in one step. */
export interface CounterStore {
  incrementWithExpiry(key: string, ttlSeconds: number): Promise<number>
}

const KEY_TTL_S = 2 * 86_400

export function createInspectionBudget(
  store: () => Promise<CounterStore>,
  opts: { limit?: number; log?: (message: string) => void } = {},
): InspectionBudget {
  const limit = opts.limit ?? INSPECTIONS_PER_DAY
  const log = opts.log ?? ((message: string) => console.warn(message))
  // This process's view of the day's count: Redis's last answer, then its own
  // checks while Redis cannot answer — a fallback continues the count, never
  // restarts it, and a recovered Redis never counts below it.
  let counted = { day: "", used: 0 }
  let degraded = false
  return {
    async take(day) {
      const known = counted.day === day ? counted.used : 0
      try {
        const client = await store()
        const used = Math.max(await client.incrementWithExpiry(`site-analytics:inspections:${day}`, KEY_TTL_S), known + 1)
        counted = { day, used }
        degraded = false
        return used <= limit
      } catch {
        if (!degraded) log("[site-analytics] Redis did not answer: counting page checks in this process until it does")
        degraded = true
        counted = { day, used: known + 1 }
        return counted.used <= limit
      }
    },
  }
}

interface Pipeline {
  incr(key: string): Pipeline
  expire(key: string, seconds: number): Pipeline
  exec(): Promise<Array<[Error | null, unknown]> | null>
}
interface CounterClient {
  status: string
  on(event: "error", listener: (error: unknown) => void): unknown
  once(event: "ready", listener: () => void): unknown
  off(event: "ready", listener: () => void): unknown
  multi(): Pipeline
}
/** The slice of the BullMQ connection this needs: a way to open its own. */
export interface RedisSource {
  duplicate(options: Record<string, unknown>): CounterClient
}

const COMMAND_TIMEOUT_MS = 2_000

/** Resolves when `client` is ready, or after the timeout — a client with no offline queue refuses every command while it connects. */
function connectedOrTimedOut(client: CounterClient, timeoutMs: number): Promise<void> {
  if (client.status === "ready") return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      client.off("ready", done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    timer.unref?.()
    client.once("ready", done)
  })
}

/**
 * A counter on a duplicate of the BullMQ connection that fails fast: that
 * one queues every command while Redis is down (right for a worker), which
 * would leave an admin's "Check" waiting. Opened on the first check, never at
 * import; a connection that could not be opened is tried again next time.
 */
export function createRedisCounterStore(load: () => Promise<RedisSource>, timeoutMs: number = COMMAND_TIMEOUT_MS): () => Promise<CounterStore> {
  let opening: Promise<CounterStore> | null = null
  const open = async (): Promise<CounterStore> => {
    const client = (await load()).duplicate({ maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: timeoutMs })
    // A connection error is the budget's business (it counts locally), not an unhandled event.
    client.on("error", () => undefined)
    await connectedOrTimedOut(client, timeoutMs)
    return {
      async incrementWithExpiry(key, ttlSeconds) {
        const replies = await client.multi().incr(key).expire(key, ttlSeconds).exec()
        const [error, count] = replies?.[0] ?? [new Error("Redis sent no reply"), null]
        if (error || typeof count !== "number") throw error ?? new Error("Redis did not count")
        return count
      },
    }
  }
  return () => {
    opening ??= open().catch((error: unknown) => {
      opening = null
      throw error
    })
    return opening
  }
}

export const redisCounterStore = createRedisCounterStore(() => import("../../../lib/queue.js").then(({ redis }) => redis as unknown as RedisSource))
