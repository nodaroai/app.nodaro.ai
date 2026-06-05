import { describe, it, expect } from "vitest"
import {
  CINEMATIC_RATE_USD_PER_SEC,
  CINEMATIC_MIN_DURATION_SEC,
  CINEMATIC_MAX_DURATION_SEC,
  CINEMATIC_DEFAULT_DURATION_SEC,
  CINEMATIC_RESERVE_IDS,
  clampCinematicDuration,
  cinematicUsdCost,
  cinematicCreditId,
  resolveCinematicCreditId,
  cinematicHoldCredits,
} from "../cinematic-avatar-pricing.js"

describe("clampCinematicDuration", () => {
  it("passes through legal values (rounded to whole seconds)", () => {
    expect(clampCinematicDuration(4)).toBe(4)
    expect(clampCinematicDuration(10)).toBe(10)
    expect(clampCinematicDuration(15)).toBe(15)
    expect(clampCinematicDuration(7.4)).toBe(7)
    expect(clampCinematicDuration(7.6)).toBe(8)
  })

  it("clamps below-min and above-max to the legal range", () => {
    expect(clampCinematicDuration(0)).toBe(CINEMATIC_MIN_DURATION_SEC)
    expect(clampCinematicDuration(3)).toBe(CINEMATIC_MIN_DURATION_SEC)
    expect(clampCinematicDuration(100)).toBe(CINEMATIC_MAX_DURATION_SEC)
  })

  it("falls back to the default for non-finite input", () => {
    expect(clampCinematicDuration(undefined)).toBe(CINEMATIC_DEFAULT_DURATION_SEC)
    expect(clampCinematicDuration(NaN)).toBe(CINEMATIC_DEFAULT_DURATION_SEC)
  })
})

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

describe("cinematicCreditId", () => {
  it("formats as cinematic-avatar:<res>:<dur>s", () => {
    expect(cinematicCreditId("720p", 10)).toBe("cinematic-avatar:720p:10s")
    expect(cinematicCreditId("1080p", 4)).toBe("cinematic-avatar:1080p:4s")
  })
})

describe("resolveCinematicCreditId", () => {
  it("reads resolution + duration off the raw body", () => {
    expect(resolveCinematicCreditId({ resolution: "1080p", duration: 12 })).toBe(
      "cinematic-avatar:1080p:12s",
    )
  })

  it("defaults resolution to 720p and duration to 10s when missing", () => {
    expect(resolveCinematicCreditId({})).toBe("cinematic-avatar:720p:10s")
    expect(resolveCinematicCreditId(undefined)).toBe("cinematic-avatar:720p:10s")
  })

  it("clamps an out-of-range duration to the legal range", () => {
    expect(resolveCinematicCreditId({ duration: 2 })).toBe("cinematic-avatar:720p:4s")
    expect(resolveCinematicCreditId({ duration: 99 })).toBe("cinematic-avatar:720p:15s")
  })

  it("falls back to 720p for an unknown resolution", () => {
    expect(resolveCinematicCreditId({ resolution: "4k", duration: 5 })).toBe(
      "cinematic-avatar:720p:5s",
    )
  })

  it("always resolves to a member of CINEMATIC_RESERVE_IDS (no 503 trap)", () => {
    for (const resolution of ["720p", "1080p", "bogus"]) {
      for (let d = -5; d <= 30; d++) {
        const id = resolveCinematicCreditId({ resolution, duration: d })
        expect(CINEMATIC_RESERVE_IDS).toContain(id)
      }
    }
  })

  it("reserves at the 15s MAX-duration ceiling when autoDuration is true", () => {
    // autoDuration → HeyGen picks the length (unknown at submit). Reserve at the
    // ceiling so the metered true-up can only refund, never undercharge.
    expect(resolveCinematicCreditId({ autoDuration: true })).toBe(
      `cinematic-avatar:720p:${CINEMATIC_MAX_DURATION_SEC}s`,
    )
    expect(
      resolveCinematicCreditId({ resolution: "1080p", autoDuration: true }),
    ).toBe(`cinematic-avatar:1080p:${CINEMATIC_MAX_DURATION_SEC}s`)
  })

  it("ignores a stale `duration` when autoDuration is true (still reserves at max)", () => {
    // The provider drops `duration` under autoDuration, so a left-over short
    // duration must NOT shrink the hold below the ceiling.
    expect(
      resolveCinematicCreditId({ duration: 4, autoDuration: true }),
    ).toBe(`cinematic-avatar:720p:${CINEMATIC_MAX_DURATION_SEC}s`)
  })

  it("uses the exact duration when autoDuration is false/absent", () => {
    expect(resolveCinematicCreditId({ duration: 6, autoDuration: false })).toBe(
      "cinematic-avatar:720p:6s",
    )
    expect(resolveCinematicCreditId({ duration: 6 })).toBe("cinematic-avatar:720p:6s")
  })
})

describe("CINEMATIC_RESERVE_IDS", () => {
  it("contains exactly 24 ids (2 resolutions × 12 durations 4..15)", () => {
    expect(CINEMATIC_RESERVE_IDS).toHaveLength(24)
    // Spot-check both ends of each resolution band.
    expect(CINEMATIC_RESERVE_IDS).toContain("cinematic-avatar:720p:4s")
    expect(CINEMATIC_RESERVE_IDS).toContain("cinematic-avatar:720p:15s")
    expect(CINEMATIC_RESERVE_IDS).toContain("cinematic-avatar:1080p:4s")
    expect(CINEMATIC_RESERVE_IDS).toContain("cinematic-avatar:1080p:15s")
  })

  it("has no duplicate ids", () => {
    expect(new Set(CINEMATIC_RESERVE_IDS).size).toBe(CINEMATIC_RESERVE_IDS.length)
  })
})

describe("cinematicHoldCredits", () => {
  it("uses [formula removed]", () => {
    // 720p 10s → $1.50 → ceil(75 * 1.5) = 113
    expect(cinematicHoldCredits("720p", 10)).toBe(113)
    // 1080p 15s → $3.30 → ceil(165 * 1.5) = 248
    expect(cinematicHoldCredits("1080p", 15)).toBe(248)
  })

  it("hold >= metered actual at the default configured pricing factor (refund-only guarantee)", () => {
    for (const resolution of Object.keys(CINEMATIC_RATE_USD_PER_SEC) as Array<
      keyof typeof CINEMATIC_RATE_USD_PER_SEC
    >) {
      for (let d = CINEMATIC_MIN_DURATION_SEC; d <= CINEMATIC_MAX_DURATION_SEC; d++) {
        const hold = cinematicHoldCredits(resolution, d)
        const providerUsd = cinematicUsdCost(resolution, d)
        const baseCredits = Math.ceil(providerUsd / 0.02)
        const actualAtDefaultMarkup = Math.ceil(baseCredits * 1.25)
        expect(
          hold,
          `hold ${hold} < actual ${actualAtDefaultMarkup} for ${resolution}:${d}s`,
        ).toBeGreaterThanOrEqual(actualAtDefaultMarkup)
      }
    }
  })
})
