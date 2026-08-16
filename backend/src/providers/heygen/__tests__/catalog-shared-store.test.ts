import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { lookPage as page, makeResponse, routeLooks, settle } from "./catalog-test-helpers.js"

// ---------------------------------------------------------------------------
// The shared store (Redis) — one fill per environment, survives deploys,
// replicas converge. The catalog store talks to the shared ioredis client
// from lib/queue.ts — stand in an in-memory fake (see fake-redis.ts). Hoisted
// so every `vi.resetModules()` + re-import of catalog.js keeps talking to the
// SAME fake: that is how "instance B adopts instance A's snapshot" is modelled.
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test", HEYGEN_CATALOG_REFRESH_HOURS: 24 },
}))
const redisFake = vi.hoisted(async () => {
  const { makeFakeRedis } = await import("./fake-redis.js")
  return makeFakeRedis()
})
vi.mock("@/lib/queue.js", async () => ({ redis: await redisFake }))
const fake = await redisFake
beforeEach(() => fake.reset())



// ---------------------------------------------------------------------------
// The shared store (Redis) — one fill per environment, survives deploys
// ---------------------------------------------------------------------------

describe("shared snapshot store", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const publicCalls = () => fetchMock.mock.calls.filter((c) => (c[0] as string).includes("ownership=public")).length
  const flush = () => new Promise((r) => setTimeout(r, 0))

  beforeEach(async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test", HEYGEN_CATALOG_REFRESH_HOURS: 24 } }))
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("publishes a finished public fill to Redis, and a fresh process adopts it with ZERO HeyGen calls", async () => {
    routeLooks(fetchMock, { public: [page("look-1", "c2"), page("look-2")] })
    const a = await import("../catalog.js")
    const first = await a.listAvatars()
    expect(first.map((x) => x.avatarId)).toEqual(["look-1", "look-2"])
    await flush()
    const stored = JSON.parse(fake.store.get("heygen:catalog:v1:avatars") ?? "null")
    expect(stored).toMatchObject({ generation: expect.any(String), filledAt: expect.any(Number) })
    expect(stored.items).toHaveLength(2)

    // "Instance B" / the next deploy: a fresh module registry, same Redis.
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test", HEYGEN_CATALOG_REFRESH_HOURS: 24 } }))
    const callsBefore = publicCalls()
    const b = await import("../catalog.js")
    const snap = await b.snapshotAvatars()
    expect(snap.complete).toBe(true)
    expect(snap.items.map((x) => x.avatarId)).toEqual(["look-1", "look-2"])
    expect(snap.generation).toBe(stored.generation) // same list, same generation → client deltas keep working across instances
    expect(publicCalls()).toBe(callsBefore) // no HeyGen call at all
  })

  it("boot race: a request that arrives while the snapshot is being adopted waits for it — no needless fill", async () => {
    routeLooks(fetchMock, { public: [page("look-1")] })
    const a = await import("../catalog.js")
    await a.listAvatars() // fills + publishes
    await settle()
    // Fresh process: warm() and the first picker request land together.
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test", HEYGEN_CATALOG_REFRESH_HOURS: 24 } }))
    const before = publicCalls()
    const b = await import("../catalog.js")
    b.warmHeygenCatalog()
    const [first, second] = await Promise.all([b.snapshotAvatars(), b.snapshotAvatars()])
    expect(first.items.map((x) => x.avatarId)).toEqual(["look-1"])
    expect(second.items.map((x) => x.avatarId)).toEqual(["look-1"])
    await settle()
    expect(publicCalls() - before).toBe(0) // adopted once, shared by every concurrent caller
  })

  it("the private (own) looks are memory-only: refetched by every process, never written to Redis", async () => {
    routeLooks(fetchMock, { private: [page("mine-1")], public: [page("look-1")] })
    const a = await import("../catalog.js")
    expect((await a.snapshotPrivateAvatars()).map((x) => x.avatarId)).toEqual(["mine-1"])
    await flush()
    expect([...fake.store.keys()].some((k) => k.includes("private"))).toBe(false)
  })

  it("a stale shared list is refreshed by ONE instance (refresh lock); the other keeps serving the stale list and adopts the new one", async () => {
    vi.useFakeTimers()
    routeLooks(fetchMock, { public: [page("old-look")] })
    const a = await import("../catalog.js")
    expect((await a.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["old-look"])
    await vi.advanceTimersByTimeAsync(0)

    // Instance B boots later, adopts the same snapshot from Redis.
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test", HEYGEN_CATALOG_REFRESH_HOURS: 24 } }))
    const b = await import("../catalog.js")
    expect((await b.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["old-look"])

    // 25 hours later both are stale. A asks first and takes the lock; its
    // refresh fill is held open (page 1 does not answer until we let it).
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000)
    let releaseNewPage: (() => void) | undefined
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes("ownership=private")) return makeResponse({ code: 0, message: "success", data: [] })
      return new Promise<Response>((r) => { releaseNewPage = () => r(makeResponse(page("new-look"))) })
    })
    const before = publicCalls()
    const staleFromA = await a.snapshotAvatars()
    expect(staleFromA.items.map((x) => x.avatarId)).toEqual(["old-look"]) // served at once
    await settle()
    expect(fake.store.get("heygen:catalog:v1:avatars:refresh-lock")).toBeDefined() // A holds the lock
    // …B asks while A refreshes: sees the lock, does NOT fetch, keeps serving stale.
    const staleFromB = await b.snapshotAvatars()
    expect(staleFromB.items.map((x) => x.avatarId)).toEqual(["old-look"])
    await settle()
    expect(publicCalls() - before).toBe(1) // exactly one refresh fill in the environment

    // A's fill lands and is published; the lock is released.
    releaseNewPage?.()
    await settle()
    expect((await a.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["new-look"])
    await settle()
    expect(fake.store.get("heygen:catalog:v1:avatars:refresh-lock")).toBeUndefined() // released after publish

    // B converges on its next store sync (one tiny meta read, throttled 30 s) — no HeyGen call.
    vi.setSystemTime(Date.now() + 31_000)
    expect((await b.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["new-look"])
    expect(publicCalls() - before).toBe(1) // still one
  })

  it("Redis unavailable → behaves exactly like the in-memory catalog: fills locally, serves locally, refreshes itself", async () => {
    vi.useFakeTimers()
    fake.down = true
    routeLooks(fetchMock, { public: [page("look-1")] })
    const a = await import("../catalog.js")
    const snap = await a.snapshotAvatars()
    await settle()
    expect((await a.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["look-1"])
    expect(snap.generation).not.toBe("none")
    // stale + Redis still down → the lock can't be taken, but a duplicate fill beats a stale-forever list
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000)
    routeLooks(fetchMock, { public: [page("look-2")] })
    await a.snapshotAvatars()
    await settle()
    expect((await a.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["look-2"])
  })

  it("a cold process re-checks Redis for a snapshot at most every 5 s while its own fill runs (a down Redis costs a timeout per read)", async () => {
    vi.useFakeTimers()
    // A slow public fill: page 1 lands, page 2 never resolves during the test.
    let releasePage2: (() => void) | undefined
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes("ownership=private")) return makeResponse({ code: 0, message: "success", data: [] })
      if (url.includes("token=c2")) return new Promise<Response>((r) => { releasePage2 = () => r(makeResponse(page("look-2"))) })
      return makeResponse(page("look-1", "c2"))
    })
    const a = await import("../catalog.js")
    const reads = () => fake.calls.filter((c) => c === "get heygen:catalog:v1:avatars").length
    expect((await a.snapshotAvatars()).complete).toBe(false)
    const afterFirst = reads()
    expect(afterFirst).toBeGreaterThanOrEqual(1)
    // Pickers poll every 2 s — the next few polls do NOT hit Redis again.
    await a.snapshotAvatars()
    await a.snapshotAvatars()
    expect(reads()).toBe(afterFirst)
    // …but 5 s later the process looks again (another instance may have finished).
    vi.setSystemTime(Date.now() + 5_001)
    await a.snapshotAvatars()
    expect(reads()).toBe(afterFirst + 1)
    releasePage2?.()
    await settle()
  })

  it("an interrupted refresh resumes under the lock it already holds — no waiting out the 15-min lock TTL", async () => {
    vi.useFakeTimers()
    routeLooks(fetchMock, { public: [page("old-look")] })
    const a = await import("../catalog.js")
    expect((await a.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["old-look"])
    await settle()

    // 25 h later: stale → refresh takes the lock; page 2 of the refresh FAILS.
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000)
    let page2Attempts = 0
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes("ownership=private")) return makeResponse({ code: 0, message: "success", data: [] })
      if (url.includes("token=c2")) {
        page2Attempts++
        if (page2Attempts === 1) throw new Error("HeyGen hiccup")
        return makeResponse(page("new-look-2"))
      }
      return makeResponse(page("new-look-1", "c2"))
    })
    await a.snapshotAvatars() // stale, served at once; refresh starts behind it
    await settle()
    expect(page2Attempts).toBe(1) // failed once
    expect(fake.store.get("heygen:catalog:v1:avatars:refresh-lock")).toBeDefined() // still ours

    // Past the 10 s back-off (far below the lock TTL) the next request resumes
    // the same fill from its cursor — under our own lock — and publishes.
    vi.setSystemTime(Date.now() + 11_000)
    await a.snapshotAvatars()
    await settle()
    expect(page2Attempts).toBe(2)
    expect((await a.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["new-look-1", "new-look-2"])
    await settle()
    expect(fake.store.get("heygen:catalog:v1:avatars:refresh-lock")).toBeUndefined() // released after publish
    expect(JSON.parse(fake.store.get("heygen:catalog:v1:avatars") ?? "{}").items).toHaveLength(2)
  })

  it("after 5 failed resumes in a row the next fill starts from page 1 (a dead cursor must not pin the catalog)", async () => {
    vi.useFakeTimers()
    let firstPageCalls = 0
    let deadCursorCalls = 0
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes("ownership=private")) return makeResponse({ code: 0, message: "success", data: [] })
      if (url.includes("token=dead")) { deadCursorCalls++; throw new Error("cursor expired") }
      firstPageCalls++
      // The 7th first-page call gets a clean two-page catalog.
      return makeResponse(firstPageCalls >= 2 ? page("look-1") : page("look-1", "dead"))
    })
    const a = await import("../catalog.js")
    await a.snapshotAvatars()
    await settle()
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(Date.now() + 11_000)
      await a.snapshotAvatars()
      await settle()
    }
    expect(deadCursorCalls).toBe(5)
    // The fill restarted from page 1 and completed.
    expect(firstPageCalls).toBe(2)
    expect((await a.snapshotAvatars()).complete).toBe(true)
  })

  it("refreshHeygenCatalog (manual): starts fresh fills now, ignoring the TTL; a second call while one runs says 'already-running'", async () => {
    vi.useFakeTimers()
    routeLooks(fetchMock, { public: [page("look-1")] })
    const a = await import("../catalog.js")
    await a.snapshotAvatars()
    await settle()
    const before = publicCalls()
    // Fresh (not stale) — a plain snapshot would never refetch. Hold the
    // refresh's page open so the second call sees a fill in flight.
    let releasePage: (() => void) | undefined
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes("ownership=private")) return makeResponse({ code: 0, message: "success", data: [] })
      if (url.includes("/v2/voices")) return makeResponse({ code: 0, message: "success", data: { voices: [] } })
      return new Promise<Response>((r) => { releasePage = () => r(makeResponse(page("look-2"))) })
    })
    const r = await a.refreshHeygenCatalog()
    expect(r.avatars).toBe("started")
    expect(r.voices).toBe("started")
    await settle()
    expect((await a.refreshHeygenCatalog()).avatars).toBe("already-running")
    releasePage?.()
    await settle()
    expect(publicCalls() - before).toBe(1)
    expect((await a.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["look-2"])
    await settle()
    expect(fake.store.get("heygen:catalog:v1:avatars:refresh-lock")).toBeUndefined()
  })

  it("refreshHeygenCatalog says 'adopted' when a sibling already published a newer list — and takes it, no HeyGen call", async () => {
    routeLooks(fetchMock, { public: [page("look-1")] })
    const a = await import("../catalog.js")
    await a.snapshotAvatars()
    await settle()
    const before = publicCalls()
    // A sibling instance published a newer snapshot meanwhile.
    const { writeSnapshot } = await import("../catalog-store.js")
    const newer = { generation: "sibling-gen", filledAt: Date.now() + 1_000, items: [{ avatarId: "sibling-look", name: "S", gender: "female", previewImageUrl: "" }] }
    expect(await writeSnapshot("avatars", newer)).toBe(true)
    const r = await a.refreshHeygenCatalog()
    expect(r.avatars).toBe("adopted")
    expect((await a.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["sibling-look"])
    expect(publicCalls() - before).toBe(0)
  })

  it("a manual refresh after an interrupted refresh starts OVER (new generation from page 1), never resumes the stale fill", async () => {
    vi.useFakeTimers()
    routeLooks(fetchMock, { public: [page("old-look")] })
    const a = await import("../catalog.js")
    const first = await a.snapshotAvatars()
    await settle()
    // 25 h later a TTL refresh starts and its page 2 fails → interrupted, lock held.
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000)
    let page2Calls = 0
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes("ownership=private")) return makeResponse({ code: 0, message: "success", data: [] })
      if (url.includes("/v2/voices")) return makeResponse({ code: 0, message: "success", data: { voices: [] } })
      if (url.includes("token=c2")) { page2Calls++; throw new Error("hiccup") }
      return makeResponse(page("resumed-look-1", "c2"))
    })
    await a.snapshotAvatars()
    await settle()
    expect(page2Calls).toBe(1)
    // The operator presses Refresh now: a FRESH fill from page 1 (a clean two-look list this time).
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes("ownership=private")) return makeResponse({ code: 0, message: "success", data: [] })
      if (url.includes("/v2/voices")) return makeResponse({ code: 0, message: "success", data: { voices: [] } })
      if (url.includes("token=")) return makeResponse(page("fresh-2"))
      return makeResponse(page("fresh-1", "c9"))
    })
    const r = await a.refreshHeygenCatalog()
    expect(r.avatars).toBe("started")
    await settle()
    const after = await a.snapshotAvatars()
    expect(after.items.map((x) => x.avatarId)).toEqual(["fresh-1", "fresh-2"])
    expect(after.generation).not.toBe(first.generation)
    await settle()
    expect(fake.store.get("heygen:catalog:v1:avatars:refresh-lock")).toBeUndefined()
  })

  it("giving up on a fill (5 failed resumes) releases the refresh lock instead of holding it to the 15-min TTL", async () => {
    vi.useFakeTimers()
    routeLooks(fetchMock, { public: [page("old-look")] })
    const a = await import("../catalog.js")
    await a.snapshotAvatars()
    await settle()
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000)
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes("ownership=private")) return makeResponse({ code: 0, message: "success", data: [] })
      if (url.includes("/v2/voices")) return makeResponse({ code: 0, message: "success", data: { voices: [] } })
      if (url.includes("token=dead")) throw new Error("cursor expired")
      return makeResponse(page("look-1", "dead"))
    })
    await a.snapshotAvatars() // stale → takes the lock, refresh starts, page 2 dies
    await settle()
    expect(fake.store.get("heygen:catalog:v1:avatars:refresh-lock")).toBeDefined()
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(Date.now() + 11_000)
      await a.snapshotAvatars()
      await settle()
    }
    // 5 failures in a row → gave up → lock released for the rest of the environment.
    expect(fake.store.get("heygen:catalog:v1:avatars:refresh-lock")).toBeUndefined()
  })

  it("two replicas that hold different lists converge: a client showing B a generation it does not know makes B re-read the store within 5 s", async () => {
    vi.useFakeTimers()
    // A and B boot cold at the same time and each fill on their own (deliberate: cold instances serve progressively).
    routeLooks(fetchMock, { public: [page("look-a")] })
    const a = await import("../catalog.js")
    const fromA = await a.snapshotAvatars()
    await settle()
    await a.snapshotAvatars() // a warm request: A's periodic store sync ran just now (nothing newer yet)
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test", HEYGEN_CATALOG_REFRESH_HOURS: 24 } }))
    // B's fill happens 1 ms later, so B's list is the newer one in Redis.
    vi.setSystemTime(Date.now() + 1)
    fake.store.delete("heygen:catalog:v1:avatars") // pretend B saw nothing at boot (raced A's publish)
    fake.store.delete("heygen:catalog:v1:avatars:meta")
    routeLooks(fetchMock, { public: [page("look-b")] })
    const b = await import("../catalog.js")
    const fromB = await b.snapshotAvatars()
    await settle()
    expect(fromA.generation).not.toBe(fromB.generation)
    // 6 s later a plain request to A: its periodic sync (30 s) has not come round → still its own list.
    vi.setSystemTime(Date.now() + 6_000)
    expect((await a.snapshotAvatars()).items.map((x) => x.avatarId)).toEqual(["look-a"])

    // …but a client that just talked to B asks A with B's generation → urgent re-read (5 s throttle) → A adopts B's newer list.
    const converged = await a.snapshotAvatars({ offset: 1, generation: fromB.generation })
    expect(converged.generation).toBe(fromB.generation)
    expect(converged.items.map((x) => x.avatarId)).toEqual([]) // delta from offset 1 of B's 1-item list — the client is caught up
    expect(converged.total).toBe(1)
  })

  it("pages are de-duplicated by id as they land, and a runaway cursor is stopped by the page cap", async () => {
    // A cursor that keeps handing out the same look — a looping HeyGen page.
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes("ownership=private")) return makeResponse({ code: 0, message: "success", data: [] })
      return makeResponse({ code: 0, message: "success", data: [
        { id: "dup", avatar_type: "photo_avatar", name: "dup", gender: "Female", preview_image_url: "" },
        { id: "dup", avatar_type: "photo_avatar", name: "dup again", gender: "Female", preview_image_url: "" },
      ], next_token: "again", has_more: true })
    })
    const a = await import("../catalog.js")
    const all = await a.listAvatars()
    expect(all.map((x) => x.avatarId)).toEqual(["dup"]) // 1,000 looping pages → one look, not 2,000 rows
    expect(publicCalls()).toBe(1000) // stopped at the page cap
  })

  it("refreshHeygenCatalog is 'unconfigured' without a key and 'locked-elsewhere' while another instance refreshes", async () => {
    fake.store.set("heygen:catalog:v1:avatars:refresh-lock", "someone-else")
    routeLooks(fetchMock, { public: [page("look-1")] })
    const a = await import("../catalog.js")
    await a.snapshotAvatars()
    const r = await a.refreshHeygenCatalog()
    expect(r.avatars).toBe("locked-elsewhere")
    expect(r.privateAvatars).toBe("started") // memory-only: no lock

    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: undefined, NODE_ENV: "test" } }))
    const b = await import("../catalog.js")
    expect((await b.refreshHeygenCatalog()).avatars).toBe("unconfigured")
  })

  it("a slower / replayed write can never overwrite a NEWER snapshot (compare-and-set on filledAt), and the meta tracks the blob", async () => {
    const { writeSnapshot, readSnapshot, readSnapshotMeta } = await import("../catalog-store.js")
    expect(await writeSnapshot("avatars", { generation: "g-new", filledAt: 2_000, items: [{ id: "new" }] })).toBe(true)
    expect(await writeSnapshot("avatars", { generation: "g-old", filledAt: 1_000, items: [{ id: "old" }] })).toBe(false)
    expect((await readSnapshot<{ id: string }>("avatars"))?.generation).toBe("g-new")
    expect(await readSnapshotMeta("avatars")).toEqual({ generation: "g-new", filledAt: 2_000 })
    expect(await writeSnapshot("avatars", { generation: "g-newer", filledAt: 3_000, items: [] })).toBe(true)
    expect(await readSnapshotMeta("avatars")).toEqual({ generation: "g-newer", filledAt: 3_000 })
    // a blob written before the meta existed still guards by its own stamp
    fake.store.delete("heygen:catalog:v1:avatars:meta")
    expect(await writeSnapshot("avatars", { generation: "g-old", filledAt: 1_000, items: [] })).toBe(false)
  })

  it("refuses to publish an implausibly large snapshot (a runaway fill must not be pushed to every instance)", async () => {
    const { writeSnapshot, MAX_SNAPSHOT_BYTES } = await import("../catalog-store.js")
    const huge = { generation: "g", filledAt: 5_000, items: [{ blob: "x".repeat(MAX_SNAPSHOT_BYTES + 1) }] }
    expect(await writeSnapshot("avatars", huge)).toBe(false)
    expect(fake.store.has("heygen:catalog:v1:avatars")).toBe(false)
  })

  it("an unreadable / foreign blob in Redis is ignored (fill proceeds as if absent)", async () => {
    fake.store.set("heygen:catalog:v1:avatars", "{not json")
    routeLooks(fetchMock, { public: [page("look-1")] })
    const a = await import("../catalog.js")
    const all = await a.listAvatars()
    expect(all.map((x) => x.avatarId)).toEqual(["look-1"])
  })
})

