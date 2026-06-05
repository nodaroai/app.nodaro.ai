import { describe, it, expect } from "vitest"
import {
  AI_AVATAR_RATE_USD_PER_SEC,
  AI_AVATAR_MAX_DURATION_SEC,
  AI_AVATAR_DURATION_BUCKETS,
  AI_AVATAR_RESERVE_IDS,
  aiAvatarUsdCost,
  aiAvatarReserveCreditId,
  aiAvatarHoldCredits,
  resolveAiAvatarCreditId,
  aiAvatarReserveCeilingUsd,
  estimateScriptDurationSec,
  pickAiAvatarBucket,
} from "../ai-avatar-pricing.js"

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
    // Verify it's a number with at most 4 decimal places
    expect(result.toFixed(4)).toBe("0.2400")
  })

  it("uses avatar-v rates for premium engine", () => {
    // avatar-v 720p = $0.08/s; 5s → $0.40
    expect(aiAvatarUsdCost("avatar-v", "720p", 5)).toBe(0.4)
    // avatar-v 1080p = $0.10/s; 3s → $0.30
    expect(aiAvatarUsdCost("avatar-v", "1080p", 3)).toBe(0.3)
  })

  it("handles 4k resolution", () => {
    // avatar-iv 4k = $0.16/s; 2s → $0.32
    expect(aiAvatarUsdCost("avatar-iv", "4k", 2)).toBe(0.32)
  })
})

describe("estimateScriptDurationSec", () => {
  it("returns 1 for empty/missing script", () => {
    expect(estimateScriptDurationSec(undefined)).toBe(1)
    expect(estimateScriptDurationSec("")).toBe(1)
  })

  it("ceil-divides by 12 chars/sec at default speed 1", () => {
    // 360 chars → 30s exactly (no ceil needed)
    expect(estimateScriptDurationSec("x".repeat(360))).toBe(30)
    // 361 chars → ceil(361/12) = ceil(30.08) = 31
    expect(estimateScriptDurationSec("x".repeat(361))).toBe(31)
  })

  it("minimum is 1 even for very short scripts", () => {
    expect(estimateScriptDurationSec("hi")).toBe(1)
  })

  it("slower voiceSpeed produces more seconds (no undercharge)", () => {
    // 1200 chars at speed 1.0 → ceil(1200/12/1.0) = 100
    expect(estimateScriptDurationSec("x".repeat(1200), 1.0)).toBe(100)
    // 1200 chars at speed 0.5 → ceil(1200/12/0.5) = ceil(200) = 200
    expect(estimateScriptDurationSec("x".repeat(1200), 0.5)).toBe(200)
  })

  it("faster voiceSpeed produces fewer seconds", () => {
    // 1200 chars at speed 1.5 → ceil(1200/12/1.5) = ceil(66.7) = 67
    expect(estimateScriptDurationSec("x".repeat(1200), 1.5)).toBe(67)
  })

  it("clamps voiceSpeed to [0.5, 1.5]", () => {
    // Speed 0.1 (below min) → clamped to 0.5 → same as 0.5
    expect(estimateScriptDurationSec("x".repeat(1200), 0.1)).toBe(
      estimateScriptDurationSec("x".repeat(1200), 0.5),
    )
    // Speed 2.0 (above max) → clamped to 1.5 → same as 1.5
    expect(estimateScriptDurationSec("x".repeat(1200), 2.0)).toBe(
      estimateScriptDurationSec("x".repeat(1200), 1.5),
    )
  })

  it("5000-char script at voiceSpeed 0.5 fits within 900s bucket", () => {
    // ceil(5000/12/0.5) = ceil(833.3) = 834 → pickAiAvatarBucket(834) = 900
    const duration = estimateScriptDurationSec("x".repeat(5000), 0.5)
    expect(duration).toBeLessThanOrEqual(900)
    expect(pickAiAvatarBucket(duration)).toBe(900)
  })
})

