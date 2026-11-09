import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// One store per key namespace: two catalogs that both call their list
// "voices" never read each other's snapshot, and a store's own byte cap is
// the one it publishes under. The Lua compare-and-set, the lock and the
// timeouts are exercised through the HeyGen catalog tests, which run on the
// same machine.
// ---------------------------------------------------------------------------

const redisFake = vi.hoisted(async () => {
  const { makeFakeRedis } = await import("../../../providers/heygen/__tests__/fake-redis.js")
  return makeFakeRedis()
})
vi.mock("@/lib/queue.js", async () => ({ redis: await redisFake }))
const fake = await redisFake

beforeEach(() => fake.reset())
afterEach(() => vi.restoreAllMocks())

describe("createSnapshotStore", () => {
  it("keys every snapshot, meta and lock under its own namespace", async () => {
    const { createSnapshotStore } = await import("../snapshot-store.js")
    const a = createSnapshotStore({ namespace: "a:catalog", logTag: "a" })
    const b = createSnapshotStore({ namespace: "b:catalog", logTag: "b" })

    expect(await a.writeSnapshot("voices", { generation: "ga", filledAt: 10, items: [1] })).toBe(true)
    expect(await b.writeSnapshot("voices", { generation: "gb", filledAt: 20, items: [2, 3] })).toBe(true)

    expect([...fake.store.keys()].sort()).toEqual(["a:catalog:v1:voices", "a:catalog:v1:voices:meta", "b:catalog:v1:voices", "b:catalog:v1:voices:meta"])
    expect((await a.readSnapshot<number>("voices"))?.items).toEqual([1])
    expect((await b.readSnapshot<number>("voices"))?.items).toEqual([2, 3])
    expect(await a.readSnapshotMeta("voices")).toEqual({ generation: "ga", filledAt: 10 })

    const token = await a.acquireRefreshLock("voices")
    expect(token).toBeTruthy()
    expect(fake.store.has("a:catalog:v1:voices:refresh-lock")).toBe(true)
    expect(await b.acquireRefreshLock("voices")).toBeTruthy() // b's lock is its own
    await a.releaseRefreshLock("voices", token!)
    expect(fake.store.has("a:catalog:v1:voices:refresh-lock")).toBe(false)
  })

  it("never regresses a newer snapshot, whichever namespace", async () => {
    const { createSnapshotStore } = await import("../snapshot-store.js")
    const a = createSnapshotStore({ namespace: "a:catalog", logTag: "a" })
    expect(await a.writeSnapshot("voices", { generation: "new", filledAt: 20, items: [] })).toBe(true)
    expect(await a.writeSnapshot("voices", { generation: "old", filledAt: 10, items: [] })).toBe(false)
    expect((await a.readSnapshot("voices"))?.generation).toBe("new")
  })

  it("a store's own byte cap refuses an implausible list, warning under its tag", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { createSnapshotStore, MAX_SNAPSHOT_BYTES } = await import("../snapshot-store.js")
    const small = createSnapshotStore({ namespace: "s:catalog", logTag: "small-store", maxSnapshotBytes: 64 })
    expect(await small.writeSnapshot("voices", { generation: "g", filledAt: 1, items: ["x".repeat(100)] })).toBe(false)
    expect(fake.store.size).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[small-store]"), expect.stringContaining("sanity cap"))

    const roomy = createSnapshotStore({ namespace: "r:catalog", logTag: "roomy", maxSnapshotBytes: MAX_SNAPSHOT_BYTES * 2 })
    expect(await roomy.writeSnapshot("voices", { generation: "g", filledAt: 1, items: ["x".repeat(100)] })).toBe(true)
  })

  it("a round-trip past the store's own bound is 'no store' (null / false), never a hang", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { createSnapshotStore } = await import("../snapshot-store.js")
    const quick = createSnapshotStore({ namespace: "q:catalog", logTag: "q", redisTimeoutMs: 20 })
    const hang = () => new Promise<never>(() => {})
    vi.spyOn(fake, "get").mockImplementation(hang)
    vi.spyOn(fake, "eval").mockImplementation(hang)
    const started = Date.now()
    expect(await quick.readSnapshot("voices")).toBeNull()
    expect(await quick.readSnapshotMeta("voices")).toBeNull()
    expect(await quick.writeSnapshot("voices", { generation: "g", filledAt: 1, items: [] })).toBe(false)
    expect(Date.now() - started).toBeLessThan(2_000) // three bounded waits, not the default 1.5 s each
  })

  it("with Redis down every read answers null and every write false — the catalog serves from memory", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { createSnapshotStore } = await import("../snapshot-store.js")
    const a = createSnapshotStore({ namespace: "a:catalog", logTag: "a" })
    fake.down = true
    expect(await a.readSnapshot("voices")).toBeNull()
    expect(await a.readSnapshotMeta("voices")).toBeNull()
    expect(await a.writeSnapshot("voices", { generation: "g", filledAt: 1, items: [] })).toBe(false)
    expect(await a.acquireRefreshLock("voices")).toBeNull()
    expect(await a.isStoreReachable()).toBe(false)
  })
})