describe("limit — chunked answers", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock("@/lib/config.js", () => ({ config: { HEYGEN_API_KEY: "test-heygen-key", NODE_ENV: "test" } }))
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("slices a warm list from the caller's offset by limit; total says how far the list goes; complete stays the server's truth", async () => {
    const looks = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, avatar_type: "photo_avatar", name: `l${i}`, gender: "Female", preview_image_url: "" }))
    routeLooks(fetchMock, { public: [{ code: 0, message: "ok", data: looks }] })
    const { snapshotAvatars, listAvatars } = await import("../catalog.js")
    await listAvatars()
    const first = await snapshotAvatars(undefined, 2)
    expect(first.items.map((x) => x.avatarId)).toEqual(["l0", "l1"])
    expect(first).toMatchObject({ offset: 0, total: 5, complete: true })
    const next = await snapshotAvatars({ offset: 2, generation: first.generation }, 2)
    expect(next.items.map((x) => x.avatarId)).toEqual(["l2", "l3"])
    expect(next).toMatchObject({ offset: 2, total: 5, complete: true })
    const last = await snapshotAvatars({ offset: 4, generation: first.generation }, 2)
    expect(last.items.map((x) => x.avatarId)).toEqual(["l4"])
    // no limit → the rest in one go
    expect((await snapshotAvatars({ offset: 1, generation: first.generation })).items).toHaveLength(4)
  })
})