describe("pickAiAvatarBucket", () => {
  it("picks the smallest bucket >= sec", () => {
    expect(pickAiAvatarBucket(1)).toBe(30)
    expect(pickAiAvatarBucket(30)).toBe(30)
    expect(pickAiAvatarBucket(31)).toBe(60)
    expect(pickAiAvatarBucket(45)).toBe(60)
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
    expect(aiAvatarReserveCreditId("avatar-iv", "720p", 30)).toBe("heygen-avatar-iv:720p:30s")
    expect(aiAvatarReserveCreditId("avatar-iv", "720p", 60)).toBe("heygen-avatar-iv:720p:60s")
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
    // 360 chars → estimateScriptDurationSec = 30 → pickAiAvatarBucket(30) = 30 → :30s
    expect(resolveAiAvatarCreditId({ speechMode: "text", script: "x".repeat(360) }))
      .toBe("heygen-avatar-iv:720p:30s")
  })

  it("text mode: 361-char script → bucket 60s (ceil(361/12)=31 → bucket 60)", () => {
    // ceil(361/12) = 31 → pickAiAvatarBucket(31) = 60
    expect(resolveAiAvatarCreditId({ speechMode: "text", script: "x".repeat(361) }))
      .toBe("heygen-avatar-iv:720p:60s")
  })

  it("text mode with slow voiceSpeed: 1200 chars at 0.5× → 200s → bucket 240s", () => {
    // ceil(1200/12/0.5) = 200 → pickAiAvatarBucket(200) = 240
    expect(
      resolveAiAvatarCreditId({ speechMode: "text", script: "x".repeat(1200), voiceSpeed: 0.5 }),
    ).toBe("heygen-avatar-iv:720p:240s")
  })

  it("text mode: 5000-char script at 0.5× → bucket 900s (worst-case coverage)", () => {
    // ceil(5000/12/0.5) = 834 → pickAiAvatarBucket(834) = 900
    expect(
      resolveAiAvatarCreditId({ speechMode: "text", script: "x".repeat(5000), voiceSpeed: 0.5 }),
    ).toBe("heygen-avatar-iv:720p:900s")
  })

  it("audio mode: always uses max bucket (900s)", () => {
    expect(resolveAiAvatarCreditId({ speechMode: "audio" }))
      .toBe("heygen-avatar-iv:720p:900s")
  })

  it("missing speechMode: uses max bucket (900s)", () => {
    expect(resolveAiAvatarCreditId({})).toBe("heygen-avatar-iv:720p:900s")
    expect(resolveAiAvatarCreditId(undefined)).toBe("heygen-avatar-iv:720p:900s")
  })

  it("resolves valid engine + resolution", () => {
    expect(resolveAiAvatarCreditId({ engine: "avatar-v", resolution: "1080p", speechMode: "audio" }))
      .toBe("heygen-avatar-v:1080p:900s")
    expect(resolveAiAvatarCreditId({ engine: "avatar-iv", resolution: "4k", speechMode: "audio" }))
      .toBe("heygen-avatar-iv:4k:900s")
  })

  it("falls back engine to avatar-iv on invalid value", () => {
    expect(resolveAiAvatarCreditId({ engine: "bogus", speechMode: "audio" }))
      .toBe("heygen-avatar-iv:720p:900s")
    expect(resolveAiAvatarCreditId({ engine: "avatar-iii", speechMode: "audio" }))
      .toBe("heygen-avatar-iv:720p:900s")
  })

  it("falls back resolution to 720p on invalid value", () => {
    expect(resolveAiAvatarCreditId({ engine: "avatar-v", resolution: "360p", speechMode: "audio" }))
      .toBe("heygen-avatar-v:720p:900s")
  })

  it("falls back both to defaults when both are invalid", () => {
    expect(resolveAiAvatarCreditId({ engine: "bogus", resolution: "360p", speechMode: "audio" }))
      .toBe("heygen-avatar-iv:720p:900s")
  })
})

