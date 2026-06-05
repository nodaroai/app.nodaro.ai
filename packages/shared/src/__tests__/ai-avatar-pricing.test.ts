import { describe, it, expect } from "vitest"
import {
  AI_AVATAR_RATE_USD_PER_SEC,
  AI_AVATAR_MAX_DURATION_SEC,
  AI_AVATAR_MAX_AUDIO_SEC,
  AI_AVATAR_DURATION_BUCKETS,
  AI_AVATAR_AUDIO_FALLBACK_SEC,
  AI_AVATAR_RESERVE_IDS,
  aiAvatarUsdCost,
  aiAvatarReserveCreditId,
  aiAvatarHoldCredits,
  resolveAiAvatarCreditId,
  aiAvatarReserveCeilingUsd,
  estimateScriptDurationSec,
  pickAiAvatarBucket,
} from "../ai-avatar-pricing.js"

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

describe("estimateScriptDurationSec", () => {
  it("returns 1 for empty/missing script", () => {
    expect(estimateScriptDurationSec(undefined)).toBe(1)
    expect(estimateScriptDurationSec("")).toBe(1)
  })

  it("ceil-divides by 12 chars/sec at default speed 1", () => {
    expect(estimateScriptDurationSec("x".repeat(360))).toBe(30)
    expect(estimateScriptDurationSec("x".repeat(361))).toBe(31)
  })

  it("minimum is 1 even for very short scripts", () => {
    expect(estimateScriptDurationSec("hi")).toBe(1)
  })

  it("slower voiceSpeed produces more seconds (no undercharge)", () => {
    expect(estimateScriptDurationSec("x".repeat(1200), 1.0)).toBe(100)
    expect(estimateScriptDurationSec("x".repeat(1200), 0.5)).toBe(200)
  })

  it("faster voiceSpeed produces fewer seconds", () => {
    expect(estimateScriptDurationSec("x".repeat(1200), 1.5)).toBe(67)
  })

  it("clamps voiceSpeed to [0.5, 1.5]", () => {
    expect(estimateScriptDurationSec("x".repeat(1200), 0.1)).toBe(
      estimateScriptDurationSec("x".repeat(1200), 0.5),
    )
    expect(estimateScriptDurationSec("x".repeat(1200), 2.0)).toBe(
      estimateScriptDurationSec("x".repeat(1200), 1.5),
    )
  })

  it("5000-char script at voiceSpeed 0.5 fits within 900s bucket", () => {
    const duration = estimateScriptDurationSec("x".repeat(5000), 0.5)
    expect(duration).toBeLessThanOrEqual(900)
    expect(pickAiAvatarBucket(duration)).toBe(900)
  })
})

describe("AI_AVATAR_DURATION_BUCKETS (fine-grained low end)", () => {
  it("has 10 buckets: 5/10/15/30/60/120/240/360/600/900s", () => {
    expect([...AI_AVATAR_DURATION_BUCKETS]).toEqual([5, 10, 15, 30, 60, 120, 240, 360, 600, 900])
  })
})

describe("pickAiAvatarBucket", () => {
  it("picks the smallest bucket >= sec (fine low end)", () => {
    expect(pickAiAvatarBucket(1)).toBe(5)
    expect(pickAiAvatarBucket(5)).toBe(5)
    expect(pickAiAvatarBucket(6)).toBe(10)
    expect(pickAiAvatarBucket(10)).toBe(10)
    expect(pickAiAvatarBucket(11)).toBe(15)
    expect(pickAiAvatarBucket(15)).toBe(15)
    expect(pickAiAvatarBucket(16)).toBe(30)
    expect(pickAiAvatarBucket(30)).toBe(30)
    expect(pickAiAvatarBucket(31)).toBe(60)
    expect(pickAiAvatarBucket(60)).toBe(60)
    expect(pickAiAvatarBucket(61)).toBe(120)
    expect(pickAiAvatarBucket(120)).toBe(120)
    expect(pickAiAvatarBucket(121)).toBe(240)
    expect(pickAiAvatarBucket(240)).toBe(240)
    expect(pickAiAvatarBucket(241)).toBe(360)
    expect(pickAiAvatarBucket(360)).toBe(360)
    expect(pickAiAvatarBucket(361)).toBe(600)
    expect(pickAiAvatarBucket(600)).toBe(600)
    expect(pickAiAvatarBucket(601)).toBe(900)
    expect(pickAiAvatarBucket(900)).toBe(900)
  })

  it("falls back to max bucket (900) when sec exceeds all buckets", () => {
    expect(pickAiAvatarBucket(901)).toBe(900)
    expect(pickAiAvatarBucket(9999)).toBe(900)
  })
})

