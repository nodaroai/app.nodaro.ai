import { describe, expect, it, vi } from "vitest"
import { createTtlCache } from "../ttl-cache.js"

describe("createTtlCache", () => {
  it("serves a value until it is older than the TTL, then loads again", async () => {
    let now = 1_000
    const cache = createTtlCache<string>({ ttlMs: 100, maxEntries: 10, now: () => now })
    const load = vi.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b")
    expect(await cache.get("k", load)).toEqual({ value: "a", fetchedAt: 1_000 })
    now = 1_099
    expect((await cache.get("k", load)).value).toBe("a")
    now = 1_100
    expect(await cache.get("k", load)).toEqual({ value: "b", fetchedAt: 1_100 })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("fresh skips the stored value", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1_000, maxEntries: 10, now: () => 0 })
    const load = vi.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b")
    await cache.get("k", load)
    expect((await cache.get("k", load, { fresh: true })).value).toBe("b")
  })

  it("fresh within minFreshMs of the last answer gets that answer", async () => {
    let now = 0
    const cache = createTtlCache<string>({ ttlMs: 600_000, maxEntries: 10, minFreshMs: 60_000, now: () => now })
    const load = vi.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b")
    await cache.get("k", load)
    now = 59_000
    expect((await cache.get("k", load, { fresh: true })).value).toBe("a")
    now = 60_000
    expect((await cache.get("k", load, { fresh: true })).value).toBe("b")
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("two gets at once share one load", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1_000, maxEntries: 10, now: () => 0 })
    const load = vi.fn(async () => "a")
    await Promise.all([cache.get("k", load), cache.get("k", load)])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("a failed load is not kept", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1_000, maxEntries: 10, now: () => 0 })
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("a")
    await expect(cache.get("k", load)).rejects.toThrow("down")
    expect((await cache.get("k", load)).value).toBe("a")
  })

  it("holds at most maxEntries, dropping the oldest", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1_000, maxEntries: 2, now: () => 0 })
    await cache.get("a", async () => "a1")
    await cache.get("b", async () => "b1")
    await cache.get("c", async () => "c1")
    const reload = vi.fn(async () => "a2")
    expect((await cache.get("a", reload)).value).toBe("a2")
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
