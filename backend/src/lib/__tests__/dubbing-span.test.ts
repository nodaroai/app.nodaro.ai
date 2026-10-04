import { describe, expect, it, vi } from "vitest"

vi.mock("../credit-base-cost.js", () => ({
  baseCreditCostFor: vi.fn(async (id: string) => (id === "elevenlabs-dubbing" ? 40 : 999)),
}))

import { dubbingBaseCredits, dubbingMinutes, dubbingReservePlan, effectiveDubbedSeconds } from "../dubbing-span.js"

// The worked examples in docs/nodes/ai-audio/dubbing.md, at the listed
// 40 credits per minute — keep the two equal.
describe("dubbing span pricing — the docs' worked examples", () => {
  it.each([
    [60, 40],
    [120, 80],
    [10 * 60, 400],
  ])("%i s → %i credits", async (seconds, credits) => {
    expect(await dubbingBaseCredits("fr", seconds)).toBe(credits)
  })

  it("a 45-minute video with a 0:00–10:00 window is priced by the window (400)", async () => {
    const span = effectiveDubbedSeconds(45 * 60, 0, 10 * 60)
    expect(span).toBe(600)
    expect(await dubbingBaseCredits("fr", span!)).toBe(400)
  })

  it("an unreadable source holds the 30-minute price (1,200)", async () => {
    const plan = dubbingReservePlan(undefined)
    expect(plan).toEqual({ seconds: 1800, ceiling: true })
    expect(await dubbingBaseCredits("fr", plan.seconds)).toBe(1200)
  })
})

describe("dubbing span rules", () => {
  it("rounds to whole started minutes, at least one", () => {
    expect([1, 59, 60, 61, 1800].map(dubbingMinutes)).toEqual([1, 1, 1, 2, 30])
  })

  it("the window never exceeds a known source, and stands alone when the source is unknown", () => {
    expect(effectiveDubbedSeconds(30, 0, 90)).toBe(30)
    expect(effectiveDubbedSeconds(undefined, 10, 70)).toBe(60)
    expect(effectiveDubbedSeconds(200)).toBe(200)
    expect(effectiveDubbedSeconds(undefined)).toBeUndefined()
  })

  it("a known span is reserved as is, not as a ceiling", () => {
    expect(dubbingReservePlan(95)).toEqual({ seconds: 95, ceiling: false })
  })
})