describe("aiAvatarReserveCreditId", () => {
  it("builds correct bucketed composite IDs", () => {
    expect(aiAvatarReserveCreditId("avatar-iv", "720p", 5)).toBe("heygen-avatar-iv:720p:5s")
    expect(aiAvatarReserveCreditId("avatar-iv", "720p", 15)).toBe("heygen-avatar-iv:720p:15s")
    expect(aiAvatarReserveCreditId("avatar-iv", "720p", 900)).toBe("heygen-avatar-iv:720p:900s")
    expect(aiAvatarReserveCreditId("avatar-iv", "1080p", 60)).toBe("heygen-avatar-iv:1080p:60s")
    expect(aiAvatarReserveCreditId("avatar-iv", "4k", 120)).toBe("heygen-avatar-iv:4k:120s")
    expect(aiAvatarReserveCreditId("avatar-v", "720p", 30)).toBe("heygen-avatar-v:720p:30s")
    expect(aiAvatarReserveCreditId("avatar-v", "1080p", 240)).toBe("heygen-avatar-v:1080p:240s")
    expect(aiAvatarReserveCreditId("avatar-v", "4k", 900)).toBe("heygen-avatar-v:4k:900s")
  })
})

describe("resolveAiAvatarCreditId", () => {
  it("text mode: uses script length to pick bucket", () => {
    // 360 chars → 30s → bucket 30
    expect(resolveAiAvatarCreditId({ speechMode: "text", script: "x".repeat(360) }))
      .toBe("heygen-avatar-iv:720p:30s")
  })

  it("text mode: short script lands in the fine low-end bucket", () => {
    // 120 chars → ceil(120/12)=10s → bucket 10
    expect(resolveAiAvatarCreditId({ speechMode: "text", script: "x".repeat(120) }))
      .toBe("heygen-avatar-iv:720p:10s")
    // 50 chars → ceil(50/12)=5s → bucket 5
    expect(resolveAiAvatarCreditId({ speechMode: "text", script: "x".repeat(50) }))
      .toBe("heygen-avatar-iv:720p:5s")
  })

  it("text mode with slow voiceSpeed: 1200 chars at 0.5× → 200s → bucket 240s", () => {
    expect(
      resolveAiAvatarCreditId({ speechMode: "text", script: "x".repeat(1200), voiceSpeed: 0.5 }),
    ).toBe("heygen-avatar-iv:720p:240s")
  })

  it("text mode: 5000-char script at 0.5× → bucket 900s (worst-case coverage)", () => {
    expect(
      resolveAiAvatarCreditId({ speechMode: "text", script: "x".repeat(5000), voiceSpeed: 0.5 }),
    ).toBe("heygen-avatar-iv:720p:900s")
  })

  it("audio mode WITHOUT probe: modest 120s default (NOT 900s)", () => {
    expect(resolveAiAvatarCreditId({ speechMode: "audio" }))
      .toBe("heygen-avatar-iv:720p:120s")
  })

  it("audio mode WITH __probedDurationSec: buckets by the probed length", () => {
    // 15s probed audio → bucket 15s (the user-reported scenario)
    expect(resolveAiAvatarCreditId({ speechMode: "audio", __probedDurationSec: 15 }))
      .toBe("heygen-avatar-iv:720p:15s")
    // 7.3s probed → ceil = 8 → bucket 10s
    expect(resolveAiAvatarCreditId({ speechMode: "audio", __probedDurationSec: 7.3 }))
      .toBe("heygen-avatar-iv:720p:10s")
    // 200s probed → bucket 240s
    expect(resolveAiAvatarCreditId({ speechMode: "audio", __probedDurationSec: 200 }))
      .toBe("heygen-avatar-iv:720p:240s")
    // probed > 600 (the audio cap) → bucket 600s, NOT 900s. The worker trims
    // audio to AI_AVATAR_MAX_AUDIO_SEC, so the reserve caps at the 600s bucket.
    expect(resolveAiAvatarCreditId({ speechMode: "audio", __probedDurationSec: 1200 }))
      .toBe("heygen-avatar-iv:720p:600s")
  })

  it("audio mode: invalid/zero probe falls back to the modest default", () => {
    expect(resolveAiAvatarCreditId({ speechMode: "audio", __probedDurationSec: 0 }))
      .toBe("heygen-avatar-iv:720p:120s")
    expect(resolveAiAvatarCreditId({ speechMode: "audio", __probedDurationSec: -5 }))
      .toBe("heygen-avatar-iv:720p:120s")
    expect(resolveAiAvatarCreditId({ speechMode: "audio", __probedDurationSec: NaN }))
      .toBe("heygen-avatar-iv:720p:120s")
  })

  it("missing speechMode: modest 120s default", () => {
    expect(resolveAiAvatarCreditId({})).toBe("heygen-avatar-iv:720p:120s")
    expect(resolveAiAvatarCreditId(undefined)).toBe("heygen-avatar-iv:720p:120s")
  })

  it("resolves valid engine + resolution", () => {
    expect(resolveAiAvatarCreditId({ engine: "avatar-v", resolution: "1080p", speechMode: "audio", __probedDurationSec: 30 }))
      .toBe("heygen-avatar-v:1080p:30s")
    expect(resolveAiAvatarCreditId({ engine: "avatar-iv", resolution: "4k", speechMode: "audio", __probedDurationSec: 30 }))
      .toBe("heygen-avatar-iv:4k:30s")
  })

  it("falls back engine to avatar-iv on invalid value", () => {
    expect(resolveAiAvatarCreditId({ engine: "bogus", speechMode: "audio" }))
      .toBe("heygen-avatar-iv:720p:120s")
    expect(resolveAiAvatarCreditId({ engine: "avatar-iii", speechMode: "audio" }))
      .toBe("heygen-avatar-iv:720p:120s")
  })

  it("falls back resolution to 720p on invalid value", () => {
    expect(resolveAiAvatarCreditId({ engine: "avatar-v", resolution: "360p", speechMode: "audio" }))
      .toBe("heygen-avatar-v:720p:120s")
  })

  it("falls back both to defaults when both are invalid", () => {
    expect(resolveAiAvatarCreditId({ engine: "bogus", resolution: "360p", speechMode: "audio" }))
      .toBe("heygen-avatar-iv:720p:120s")
  })

  it("image source mode: bills at avatar-iv rate even when engine is avatar-v", () => {
    expect(
      resolveAiAvatarCreditId({
        avatarSource: "image",
        engine: "avatar-v",
        resolution: "1080p",
        speechMode: "audio",
        __probedDurationSec: 30,
      }),
    ).toBe("heygen-avatar-iv:1080p:30s")
  })

  it("image source mode: text-mode buckets by script length at the avatar-iv rate", () => {
    expect(
      resolveAiAvatarCreditId({
        avatarSource: "image",
        engine: "avatar-v",
        speechMode: "text",
        script: "x".repeat(360),
      }),
    ).toBe("heygen-avatar-iv:720p:30s")
  })

  it("always resolves to a member of AI_AVATAR_RESERVE_IDS (no 503 trap)", () => {
    const probes = [undefined, 0, 1, 7, 15, 30, 90, 200, 901]
    for (const engine of ["avatar-iv", "avatar-v", "bogus"]) {
      for (const resolution of ["720p", "1080p", "4k", "360p"]) {
        for (const probe of probes) {
          const audioId = resolveAiAvatarCreditId({ engine, resolution, speechMode: "audio", __probedDurationSec: probe })
          expect(AI_AVATAR_RESERVE_IDS).toContain(audioId)
        }
        const textId = resolveAiAvatarCreditId({ engine, resolution, speechMode: "text", script: "x".repeat(2000) })
        expect(AI_AVATAR_RESERVE_IDS).toContain(textId)
      }
    }
  })
})

