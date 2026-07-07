import { describe, it, expect } from "vitest"
import {
  AI_AVATAR_DURATION_BUCKETS,
  AI_AVATAR_MAX_AUDIO_SEC,
  resolveAiAvatarCreditId,
} from "@nodaro/shared"
import {
  AI_AVATAR_RATE_USD_PER_SEC,
  aiAvatarUsdCost,
  aiAvatarHoldCredits,
  aiAvatarReserveCeilingUsd,
} from "../ai-avatar-cost.js"

// ── Runtime markup model (mirrors the backend pipeline exactly) ──
// At RESERVE: getModelCreditCostFromDB applies the admin markup to the STORED
// hold value: reserved = ceil(hold * (1 + markup/100)).
// At COMMIT: computeActualCredits(providerCostUsd) = ceil(ceil(usd/0.02) * (1+markup/100)).
// The hold value stored in STATIC_CREDIT_COSTS / model_pricing is aiAvatarHoldCredits().
const CREDIT_BASE_USD = 0.02
function reservedFromHold(hold: number, markupPct: number): number {
  return markupPct > 0 ? Math.ceil(hold * (1 + markupPct / 100)) : hold
}
function meteredActual(usd: number, markupPct: number): number {
  const base = Math.ceil(usd / CREDIT_BASE_USD)
  return markupPct > 0 ? Math.ceil(base * (1 + markupPct / 100)) : base
}

describe("aiAvatarUsdCost", () => {
  it("ceils fractional duration then multiplies by rate", () => {
    // 3.05633s → ceil = 4s; rate 0.06/s → 0.24
    expect(aiAvatarUsdCost("avatar-iv", "720p", 3.05633)).toBe(0.24)
  })

  it("handles integer durations without double-ceiling", () => {
    expect(aiAvatarUsdCost("avatar-iv", "720p", 4)).toBe(0.24)
    expect(aiAvatarUsdCost("avatar-iv", "1080p", 10)).toBe(0.8)
  })

  it("returns 4-decimal precision", () => {
    const result = aiAvatarUsdCost("avatar-iv", "1080p", 3)
    expect(result).toBe(0.24)
    expect(result.toFixed(4)).toBe("0.2400")
  })

  it("uses avatar-v rates for premium engine", () => {
    expect(aiAvatarUsdCost("avatar-v", "720p", 5)).toBe(0.4)
    expect(aiAvatarUsdCost("avatar-v", "1080p", 3)).toBe(0.3)
  })

  it("handles 4k resolution", () => {
    expect(aiAvatarUsdCost("avatar-iv", "4k", 2)).toBe(0.32)
  })
})

describe("aiAvatarHoldCredits — minimal-safe at-cost formula (NO *1.5)", () => {
  it("is ceil(usd/0.02) for avatar-iv:720p:30s", () => {
    // $0.06 * 30 = $1.80 → 1.80/0.02 = 90
    expect(aiAvatarHoldCredits("avatar-iv", "720p", 30)).toBe(90)
  })

  it("is ceil(usd/0.02) for avatar-iv:720p:15s (user scenario bucket)", () => {
    // $0.06 * 15 = $0.90 → 0.90/0.02 = 45
    expect(aiAvatarHoldCredits("avatar-iv", "720p", 15)).toBe(45)
  })

  it("spot-checks across resolutions and engines", () => {
    expect(aiAvatarHoldCredits("avatar-iv", "1080p", 30)).toBe(120) // $2.40
    expect(aiAvatarHoldCredits("avatar-iv", "4k", 60)).toBe(480) // $9.60
    expect(aiAvatarHoldCredits("avatar-v", "720p", 120)).toBe(480) // $9.60
    expect(aiAvatarHoldCredits("avatar-v", "1080p", 5)).toBe(25) // $0.50
    expect(aiAvatarHoldCredits("avatar-v", "4k", 900)).toBe(9000) // $180.00
  })

  it("INVARIANT: at each bucket CEILING, reserved == metered-actual (refund-only, no over-reserve)", () => {
    // This is the core safety check. The runtime reserves
    //   reserved = ceil(hold * markup)   [getModelCreditCostFromDB on the stored hold]
    // and commits
    //   actual   = ceil(ceil(usd/0.02) * markup)   [computeActualCredits]
    // At the bucket CEILING the provider's true duration equals the bucket, so
    // usd is identical → reserved and actual share the exact same base → EQUAL.
    // (For any shorter clip, actual is strictly less, so commit refunds.)
    for (const markup of [0, 25, 30, 50]) {
      for (const engine of Object.keys(AI_AVATAR_RATE_USD_PER_SEC) as Array<keyof typeof AI_AVATAR_RATE_USD_PER_SEC>) {
        for (const resolution of Object.keys(AI_AVATAR_RATE_USD_PER_SEC[engine]) as Array<keyof (typeof AI_AVATAR_RATE_USD_PER_SEC)[typeof engine]>) {
          for (const bucket of AI_AVATAR_DURATION_BUCKETS) {
            const hold = aiAvatarHoldCredits(engine, resolution, bucket)
            const reserved = reservedFromHold(hold, markup)
            const usdAtCeiling = aiAvatarUsdCost(engine, resolution, bucket)
            const actual = meteredActual(usdAtCeiling, markup)
            expect(
              reserved,
              `reserved ${reserved} != actual ${actual} @${markup}% for ${engine}:${resolution}:${bucket}s`,
            ).toBe(actual)
            // And it must never undercharge for any shorter true duration.
            const usdShorter = aiAvatarUsdCost(engine, resolution, Math.max(1, bucket - 1))
            expect(reserved).toBeGreaterThanOrEqual(meteredActual(usdShorter, markup))
          }
        }
      }
    }
  })

  it("INVARIANT: reserved >= metered-actual at the 600s audio ceiling (worker trims actual to <=600)", () => {
    // The worker trims incoming audio to AI_AVATAR_MAX_AUDIO_SEC, so the metered
    // ACTUAL provider cost can never exceed the 600s bucket cost. At the ceiling
    // the bases are identical (reserved == actual); for any shorter trimmed clip
    // the actual is strictly less → commit refunds. Verify across markups.
    for (const markup of [0, 25, 30, 50]) {
      for (const engine of Object.keys(AI_AVATAR_RATE_USD_PER_SEC) as Array<keyof typeof AI_AVATAR_RATE_USD_PER_SEC>) {
        for (const resolution of Object.keys(AI_AVATAR_RATE_USD_PER_SEC[engine]) as Array<
          keyof (typeof AI_AVATAR_RATE_USD_PER_SEC)[typeof engine]
        >) {
          const reserveId = resolveAiAvatarCreditId({
            speechMode: "audio",
            engine,
            resolution,
            __probedDurationSec: 5000, // far past the cap
          })
          expect(reserveId).toBe(`heygen-${engine}:${resolution}:600s`)
          const hold = aiAvatarHoldCredits(engine, resolution, AI_AVATAR_MAX_AUDIO_SEC)
          const reserved = reservedFromHold(hold, markup)
          // Actual at the trimmed ceiling (worker trims to exactly 600s worst case).
          const usdAtCap = aiAvatarUsdCost(engine, resolution, AI_AVATAR_MAX_AUDIO_SEC)
          const actualAtCap = meteredActual(usdAtCap, markup)
          expect(reserved).toBe(actualAtCap)
          expect(reserved).toBeGreaterThanOrEqual(actualAtCap)
        }
      }
    }
  })
})

