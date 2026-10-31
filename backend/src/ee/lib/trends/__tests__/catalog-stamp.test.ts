/**
 * catalog-stamp.ts: the stamp in `app_settings` and the guest answers kept
 * under it. The route-level behaviour (what a guest is served) is pinned in
 * ee/routes/__tests__/trends.test.ts; here, the stamp's own contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { argOf, has, type QueryResult, type RecordedQuery } from "../../../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("../../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})

const purges = vi.hoisted(() => ({ requested: [] as number[], configured: false }))
vi.mock("../edge-purge.js", () => ({
  requestTrendCatalogEdgePurge: (settleMs: number) => purges.requested.push(settleMs),
  trendCatalogEdgeConfigured: () => purges.configured,
}))

import {
  STAMP_MEMO_MS,
  TRENDS_CATALOG_STAMP_KEY,
  _resetTrendCatalogCacheForTests,
  keepGuestAnswer,
  keptGuestAnswer,
  trendCatalogChanged,
  trendCatalogGeneration,
  trendCatalogStamp,
  watchTrendCatalogForEdge,
  EDGE_WATCH_MS,
  KEEP_MS,
} from "../catalog-stamp.js"

beforeEach(() => {
  db.log.length = 0
  db.respond = () => ({ data: null, error: null })
  purges.requested = []
  purges.configured = false
  _resetTrendCatalogCacheForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const stampReads = () => db.log.filter((q) => q.table === "app_settings" && q.ops.some((op) => op.m === "select"))

describe("the stamp", () => {
  it("is the app_settings row's value, read once per memo window", async () => {
    db.respond = () => ({ data: { value: "s1" }, error: null })
    expect(await trendCatalogStamp()).toBe("s1")
    expect(await trendCatalogStamp()).toBe("s1")
    expect(stampReads()).toHaveLength(1)
    expect(has(stampReads()[0]!, "eq", "key", TRENDS_CATALOG_STAMP_KEY)).toBe(true)

    db.respond = () => ({ data: { value: "s2" }, error: null })
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + STAMP_MEMO_MS + 1)
    expect(await trendCatalogStamp()).toBe("s2")
    expect(stampReads()).toHaveLength(2)
  })

  it("is 'none' before any change wrote one, and null (nothing kept) when it cannot be read", async () => {
    expect(await trendCatalogStamp()).toBe("none")
    _resetTrendCatalogCacheForTests()
    db.respond = () => ({ data: null, error: { message: "down" } })
    expect(await trendCatalogStamp()).toBeNull()
    _resetTrendCatalogCacheForTests()
    db.respond = () => ({ data: { value: 42 }, error: null })
    expect(await trendCatalogStamp()).toBeNull()
  })

  it("an unreadable stamp is not remembered: the next read tries again", async () => {
    db.respond = () => ({ data: null, error: { message: "down" } })
    expect(await trendCatalogStamp()).toBeNull()
    db.respond = () => ({ data: { value: "s1" }, error: null })
    expect(await trendCatalogStamp()).toBe("s1")
  })
})

describe("kept answers", () => {
  it("are found under the stamp and key they were kept under, and nowhere else", () => {
    keepGuestAnswer("s1", "k", { data: [1] }, trendCatalogGeneration())
    expect(keptGuestAnswer("s1", "k")).toEqual({ data: [1] })
    expect(keptGuestAnswer("s2", "k")).toBeUndefined()
    expect(keptGuestAnswer("s1", "other")).toBeUndefined()
  })

  it("expire after ten minutes even when the stamp never moves: the bound on a stamp write that failed", () => {
    const start = Date.now()
    keepGuestAnswer("s1", "k", { data: [] }, trendCatalogGeneration())
    const clock = vi.spyOn(Date, "now").mockReturnValue(start + 9 * 60 * 1000)
    expect(keptGuestAnswer("s1", "k")).toEqual({ data: [] })
    clock.mockReturnValue(start + 10 * 60 * 1000 + 1)
    expect(keptGuestAnswer("s1", "k")).toBeUndefined()
    expect(KEEP_MS).toBe(10 * 60 * 1000)
  })

  it("are at most 500: the least recently served goes first", () => {
    for (let i = 0; i < 500; i++) keepGuestAnswer("s1", `k${i}`, i, trendCatalogGeneration())
    expect(keptGuestAnswer("s1", "k0")).toBe(0) // served: now the most recent
    keepGuestAnswer("s1", "k500", 500, trendCatalogGeneration())
    expect(keptGuestAnswer("s1", "k0")).toBe(0)
    expect(keptGuestAnswer("s1", "k1")).toBeUndefined()
    expect(keptGuestAnswer("s1", "k500")).toBe(500)
  })
})

describe("trendCatalogChanged", () => {
  it("writes a fresh stamp each time, drops this process's kept answers and memo, and asks the edge to drop its copies", async () => {
    db.respond = () => ({ data: { value: "s1" }, error: null })
    expect(await trendCatalogStamp()).toBe("s1")
    keepGuestAnswer("s1", "k", { data: [] }, trendCatalogGeneration())

    expect(await trendCatalogChanged()).toBe(true)
    expect(await trendCatalogChanged()).toBe(true)
    const writes = db.log.filter((q) => q.table === "app_settings" && q.ops.some((op) => op.m === "upsert"))
    expect(writes).toHaveLength(2)
    const [row1, opts] = argOf(writes[0]!, "upsert") as [{ key: string; value: string }, { onConflict: string }]
    const [row2] = argOf(writes[1]!, "upsert") as [{ key: string; value: string }]
    expect(row1.key).toBe(TRENDS_CATALOG_STAMP_KEY)
    expect(opts).toEqual({ onConflict: "key" })
    expect(row1.value).toMatch(/^[0-9a-f-]{36}$/)
    expect(row2.value).not.toBe(row1.value)

    expect(keptGuestAnswer("s1", "k")).toBeUndefined()
    await trendCatalogStamp()
    expect(stampReads()).toHaveLength(2) // the memo was dropped: read again
    // The second purge waits for every process to read the new stamp, plus a margin.
    expect(purges.requested).toEqual([STAMP_MEMO_MS + 3_000, STAMP_MEMO_MS + 3_000])
  })

  it("never throws: a failed write is logged, and this process still drops what it kept", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    db.respond = (q) => (q.ops.some((op) => op.m === "upsert") ? { data: null, error: { message: "down" } } : { data: null, error: null })
    keepGuestAnswer("none", "k", { data: [] }, trendCatalogGeneration())
    await expect(trendCatalogChanged()).resolves.toBe(false)
    expect(logged).toHaveBeenCalled()
    expect(keptGuestAnswer("none", "k")).toBeUndefined()
    expect(purges.requested).toHaveLength(1)
  })

  it("an answer whose build straddled a change in this process is never kept (it may hold the old catalog)", async () => {
    const builtAt = trendCatalogGeneration()
    await trendCatalogChanged()
    keepGuestAnswer("none", "k", { data: ["old"] }, builtAt)
    expect(keptGuestAnswer("none", "k")).toBeUndefined()
  })

  it("a stamp read that a change overtook is used once, never remembered", async () => {
    // The read answers only after the whole change (both its forgets and its write) is done.
    let answer: (v: QueryResult) => void = () => {}
    const slow = new Promise<QueryResult>((resolve) => {
      answer = resolve
    })
    db.respond = (q) => (q.ops.some((op) => op.m === "select") ? (slow as unknown as QueryResult) : { data: null, error: null })
    const reading = trendCatalogStamp()
    await trendCatalogChanged()
    answer({ data: { value: "s0" }, error: null })
    expect(await reading).toBe("s0")
    db.respond = () => ({ data: { value: "s1" }, error: null })
    const before = stampReads().length
    await trendCatalogStamp()
    expect(stampReads()).toHaveLength(before + 1)
  })
})

describe("watchTrendCatalogForEdge: an API process drops the edge's copies when it sees the stamp move", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    _resetTrendCatalogCacheForTests()
    vi.useRealTimers()
  })

  it("purges once per move it sees, wherever the change was made; the first look only learns the stamp", async () => {
    purges.configured = true
    db.respond = () => ({ data: { value: "s1" }, error: null })
    watchTrendCatalogForEdge()
    watchTrendCatalogForEdge() // started once
    await vi.advanceTimersByTimeAsync(EDGE_WATCH_MS)
    expect(stampReads()).toHaveLength(1)
    expect(purges.requested).toEqual([])
    await vi.advanceTimersByTimeAsync(EDGE_WATCH_MS)
    expect(purges.requested).toEqual([])

    db.respond = () => ({ data: { value: "s2" }, error: null })
    await vi.advanceTimersByTimeAsync(EDGE_WATCH_MS)
    expect(purges.requested).toEqual([STAMP_MEMO_MS + 3_000])
    await vi.advanceTimersByTimeAsync(EDGE_WATCH_MS)
    expect(purges.requested).toHaveLength(1)
  })

  it("reads nothing where the edge cannot be purged, and an unreadable stamp purges nothing", async () => {
    watchTrendCatalogForEdge()
    await vi.advanceTimersByTimeAsync(EDGE_WATCH_MS * 3)
    expect(stampReads()).toHaveLength(0)

    purges.configured = true
    db.respond = () => ({ data: { value: "s1" }, error: null })
    await vi.advanceTimersByTimeAsync(EDGE_WATCH_MS)
    db.respond = () => ({ data: null, error: { message: "down" } })
    await vi.advanceTimersByTimeAsync(EDGE_WATCH_MS)
    expect(purges.requested).toEqual([])
  })
})