describe("AI_AVATAR_AUDIO_FALLBACK_SEC", () => {
  it("is a modest 120s (not the 900s top bucket)", () => {
    expect(AI_AVATAR_AUDIO_FALLBACK_SEC).toBe(120)
    expect(AI_AVATAR_DURATION_BUCKETS).toContain(AI_AVATAR_AUDIO_FALLBACK_SEC)
  })
})

describe("AI_AVATAR_RESERVE_IDS", () => {
  it("contains exactly 60 unique ids (2 engines × 3 resolutions × 10 buckets)", () => {
    expect(AI_AVATAR_RESERVE_IDS).toHaveLength(60)
    expect(new Set(AI_AVATAR_RESERVE_IDS).size).toBe(60)
  })

  it("contains all expected bucket variants for avatar-iv:720p", () => {
    for (const b of AI_AVATAR_DURATION_BUCKETS) {
      expect(AI_AVATAR_RESERVE_IDS).toContain(`heygen-avatar-iv:720p:${b}s`)
    }
  })

  it("contains all expected bucket variants for avatar-v:4k", () => {
    for (const b of AI_AVATAR_DURATION_BUCKETS) {
      expect(AI_AVATAR_RESERVE_IDS).toContain(`heygen-avatar-v:4k:${b}s`)
    }
  })

  it("bucket set has 10 entries", () => {
    expect(AI_AVATAR_DURATION_BUCKETS).toHaveLength(10)
  })
})

