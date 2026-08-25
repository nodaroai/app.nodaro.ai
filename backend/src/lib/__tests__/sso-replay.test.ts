import { describe, it, expect, vi, beforeEach } from "vitest"

const store = new Map<string, string>()
vi.mock("../queue.js", () => ({
  redis: {
    // Mimic ioredis SET key val EX ttl NX: returns "OK" only when key absent.
    set: vi.fn(async (key: string, val: string, _ex: string, _ttl: number, nx?: string) => {
      if (nx === "NX" && store.has(key)) return null
      store.set(key, val)
      return "OK"
    }),
  },
}))

import { claimAssertionJti } from "../sso-replay.js"

beforeEach(() => store.clear())

describe("claimAssertionJti", () => {
  it("claims a fresh jti (true) and rejects the replay (false)", async () => {
    expect(await claimAssertionJti("lc", "jti-1", 300)).toBe(true)
    expect(await claimAssertionJti("lc", "jti-1", 300)).toBe(false)
  })

  it("namespaces by provider — same jti under a different provider is fresh", async () => {
    expect(await claimAssertionJti("lc", "shared", 300)).toBe(true)
    expect(await claimAssertionJti("other", "shared", 300)).toBe(true)
  })

  it("floors the TTL at 1 second", async () => {
    const { redis } = await import("../queue.js")
    const setMock = redis.set as unknown as { mock: { calls: unknown[][] } }
    await claimAssertionJti("lc", "j", 0)
    // This vitest config does not reset mock history per test, so read THIS
    // call — the last one — not calls[0] (which belongs to an earlier test).
    const lastCall = setMock.mock.calls[setMock.mock.calls.length - 1]
    expect(lastCall[3]).toBe(1) // SET key val EX <ttl> NX → ttl floored to 1
  })
})
