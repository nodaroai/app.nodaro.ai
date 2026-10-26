// @test-units-by-name looks up only the kling-4 / kling-4-keyframes credit rows it names
import { describe, it, expect, vi, beforeEach } from "vitest"

// ffprobe is stubbed per URL: the settlement tests decide what the delivered
// clip and the reference clips measure.
const probe = vi.hoisted(() => ({
  durations: new Map<string, number | Error>(),
  probeMediaDuration: vi.fn(async (url: string) => {
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error(`unexpected probe of ${url}`)
    if (d instanceof Error) throw d
    return d
  }),
}))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe.probeMediaDuration }))

import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { PRICING_DEFAULT_RESOLUTION, billsReferenceVideoSeconds } from "@nodaro/shared/models"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import {
  billedRefVideoSeconds,
  seedance2RefVideoActualBaseCredits,
  seedance2RefVideoBaseCredits,
  seedance2RefVideoBaseCreditsFromDurations,
  seedance2RefVideoExpectedBaseCredits,
} from "../seedance2-ref-video-credits.js"

/**
 * Kling 4.0 — per-second ladders on both endpoints, from KIE's published rates
 * (kie.ai/kling-4-0, live-billed 2026-10-23): 28.5 KIE cr/s @720p, 42.5 @1080p
 * with no reference video; 17 / 25.5 cr/s with one, over output + max(output,
 * input seconds). Base credits = KIE cr × 2.5, rounded up to the next 10.
 * Migration 556 seeds the same rows (static-costs-match-migrations.test.ts).
 */
const KIE_PER_SEC = { "720p": 28.5, "1080p": 42.5 } as const
const KIE_REF_PER_SEC = { "720p": 17, "1080p": 25.5 } as const
const DURATIONS = Array.from({ length: 28 }, (_, i) => i + 3)
const ladder = (kiePerSec: number, sec: number) => Math.ceil((kiePerSec * sec * 2.5) / 10) * 10

describe("kling-4 / kling-4-keyframes static credits", () => {
  it("prices every (duration, resolution) row on both ids by the ladder rule", () => {
    for (const id of ["kling-4", "kling-4-keyframes"]) {
      for (const [res, perSec] of Object.entries(KIE_PER_SEC)) {
        for (const d of DURATIONS) {
          expect(STATIC_CREDIT_COSTS[`${id}:${d}s:${res}`], `${id}:${d}s:${res}`).toBe(ladder(perSec, d))
        }
      }
    }
  })

  it("kling-4 carries a -ref ladder from the with-video rate; keyframes has none", () => {
    for (const [res, perSec] of Object.entries(KIE_REF_PER_SEC)) {
      for (const d of DURATIONS) {
        expect(STATIC_CREDIT_COSTS[`kling-4:${d}s:${res}-ref`], `kling-4:${d}s:${res}-ref`).toBe(ladder(perSec, d))
      }
    }
    expect(Object.keys(STATIC_CREDIT_COSTS).some((k) => k.startsWith("kling-4-keyframes:") && k.endsWith("-ref"))).toBe(false)
  })

  it("the 8s -ref rows are exact per-second anchors (340 / 510 → 42.5 / 63.75 per second)", () => {
    expect(STATIC_CREDIT_COSTS["kling-4:8s:720p-ref"]).toBe(340)
    expect(STATIC_CREDIT_COSTS["kling-4:8s:1080p-ref"]).toBe(510)
  })

  it("carries exactly the bare ids plus their composites", () => {
    const count = (prefix: string) =>
      Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === prefix || k.startsWith(`${prefix}:`)).length
    expect(count("kling-4")).toBe(1 + 56 + 56)
    expect(count("kling-4-keyframes")).toBe(1 + 56)
  })

  it("matches the worked examples", () => {
    expect(STATIC_CREDIT_COSTS["kling-4:5s:720p"]).toBe(360)
    expect(STATIC_CREDIT_COSTS["kling-4:5s:1080p"]).toBe(540)
    expect(STATIC_CREDIT_COSTS["kling-4:3s:720p"]).toBe(220)
    expect(STATIC_CREDIT_COSTS["kling-4:30s:1080p"]).toBe(3190)
    expect(STATIC_CREDIT_COSTS["kling-4-keyframes:10s:720p"]).toBe(720)
  })

  it("the bare ids equal the default render they stand for (5s @ 720p)", () => {
    for (const id of ["kling-4", "kling-4-keyframes"]) {
      expect(PRICING_DEFAULT_RESOLUTION[id]).toBe("720p")
      expect(STATIC_CREDIT_COSTS[id]).toBe(STATIC_CREDIT_COSTS[`${id}:5s:720p`])
    }
  })

  it("every id the builder can emit is priced (no price_not_configured)", () => {
    for (const id of ["kling-4", "kling-4-keyframes"]) {
      for (const d of [undefined, 1, 2, ...DURATIONS, 31, 60]) {
        for (const r of [undefined, "720p", "1080p", "1080P", "480p", "4k", "garbage"]) {
          for (const ref of [false, true]) {
            for (const mode of ["image-to-video", "text-to-video"] as const) {
              const credit = buildVideoCreditModelIdentifier(id, d, undefined, mode, undefined, r, ref)
              expect(STATIC_CREDIT_COSTS[credit], `${credit} (d=${d}, r=${r}, ref=${ref})`).toBeTypeOf("number")
            }
          }
        }
      }
    }
  })

  it("bills the reference rate only on kling-4 with a reference video, at the rendered resolution", () => {
    expect(buildVideoCreditModelIdentifier("kling-4", 10, undefined, "image-to-video", undefined, "1080p", true)).toBe("kling-4:10s:1080p-ref")
    expect(buildVideoCreditModelIdentifier("kling-4", 10, undefined, "image-to-video", undefined, "1080p", false)).toBe("kling-4:10s:1080p")
    expect(buildVideoCreditModelIdentifier("kling-4-keyframes", 10, undefined, "image-to-video", undefined, "1080p", true)).toBe("kling-4-keyframes:10s:1080p")
    expect(buildVideoCreditModelIdentifier("kling-4", 7, undefined, "text-to-video", undefined, "nonsense")).toBe("kling-4:7s:720p")
  })

  it("every catalog pricing row agrees with the static table", () => {
    for (const id of ["kling-4", "kling-4-keyframes"]) {
      for (const row of MODEL_CATALOG[id]!.pricing) {
        expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
      }
    }
  })
})