describe("AI_AVATAR_RESERVE_IDS", () => {
  it("contains exactly 42 unique ids (2 engines × 3 resolutions × 7 buckets)", () => {
    expect(AI_AVATAR_RESERVE_IDS).toHaveLength(42)
    expect(new Set(AI_AVATAR_RESERVE_IDS).size).toBe(42)
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

  it("bucket set has 7 entries", () => {
    expect(AI_AVATAR_DURATION_BUCKETS).toHaveLength(7)
  })
})

describe("AI_AVATAR_MAX_DURATION_SEC", () => {
  it("is 900 seconds (covers 5000-char@0.5× worst-case)", () => {
    expect(AI_AVATAR_MAX_DURATION_SEC).toBe(900)
  })
})

describe("aiAvatarHoldCredits", () => {
  it("hold >= metered actual at default configured pricing factor for avatar-iv:720p:30s", () => {
    // metered actual = ceil(ceil(usd/0.02) * 1.25)
    // usd = 0.06 * 30 = 1.80; base = ceil(1.80/0.02) = 90; actual@25% = ceil(90*1.25) = 113
    const usd = aiAvatarUsdCost("avatar-iv", "720p", 30)
    const actualAtDefaultMarkup = Math.ceil(Math.ceil(usd / 0.02) * 1.25)
    expect(aiAvatarHoldCredits("avatar-iv", "720p", 30)).toBeGreaterThanOrEqual(actualAtDefaultMarkup)
  })

  it("hold >= metered actual at default configured pricing factor for avatar-v:4k:900s", () => {
    const usd = aiAvatarUsdCost("avatar-v", "4k", 900)
    const actualAtDefaultMarkup = Math.ceil(Math.ceil(usd / 0.02) * 1.25)
    expect(aiAvatarHoldCredits("avatar-v", "4k", 900)).toBeGreaterThanOrEqual(actualAtDefaultMarkup)
  })

  it("hold is [formula removed] for avatar-iv:720p:30s", () => {
    // $0.06 * 30 = $1.80 → 1.80/0.02 * 1.5 = 90 * 1.5 = 135
    expect(aiAvatarHoldCredits("avatar-iv", "720p", 30)).toBe(135)
  })

  it("hold is [formula removed] for avatar-iv:720p:60s", () => {
    // $0.06 * 60 = $3.60 → 3.60/0.02 * 1.5 = 180 * 1.5 = 270
    expect(aiAvatarHoldCredits("avatar-iv", "720p", 60)).toBe(270)
  })

  it("hold is correct for all bucket × resolution combinations (spot checks)", () => {
    // avatar-iv:1080p:30s → $0.08*30=$2.40 → 2.40/0.02*1.5 = 120*1.5 = 180
    expect(aiAvatarHoldCredits("avatar-iv", "1080p", 30)).toBe(180)
    // avatar-v:720p:120s → $0.08*120=$9.60 → 9.60/0.02*1.5 = 480*1.5 = 720
    expect(aiAvatarHoldCredits("avatar-v", "720p", 120)).toBe(720)
    // avatar-v:1080p:30s → $0.10*30=$3.00 → 3.00/0.02*1.5 = 150*1.5 = 225
    expect(aiAvatarHoldCredits("avatar-v", "1080p", 30)).toBe(225)
    // avatar-v:4k:30s → $0.20*30=$6.00 → 6.00/0.02*1.5 = 300*1.5 = 450
    expect(aiAvatarHoldCredits("avatar-v", "4k", 30)).toBe(450)
    // avatar-v:4k:900s → $0.20*900=$180.00 → 180.00/0.02*1.5 = 9000*1.5 = 13500
    expect(aiAvatarHoldCredits("avatar-v", "4k", 900)).toBe(13500)
  })

  it("invariant: hold >= metered actual at +30% markup headroom for ALL (engine,res,bucket)", () => {
    // This guards against undercharge at bucket boundaries.
    // hold = [formula removed]; actual@30% = ceil(ceil(usd/0.02) * 1.30)
    for (const engine of Object.keys(AI_AVATAR_RATE_USD_PER_SEC) as Array<keyof typeof AI_AVATAR_RATE_USD_PER_SEC>) {
      for (const resolution of Object.keys(AI_AVATAR_RATE_USD_PER_SEC[engine]) as Array<keyof (typeof AI_AVATAR_RATE_USD_PER_SEC)[typeof engine]>) {
        for (const bucket of AI_AVATAR_DURATION_BUCKETS) {
          const hold = aiAvatarHoldCredits(engine, resolution, bucket)
          const usd = aiAvatarUsdCost(engine, resolution, bucket)
          const actualAt30Markup = Math.ceil(Math.ceil(usd / 0.02) * 1.30)
          expect(
            hold,
            `hold ${hold} < actual@30% ${actualAt30Markup} for ${engine}:${resolution}:${bucket}s`,
          ).toBeGreaterThanOrEqual(actualAt30Markup)
        }
      }
    }
  })
})

describe("aiAvatarReserveCeilingUsd", () => {
  it("uses MAX_DURATION_SEC (900s) for the ceiling calculation", () => {
    // avatar-iv 720p: $0.06/s × 900s = $54.00
    expect(aiAvatarReserveCeilingUsd("avatar-iv", "720p")).toBe(aiAvatarUsdCost("avatar-iv", "720p", 900))
    expect(aiAvatarReserveCeilingUsd("avatar-iv", "720p")).toBe(54)
  })

  it("scales correctly for each engine/resolution combination", () => {
    // avatar-v 4k: $0.20/s × 900s = $180.00
    expect(aiAvatarReserveCeilingUsd("avatar-v", "4k")).toBe(180)
    // avatar-iv 1080p: $0.08/s × 900s = $72.00
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
