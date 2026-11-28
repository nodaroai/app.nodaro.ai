// @test-units-by-name it names no node unit
/**
 * The server's retry of deferred repayments (video-route-settlement.ts
 * `retryDeferredRepayments`): asked only where unpaid charges are enforced,
 * reads the database's answer, and never throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  enforce: false,
  settingsFail: false,
  calls: [] as string[],
  answer: { data: null as unknown, error: null as { message: string } | null },
  throws: false,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    rpc: async (name: string) => {
      h.calls.push(name)
      if (h.throws) throw new Error("network down")
      return h.answer
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: async () => ({ video_route_policy: { models: {}, enforceUnpaidCharges: h.enforce } }),
  settingsReadFailed: () => h.settingsFail,
}))

const { retryDeferredRepayments } = await import("../video-route-settlement.js")

beforeEach(() => {
  h.enforce = false
  h.settingsFail = false
  h.calls = []
  h.answer = { data: null, error: null }
  h.throws = false
  vi.restoreAllMocks()
})

describe("retryDeferredRepayments", () => {
  it("asks nothing of the database where unpaid charges are not enforced, or the settings could not be read", async () => {
    await retryDeferredRepayments()
    h.enforce = true
    h.settingsFail = true
    await retryDeferredRepayments()
    expect(h.calls).toEqual([])
  })

  it("calls the retry once and reports what it applied and what is left for an admin", async () => {
    h.enforce = true
    h.answer = { data: { applied: 2, credits: 130, dropped: 0, failed: 1, stuck: 1 }, error: null }
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await retryDeferredRepayments()
    expect(h.calls).toEqual(["retry_deferred_video_repayments"])
    expect(info.mock.calls[0]?.[0]).toMatch(/2 deferred repayment\(s\) applied \(130 collected\)/)
    expect(warn.mock.calls[0]?.[0]).toMatch(/1 could not be applied in this pass, 1 are left for an admin/)
  })

  it("stays quiet when nothing was noted", async () => {
    h.enforce = true
    h.answer = { data: { applied: 0, credits: 0, dropped: 0, failed: 0, stuck: 0 }, error: null }
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await retryDeferredRepayments()
    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it("never throws: a database error, an answer of another shape, a failed call", async () => {
    h.enforce = true
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    h.answer = { data: null, error: { message: "permission denied" } }
    await expect(retryDeferredRepayments()).resolves.toBeUndefined()
    h.answer = { data: 3, error: null }
    await expect(retryDeferredRepayments()).resolves.toBeUndefined()
    h.throws = true
    await expect(retryDeferredRepayments()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(2)
  })
})
