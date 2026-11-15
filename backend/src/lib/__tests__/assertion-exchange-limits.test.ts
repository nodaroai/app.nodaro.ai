import { describe, it, expect, vi, beforeEach } from "vitest"

/** The assertion exchange's two limiters (lib/assertion-exchange-limits.ts): fixed windows, separate keys, fail closed. */

const store = vi.hoisted(() => new Map<string, { n: number; ttl: number }>())
vi.mock("../queue.js", () => ({
  redis: {
    set: vi.fn(async (key: string, _v: string, _ex: string, ttl: number, nx?: string) => {
      if (nx === "NX" && store.has(key)) return null
      store.set(key, { n: 1, ttl })
      return "OK"
    }),
    incr: vi.fn(async (key: string) => {
      const e = store.get(key) ?? { n: 0, ttl: -1 }
      e.n += 1
      store.set(key, e)
      return e.n
    }),
    ttl: vi.fn(async (key: string) => store.get(key)?.ttl ?? -2),
    expire: vi.fn(async (key: string, ttl: number) => {
      const e = store.get(key)
      if (e) e.ttl = ttl
      return 1
    }),
  },
}))

import { redis } from "../queue.js"
import { EXCHANGES_PER_CLIENT, EXCHANGES_PER_NETWORK, EXCHANGE_WINDOW_SEC, takeClientAllowance, takeNetworkAllowance } from "../assertion-exchange-limits.js"

beforeEach(() => store.clear())

describe("assertion exchange limits", () => {
  it("allows up to the limit per network, then refuses with the window's remaining seconds", async () => {
    for (let i = 0; i < EXCHANGES_PER_NETWORK; i++) expect((await takeNetworkAllowance("net-a")).ok).toBe(true)
    expect(await takeNetworkAllowance("net-a")).toEqual({ ok: false, retryAfterSec: EXCHANGE_WINDOW_SEC })
    // Another network and the client bucket are separate counters.
    expect((await takeNetworkAllowance("net-b")).ok).toBe(true)
    expect((await takeClientAllowance("app_x")).ok).toBe(true)
    expect([...store.keys()].sort()).toEqual(["rl:oauth-exchange:client:app_x", "rl:oauth-exchange:net:net-a", "rl:oauth-exchange:net:net-b"])
  })

  it("allows up to the limit per client", async () => {
    for (let i = 0; i < EXCHANGES_PER_CLIENT; i++) expect((await takeClientAllowance("app_x")).ok).toBe(true)
    expect((await takeClientAllowance("app_x")).ok).toBe(false)
  })

  it("heals a counter that lost its TTL", async () => {
    store.set("rl:oauth-exchange:net:net-c", { n: 3, ttl: -1 })
    await takeNetworkAllowance("net-c")
    expect(store.get("rl:oauth-exchange:net:net-c")?.ttl).toBe(EXCHANGE_WINDOW_SEC)
  })

  it("a Redis error throws (the exchange fails closed)", async () => {
    vi.mocked(redis.set).mockRejectedValueOnce(new Error("redis down"))
    await expect(takeNetworkAllowance("net-d")).rejects.toThrow("redis down")
  })
})
