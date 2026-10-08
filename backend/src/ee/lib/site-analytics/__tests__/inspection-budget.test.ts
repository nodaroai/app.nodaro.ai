import { describe, expect, it, vi } from "vitest"
import { createInspectionBudget, createRedisCounterStore, type CounterStore, type RedisSource } from "../inspection-budget.js"

/** Redis's INCR + EXPIRE, in memory. */
function memoryStore() {
  const counts = new Map<string, number>()
  const expiries: Array<[string, number]> = []
  const store: CounterStore = {
    async incrementWithExpiry(key, ttlSeconds) {
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      expiries.push([key, ttlSeconds])
      return next
    },
  }
  return { store, counts, expiries }
}

const quiet = { log: () => undefined }

describe("createInspectionBudget", () => {
  it("allows the day's budget, then refuses, counting in the shared store", async () => {
    const { store } = memoryStore()
    const budget = createInspectionBudget(async () => store, { limit: 3, ...quiet })
    expect(await Promise.all([budget.take("2026-10-08"), budget.take("2026-10-08"), budget.take("2026-10-08")])).toEqual([true, true, true])
    expect(await budget.take("2026-10-08")).toBe(false)
    expect(await budget.take("2026-10-09")).toBe(true)
  })

  it("every replica draws on the same count", async () => {
    const { store } = memoryStore()
    const replicaA = createInspectionBudget(async () => store, { limit: 2, ...quiet })
    const replicaB = createInspectionBudget(async () => store, { limit: 2, ...quiet })
    expect(await replicaA.take("2026-10-08")).toBe(true)
    expect(await replicaB.take("2026-10-08")).toBe(true)
    expect(await replicaA.take("2026-10-08")).toBe(false)
  })

  it("each count is kept two days, set with the count itself", async () => {
    const { store, expiries } = memoryStore()
    await createInspectionBudget(async () => store, quiet).take("2026-10-08")
    expect(expiries).toEqual([["site-analytics:inspections:2026-10-08", 172_800]])
  })

  it("with Redis gone it continues the count Redis last gave — and says so once", async () => {
    const { store, counts } = memoryStore()
    let up = true
    const log = vi.fn()
    const budget = createInspectionBudget(async () => (up ? store : Promise.reject(new Error("Connection is closed."))), { limit: 4, log })
    await budget.take("2026-10-08")
    await budget.take("2026-10-08")
    up = false
    expect(await budget.take("2026-10-08")).toBe(true) // 3
    expect(await budget.take("2026-10-08")).toBe(true) // 4
    expect(await budget.take("2026-10-08")).toBe(false) // 5
    expect(log).toHaveBeenCalledTimes(1)
    // Back again: Redis says 3, but this process has counted 5 — the higher wins.
    up = true
    expect(await budget.take("2026-10-08")).toBe(false)
    expect(counts.get("site-analytics:inspections:2026-10-08")).toBe(3)
  })

  it("with Redis gone from the start it still bounds this process, day by day", async () => {
    const budget = createInspectionBudget(async () => Promise.reject(new Error("Connection is closed.")), { limit: 2, ...quiet })
    expect(await budget.take("2026-10-08")).toBe(true)
    expect(await budget.take("2026-10-08")).toBe(true)
    expect(await budget.take("2026-10-08")).toBe(false)
    expect(await budget.take("2026-10-09")).toBe(true)
  })
})

describe("createRedisCounterStore", () => {
  function fakeRedis(status = "ready") {
    const listeners = new Map<string, () => void>()
    const exec = vi.fn(async () => [
      [null, 7],
      [null, 1],
    ])
    const calls: string[] = []
    const pipeline = {
      incr: (key: string) => (calls.push(`incr ${key}`), pipeline),
      expire: (key: string, seconds: number) => (calls.push(`expire ${key} ${seconds}`), pipeline),
      exec,
    }
    const client = {
      status,
      on: vi.fn(),
      once: (event: string, listener: () => void) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
      multi: () => pipeline,
    }
    const source = { duplicate: vi.fn(() => client) } as unknown as RedisSource & { duplicate: ReturnType<typeof vi.fn> }
    return { source, client, calls, ready: () => listeners.get("ready")?.() }
  }

  it("opens its own connection that fails fast, and counts with INCR and EXPIRE in one step", async () => {
    const redis = fakeRedis()
    const store = await createRedisCounterStore(async () => redis.source)()
    expect(redis.source.duplicate).toHaveBeenCalledWith({ maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 2_000 })
    expect(await store.incrementWithExpiry("k", 60)).toBe(7)
    expect(redis.calls).toEqual(["incr k", "expire k 60"])
  })

  it("waits for the connection before its first count", async () => {
    const redis = fakeRedis("connecting")
    let opened = false
    const opening = createRedisCounterStore(async () => redis.source, 10_000)().then(() => (opened = true))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(opened).toBe(false)
    redis.ready()
    await opening
    expect(opened).toBe(true)
  })

  it("a connection that could not be opened is tried again on the next check", async () => {
    const redis = fakeRedis()
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(redis.source)
    const store = createRedisCounterStore(load)
    await expect(store()).rejects.toThrow("boom")
    await expect(store()).resolves.toBeDefined()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
