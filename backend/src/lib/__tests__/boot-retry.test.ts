/**
 * Boot-time tasks that talk to Supabase through the container's OWN Caddy
 * (community stack: SUPABASE_URL = localhost:3000/supabase) fire before Caddy
 * is up — start.sh starts it only after the API answers /health. Their first
 * network call fails deterministically ("fetch failed", AuthRetryableFetchError).
 * A fire-and-forget task with no retry therefore never runs on that boot; the
 * tutorial seed lost this race on the very first boot that had templates
 * (2026-08-16, live swap: categories 3, flows 0).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { isTransportError, withTransportRetry } from "../boot-retry.js"

const sleeps: number[] = []
const sleep = async (ms: number) => {
  sleeps.push(ms)
}

beforeEach(() => {
  sleeps.length = 0
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

function transport(name = "AuthRetryableFetchError", message = "fetch failed"): Error {
  const err = new Error(message)
  err.name = name
  return err
}

describe("isTransportError", () => {
  it("recognises the shapes a dead proxy produces", () => {
    expect(isTransportError(transport())).toBe(true)
    expect(isTransportError(new TypeError("fetch failed"))).toBe(true)
    expect(isTransportError(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), { code: "ECONNREFUSED" }))).toBe(true)
    expect(isTransportError(new Error("boom", { cause: Object.assign(new Error("x"), { code: "ECONNRESET" }) }))).toBe(true)
    // supabase-js PostgREST-style error object (no Error prototype)
    expect(isTransportError({ message: "TypeError: fetch failed", details: "", hint: "", code: "" })).toBe(true)
  })

  it("does not mistake application errors for transport failures", () => {
    expect(isTransportError(new Error("duplicate key value violates unique constraint"))).toBe(false)
    expect(isTransportError({ message: "JWT expired", code: "PGRST301" })).toBe(false)
    expect(isTransportError(null)).toBe(false)
    expect(isTransportError("nope")).toBe(false)
  })
})

describe("withTransportRetry", () => {
  it("retries transport failures on the schedule and returns the eventual result", async () => {
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(transport())
      .mockRejectedValueOnce(transport("TypeError", "fetch failed"))
      .mockResolvedValueOnce("seeded")
    const result = await withTransportRetry("t", task, { delaysMs: [10, 20, 40], sleep })
    expect(result).toBe("seeded")
    expect(task).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([10, 20])
  })

  it("rethrows a non-transport error at once — no retry, no sleep", async () => {
    const task = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("duplicate key"))
    await expect(withTransportRetry("t", task, { delaysMs: [10, 20], sleep })).rejects.toThrow("duplicate key")
    expect(task).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
  })

  it("gives up after the schedule and rethrows the last transport error", async () => {
    const task = vi.fn<() => Promise<void>>().mockRejectedValue(transport())
    await expect(withTransportRetry("t", task, { delaysMs: [10, 20], sleep })).rejects.toThrow("fetch failed")
    expect(task).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([10, 20])
  })

  it("says what it is waiting for on each retry", async () => {
    const task = vi.fn<() => Promise<number>>().mockRejectedValueOnce(transport()).mockResolvedValueOnce(1)
    await withTransportRetry("tutorial-seed", task, { delaysMs: [10], sleep })
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/\[tutorial-seed\].*not reachable yet.*retry 1\/1 in 10ms/))
  })
})