describe("AI_AVATAR_MAX_DURATION_SEC", () => {
  it("is 900 seconds (covers 5000-char@0.5× worst-case text)", () => {
    expect(AI_AVATAR_MAX_DURATION_SEC).toBe(900)
  })
})

describe("AI_AVATAR_MAX_AUDIO_SEC — audio-mode hard cap (worker trims + reserve caps)", () => {
  it("is 600 seconds and is a real bucket", () => {
    expect(AI_AVATAR_MAX_AUDIO_SEC).toBe(600)
    expect(AI_AVATAR_DURATION_BUCKETS).toContain(AI_AVATAR_MAX_AUDIO_SEC)
  })

  it("a 1800s (30-min) probed audio reserves the 600s bucket, NOT 900s", () => {
    expect(
      resolveAiAvatarCreditId({
        speechMode: "audio",
        engine: "avatar-iv",
        resolution: "720p",
        __probedDurationSec: 1800,
      }),
    ).toBe("heygen-avatar-iv:720p:600s")
  })

  it("a 450s probed audio reserves the 600s bucket (under the cap, normal bucket-up)", () => {
    expect(
      resolveAiAvatarCreditId({
        speechMode: "audio",
        engine: "avatar-iv",
        resolution: "720p",
        __probedDurationSec: 450,
      }),
    ).toBe("heygen-avatar-iv:720p:600s")
  })

  it("exactly 600s probed audio stays in the 600s bucket", () => {
    expect(resolveAiAvatarCreditId({ speechMode: "audio", __probedDurationSec: 600 }))
      .toBe("heygen-avatar-iv:720p:600s")
  })

  it("clamps audio across engines/resolutions to the 600s bucket", () => {
    expect(
      resolveAiAvatarCreditId({
        speechMode: "audio",
        engine: "avatar-v",
        resolution: "1080p",
        __probedDurationSec: 3600,
      }),
    ).toBe("heygen-avatar-v:1080p:600s")
  })

  it("does NOT affect text mode — text can still reach the 900s bucket", () => {
    // 5000 chars at 0.5× → 834s → 900s bucket, unchanged by the audio cap.
    expect(
      resolveAiAvatarCreditId({ speechMode: "text", script: "x".repeat(5000), voiceSpeed: 0.5 }),
    ).toBe("heygen-avatar-iv:720p:900s")
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