describe("kling-4 reference-video billing (output + max(output, input))", () => {
  it("is a reference-seconds model; keyframes is not", () => {
    expect(billsReferenceVideoSeconds("kling-4")).toBe(true)
    expect(billsReferenceVideoSeconds("kling-4-keyframes")).toBe(false)
  })

  it("matches KIE's published examples: 10s out + 5s in bills 20s, + 15s in bills 25s", () => {
    expect(billedRefVideoSeconds("kling-4", 10, 5)).toBe(20)
    expect(billedRefVideoSeconds("kling-4", 10, 15)).toBe(25)
    // Seedance keeps input + output.
    expect(billedRefVideoSeconds("seedance-2", 10, 5)).toBe(15)
  })

  it("the live 2026-10-23 run: 5s 720p out + a 4.04s clip billed 170 KIE cr = 425 base (42.5/s × 10s)", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "kling-4", resolution: "720p", outputDurationSec: 5, inputVideoDurationSec: 4.04 })).toBe(425)
    expect(170 * 2.5).toBe(425)
  })

  it("the docs' 720p example: 10s out + a 15s clip bills 25s → ceil(42.5 × 25) = 1063 base", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "kling-4", resolution: "720p", outputDurationSec: 10, inputVideoDurationSec: 15 })).toBe(1063)
  })

  it("1080p uses the 63.75/s anchor; an off-list resolution renders and bills 720p", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "kling-4", resolution: "1080p", outputDurationSec: 10, inputVideoDurationSec: 15 })).toBe(Math.ceil(63.75 * 25))
    expect(seedance2RefVideoBaseCredits({ provider: "kling-4", resolution: "4k", outputDurationSec: 5, inputVideoDurationSec: 0 })).toBe(425)
  })

  it("the reservation bills the REQUESTED output (no edit mode) and an unprobed clip at the 30s per-clip cap", () => {
    // 10s out, clips 15 + 6 = 21s → 10 + 21 = 31s × 42.5.
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "kling-4", resolution: "720p", outputDurationSec: 10, requestedDuration: 10, durationsSec: [15, 6] })).toBe(Math.ceil(42.5 * 31))
    // An unreadable clip counts as 30s: 10 + 30 = 40s.
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "kling-4", resolution: "720p", outputDurationSec: 10, requestedDuration: 10, durationsSec: [Number.NaN] })).toBe(1700)
    // A short clip still bills 2 × output.
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "kling-4", resolution: "720p", outputDurationSec: 10, requestedDuration: 10, durationsSec: [3] })).toBe(850)
  })

  it("the quote's expected cost is the requested output even with an auto-duration flag", () => {
    expect(seedance2RefVideoExpectedBaseCredits({ provider: "kling-4", resolution: "720p", outputDurationSec: 6, autoDuration: true, durationsSec: [12] })).toBe(Math.ceil(42.5 * 18))
  })

  describe("the settlement", () => {
    const OUT = "https://kie.example/out.mp4"
    const REF = "https://r2.example.com/videos/ref.mp4"
    beforeEach(() => {
      probe.durations.clear()
      probe.probeMediaDuration.mockClear()
    })

    it("rounds the delivered clip to its whole second (3.04s → 3s) and prices the stored probe", async () => {
      probe.durations.set(OUT, 5.04)
      await expect(
        seedance2RefVideoActualBaseCredits({ provider: "kling-4", resolution: "720p", requestedDuration: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [4.04] }),
      ).resolves.toBe(425)
      expect(probe.probeMediaDuration).toHaveBeenCalledTimes(1)
    })

    it("an input longer than the output bills output + input", async () => {
      probe.durations.set(OUT, 8.02)
      probe.durations.set(REF, 20)
      await expect(
        seedance2RefVideoActualBaseCredits({ provider: "kling-4", resolution: "1080p", requestedDuration: undefined, outputUrl: OUT, referenceVideoUrls: [REF] }),
      ).resolves.toBe(Math.ceil(63.75 * 28))
    })
  })
})
