import { describe, it, expect } from "vitest"
import {
  AI_AVATAR_MAX_DURATION_SEC,
  AI_AVATAR_MAX_AUDIO_SEC,
  AI_AVATAR_DURATION_BUCKETS,
  AI_AVATAR_AUDIO_FALLBACK_SEC,
  AI_AVATAR_RESERVE_IDS,
  aiAvatarReserveCreditId,
  resolveAiAvatarCreditId,
  estimateScriptDurationSec,
  pickAiAvatarBucket,
} from "../ai-avatar-pricing.js"

// The provider-$ rate table and USD/credit cost formulas (aiAvatarUsdCost,
// aiAvatarHoldCredits, aiAvatarReserveCeilingUsd) moved to
// backend/src/lib/pricing/ai-avatar-cost.ts (S5) — their tests live in
// backend/src/lib/pricing/__tests__/ai-avatar-cost.test.ts. This file covers
// only the NON-monetary duration-bucketing + credit-id-construction logic
// that stays in the published package.

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
})