describe("REGRESSION: user-reported audio over-reservation", () => {
  it("a ~15s audio ai-avatar (probed) reserves ~50-70 credits, NOT thousands", () => {
    // Before the fix: audio mode → 900s bucket × *1.5 hold → stored 4050,
    // reserved at 25% = ceil(4050*1.25) = 5063 credits for a $0.75 clip.
    // After: probe 15s → bucket 15s → hold ceil(0.06*15/0.02)=45 → reserved at
    // 25% = ceil(45*1.25) = 57 credits (the actual clip cost ~$0.90 ≈ 57cr).
    const id = resolveAiAvatarCreditId({
      speechMode: "audio",
      engine: "avatar-iv",
      resolution: "720p",
      __probedDurationSec: 15,
    })
    expect(id).toBe("heygen-avatar-iv:720p:15s")
    const hold = aiAvatarHoldCredits("avatar-iv", "720p", 15)
    const reserved = reservedFromHold(hold, 25)
    expect(reserved).toBe(57)
    expect(reserved).toBeGreaterThanOrEqual(50)
    expect(reserved).toBeLessThanOrEqual(70)
  })

  it("even the un-probed audio fallback (120s) is ~450 credits, not ~5000", () => {
    // 120s fallback: hold = ceil(0.06*120/0.02) = 360 → reserved@25% = 450.
    // Far below the old 5063 (900s × *1.5 × markup).
    const id = resolveAiAvatarCreditId({ speechMode: "audio", engine: "avatar-iv", resolution: "720p" })
    expect(id).toBe("heygen-avatar-iv:720p:120s")
    const reserved = reservedFromHold(aiAvatarHoldCredits("avatar-iv", "720p", 120), 25)
    expect(reserved).toBe(450)
  })
})

describe("aiAvatarReserveCeilingUsd", () => {
  it("uses MAX_DURATION_SEC (900s) for the ceiling calculation", () => {
    expect(aiAvatarReserveCeilingUsd("avatar-iv", "720p")).toBe(aiAvatarUsdCost("avatar-iv", "720p", 900))
    expect(aiAvatarReserveCeilingUsd("avatar-iv", "720p")).toBe(54)
  })

  it("scales correctly for each engine/resolution combination", () => {
    expect(aiAvatarReserveCeilingUsd("avatar-v", "4k")).toBe(180)
    expect(aiAvatarReserveCeilingUsd("avatar-iv", "1080p")).toBe(72)
  })
})

describe("AI_AVATAR_RATE_USD_PER_SEC", () => {
  it("has correct anchored rate for avatar-iv 720p", () => {
    expect(AI_AVATAR_RATE_USD_PER_SEC["avatar-iv"]["720p"]).toBe(0.06)
  })

  it("has all 6 rate entries", () => {
    const engines = Object.keys(AI_AVATAR_RATE_USD_PER_SEC)
    expect(engines).toHaveLength(2)
    for (const engine of engines) {
      const resolutions = Object.keys(AI_AVATAR_RATE_USD_PER_SEC[engine as keyof typeof AI_AVATAR_RATE_USD_PER_SEC])
      expect(resolutions).toHaveLength(3)
    }
  })
})
