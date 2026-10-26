import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// No model_pricing rows reach this module: the -ref rate is STATIC_CREDIT_COSTS only.
vi.mock("../../app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 10 }) }))
vi.mock("../../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config.js")>()),
  hasCredits: () => true,
}))

import { buildToolkit } from "../toolkit.js"
import { seedance2RefVideoChargedHoldQuote } from "../../../ee/billing/seedance2-ref-video-quote.js"

/**
 * `tk.http.quoteSeedanceRefVideo` — the CHARGED hold and expected settlement
 * of a Seedance reference-video run from clip lengths a plugin has measured
 * (Cast Swap cuts its clip after quoting, so no URL exists to quote). It is
 * the reservation's own quote, not a copy: the route test
 * (`routes/__tests__/seedance2-ref-video-billing.test.ts`) pins
 * `seedance2RefVideoChargedHoldQuote` to what /v1/text-to-video reserves.
 * 720p `-ref` is 760 / 8 = 95 base a second; markup 10% here.
 */
describe("tk.http.quoteSeedanceRefVideo", () => {
  const tk = buildToolkit()
  const quote = tk.http.quoteSeedanceRefVideo!

  it("is advertised and present", () => {
    expect(tk.capabilities?.seedanceRefVideoQuote).toBe(true)
    expect(typeof quote).toBe("function")
  })

  it("the evidence case — 4.1 s clip, 720p, Auto: holds 1056 (4.1 + 6 s), expected 857 (4.1 + 4.1 s)", async () => {
    const args = { provider: "seedance-2-5", resolution: "720p", duration: -1, durationsSec: [4.1] }
    await expect(quote(args)).resolves.toEqual({ hold: 1056, expected: 857 })
    await expect(quote(args)).resolves.toEqual(await seedance2RefVideoChargedHoldQuote(args))
  })

  it("several clips: the first decides the Auto output, all count as input", async () => {
    // hold ceil(95 × (16.1 + 6)) = 2100 → 2310; expected ceil(95 × (16.1 + 4.1)) — 20.2 s in floating
    // point is a hair over, so 1920 → 2112 (the run's settlement does the same arithmetic).
    await expect(quote({ provider: "seedance-2-5", resolution: "720p", duration: -1, durationsSec: [4.1, 12] }))
      .resolves.toEqual({ hold: 2310, expected: 2112 })
  })

  it("a fixed duration: held and expected at the requested seconds", async () => {
    // ceil(95 × (4.1 + 8)) = 1150 → 1265.
    await expect(quote({ provider: "seedance-2-5", resolution: "720p", duration: 8, durationsSec: [4.1] }))
      .resolves.toEqual({ hold: 1265, expected: 1265 })
  })

  it("an unmeasurable clip: the worst case, and no expected figure", async () => {
    // 30 s in (the per-clip cap) + 30 s out: ceil(95 × 60) = 5700 → 6270.
    await expect(quote({ provider: "seedance-2-5", resolution: "720p", duration: -1, durationsSec: [null] }))
      .resolves.toEqual({ hold: 6270, expected: null })
    await expect(quote({ provider: "seedance-2-5", resolution: "720p", duration: -1, durationsSec: [Number.NaN] }))
      .resolves.toEqual({ hold: 6270, expected: null })
  })

  it("a draft is quoted at 480p, as the run sends it", async () => {
    // 480p -ref 340 / 8 = 42.5: hold ceil(42.5 × 10.1) = 430 → 473.
    const draft = await quote({ provider: "seedance-2-5", resolution: "1080p", draft: true, duration: -1, durationsSec: [4.1] })
    expect(draft.hold).toBe(473)
  })

  it("refuses a model whose price does not follow its reference clips, and an empty clip list", async () => {
    await expect(quote({ provider: "veo3.1", duration: 8, durationsSec: [4.1] })).rejects.toThrow(/not a model whose price follows/)
    await expect(quote({ provider: "seedance-2-5", duration: -1, durationsSec: [] })).rejects.toThrow(/at least one reference clip/)
  })
})
