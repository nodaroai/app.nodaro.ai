import { describe, it, expect } from "vitest"
import { CINEMATIC_MIN_DURATION_SEC, CINEMATIC_MAX_DURATION_SEC } from "@nodaro/shared"
import { CINEMATIC_RATE_USD_PER_SEC, cinematicUsdCost, cinematicHoldCredits } from "../cinematic-avatar-cost.js"

describe("cinematicUsdCost", () => {
  it("multiplies the per-second rate by ceil(duration)", () => {
    // 720p $0.15/s × 10s = $1.50
    expect(cinematicUsdCost("720p", 10)).toBe(1.5)
    // 1080p $0.22/s × 4s = $0.88
    expect(cinematicUsdCost("1080p", 4)).toBe(0.88)
  })

  it("ceils fractional durations", () => {
    // 720p $0.15/s × ceil(9.2)=10 = $1.50
    expect(cinematicUsdCost("720p", 9.2)).toBe(1.5)
  })

  it("returns 4-decimal precision", () => {
    expect(cinematicUsdCost("1080p", 7).toFixed(4)).toBe("1.5400")
  })
})

describe("cinematicHoldCredits — minimal-safe at-cost formula (NO *1.5)", () => {
  it("uses ceil(usd/0.02)", () => {
    // 720p 10s → $1.50 → ceil(75) = 75
    expect(cinematicHoldCredits("720p", 10)).toBe(75)
    // 1080p 15s → $3.30 → ceil(165) = 165
    expect(cinematicHoldCredits("1080p", 15)).toBe(165)
    // 720p 5s → $0.75 → ceil(37.5) = 38
    expect(cinematicHoldCredits("720p", 5)).toBe(38)
  })

  it("INVARIANT: reserved == metered-actual at every duration (exact-duration → refund-only)", () => {
    // Duration is a user parameter, so the reserve id is EXACT. The runtime
    // reserves ceil(hold * markup) and commits ceil(ceil(usd/0.02) * markup) —
    // both derive from the same ceil(usd/0.02) base, so they are EQUAL. The
    // commit can therefore only ever refund (when the provider returns shorter),
    // never undercharge.
    for (const markup of [0, 25, 30, 50]) {
      for (const resolution of Object.keys(CINEMATIC_RATE_USD_PER_SEC) as Array<
        keyof typeof CINEMATIC_RATE_USD_PER_SEC
      >) {
        for (let d = CINEMATIC_MIN_DURATION_SEC; d <= CINEMATIC_MAX_DURATION_SEC; d++) {
          const hold = cinematicHoldCredits(resolution, d)
          const reserved = markup > 0 ? Math.ceil(hold * (1 + markup / 100)) : hold
          const providerUsd = cinematicUsdCost(resolution, d)
          const baseCredits = Math.ceil(providerUsd / 0.02)
          const actual = markup > 0 ? Math.ceil(baseCredits * (1 + markup / 100)) : baseCredits
          expect(
            reserved,
            `reserved ${reserved} != actual ${actual} @${markup}% for ${resolution}:${d}s`,
          ).toBe(actual)
        }
      }
    }
  })
})
