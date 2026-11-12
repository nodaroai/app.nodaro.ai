// @test-units-by-name looks up only the kling-4-flash credit rows it names
import { describe, it, expect, vi, beforeEach } from "vitest"

// ffprobe is stubbed per URL: the settlement tests decide what the delivered
// clip and the reference clips measure.
const probe = vi.hoisted(() => ({
  durations: new Map<string, number | Error | "hang">(),
  probeMediaDuration: vi.fn(async (url: string): Promise<number> => {
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error(`unexpected probe of ${url}`)
    if (d instanceof Error) throw d
    // A probe that never answers (a stalled host).
    if (d === "hang") return new Promise<number>(() => {})
    return d
  }),
}))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe.probeMediaDuration }))

import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import {
  PRICING_DEFAULT_RESOLUTION,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  billsReferenceVideoSeconds,
  checkRefVideoDurations,
  pricedOutputDurationSec,
} from "@nodaro/shared/models"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import {
  SETTLE_REMEASURE_CLIP_TIMEOUT_MS,
  billedRefVideoSeconds,
  seedance2RefVideoActualBaseCredits,
  seedance2RefVideoBaseCredits,
  seedance2RefVideoBaseCreditsFromDurations,
  seedance2RefVideoExpectedBaseCredits,
} from "../seedance2-ref-video-credits.js"

/**
 * Kling 4.0 Flash — one per-second ladder at 720p for both endpoints, from
 * KIE's published rates (read 2026-11-11): 17 KIE cr/s with no reference
 * video; 11.3 cr/s with one, over output + max(output, input seconds). Base
 * credits = KIE cr × 2.5, rounded up to the next 10 — the Kling 4.0 rule. The
 * Flash seed migration seeds the same rows (static-costs-match-migrations.test.ts).
 *
 * Integer forms so a float can never move a row: 17 × 2.5 = 42.5 = 425/10,
 * 11.3 × 2.5 = 28.25 = 2825/100.
 */
const ID = "kling-4-flash"
const DURATIONS = Array.from({ length: 18 }, (_, i) => i + 3)
const plain = (sec: number) => Math.ceil((425 * sec) / 100) * 10
const withVideo = (sec: number) => Math.ceil((2825 * sec) / 1000) * 10

describe("kling-4-flash static credits", () => {
  it("prices every second 3-20 at 720p by the ladder rule", () => {
    for (const d of DURATIONS) {
      expect(STATIC_CREDIT_COSTS[`${ID}:${d}s:720p`], `${ID}:${d}s:720p`).toBe(plain(d))
    }
  })

  it("carries a -ref ladder from the with-video rate", () => {
    for (const d of DURATIONS) {
      expect(STATIC_CREDIT_COSTS[`${ID}:${d}s:720p-ref`], `${ID}:${d}s:720p-ref`).toBe(withVideo(d))
    }
  })

  it("matches the worked examples (3s 130, 5s 220, 10s 430, 20s 850; 8s with a video 230, rounded on purpose)", () => {
    expect(STATIC_CREDIT_COSTS[`${ID}:3s:720p`]).toBe(130)
    expect(STATIC_CREDIT_COSTS[`${ID}:5s:720p`]).toBe(220)
    expect(STATIC_CREDIT_COSTS[`${ID}:10s:720p`]).toBe(430)
    expect(STATIC_CREDIT_COSTS[`${ID}:20s:720p`]).toBe(850)
    expect(STATIC_CREDIT_COSTS[`${ID}:8s:720p-ref`]).toBe(230)
  })

  it("carries exactly the bare id plus 18 plain and 18 -ref rows — no 1080p, nothing past 20s", () => {
    const keys = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === ID || k.startsWith(`${ID}:`))
    expect(keys).toHaveLength(1 + 18 + 18)
    expect(keys.some((k) => k.includes("1080p"))).toBe(false)
    expect(keys.some((k) => /:(2[1-9]|3\d)s:/.test(k))).toBe(false)
  })

  it("adds no row to the Kling 4.0 ids (Flash extends their prefix, never their ladders)", () => {
    const k4 = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === "kling-4" || k.startsWith("kling-4:"))
    const k4kf = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k === "kling-4-keyframes" || k.startsWith("kling-4-keyframes:"))
    expect(k4).toHaveLength(1 + 56 + 56)
    expect(k4kf).toHaveLength(1 + 56)
  })

  it("the bare id equals the default render it stands for (5s @ 720p)", () => {
    expect(PRICING_DEFAULT_RESOLUTION[ID]).toBe("720p")
    expect(pricedOutputDurationSec(ID, undefined)).toBe(5)
    expect(STATIC_CREDIT_COSTS[ID]).toBe(STATIC_CREDIT_COSTS[`${ID}:5s:720p`])
  })

  it("every id the builder can emit is priced (no price_not_configured)", () => {
    for (const d of [undefined, 1, 2, ...DURATIONS, 21, 30, 60]) {
      for (const r of [undefined, "720p", "720P", "1080p", "480p", "4k", "garbage"]) {
        for (const ref of [false, true]) {
          for (const mode of ["image-to-video", "text-to-video"] as const) {
            const credit = buildVideoCreditModelIdentifier(ID, d, undefined, mode, undefined, r, ref)
            expect(STATIC_CREDIT_COSTS[credit], `${credit} (d=${d}, r=${r}, ref=${ref})`).toBeTypeOf("number")
          }
        }
      }
    }
  })

  it("bills 720p whatever resolution is asked, and the reference rate only with a reference video", () => {
    expect(buildVideoCreditModelIdentifier(ID, 10, undefined, "image-to-video", undefined, "1080p", true)).toBe(`${ID}:10s:720p-ref`)
    expect(buildVideoCreditModelIdentifier(ID, 10, undefined, "image-to-video", undefined, "1080p", false)).toBe(`${ID}:10s:720p`)
    expect(buildVideoCreditModelIdentifier(ID, 7, undefined, "text-to-video", undefined, "nonsense")).toBe(`${ID}:7s:720p`)
    expect(buildVideoCreditModelIdentifier(ID, undefined, undefined, "text-to-video")).toBe(`${ID}:5s:720p`)
    // Past the 20s top the ladder holds its last rung — never a 21s+ row.
    expect(buildVideoCreditModelIdentifier(ID, 30, undefined, "image-to-video", undefined, "720p")).toBe(`${ID}:20s:720p`)
  })

  it("every catalog pricing row agrees with the static table", () => {
    for (const row of MODEL_CATALOG[ID]!.pricing) {
      expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
  })
})

describe("kling-4-flash reference-video billing (output + max(output, input))", () => {
  it("is a reference-seconds model on the Kling 4.0 rule", () => {
    expect(billsReferenceVideoSeconds(ID)).toBe(true)
    expect(billedRefVideoSeconds(ID, 10, 5)).toBe(20)
    expect(billedRefVideoSeconds(ID, 10, 15)).toBe(25)
  })

  it("prices a billed second at the 8s -ref anchor ÷ 8 (230 / 8 = 28.75)", () => {
    // 5s out + a 4s clip bills 10s.
    expect(seedance2RefVideoBaseCredits({ provider: ID, resolution: "720p", outputDurationSec: 5, inputVideoDurationSec: 4 })).toBe(288)
    // 10s out + a 15s clip bills 25s.
    expect(seedance2RefVideoBaseCredits({ provider: ID, resolution: "720p", outputDurationSec: 10, inputVideoDurationSec: 15 })).toBe(719)
  })

  it("a 1080p (or any) request bills the 720p anchor — never an unseeded 1080p-ref row", () => {
    for (const r of ["1080p", "1080P", "4k", "480p", "garbage", ""]) {
      expect(seedance2RefVideoBaseCredits({ provider: ID, resolution: r, outputDurationSec: 5, inputVideoDurationSec: 4 }), r).toBe(288)
    }
  })

  it("the reservation bills the REQUESTED output, an unprobed clip at the 20s cap and the input at the 20s total", () => {
    // 10s out, clips 8 + 6 = 14s → 10 + 14 = 24s.
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: ID, resolution: "720p", outputDurationSec: 10, requestedDuration: 10, referenceTaskType: undefined, durationsSec: [8, 6] })).toBe(Math.ceil(28.75 * 24))
    // An unreadable clip counts as 20s: 10 + 20 = 30s.
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: ID, resolution: "720p", outputDurationSec: 10, requestedDuration: 10, referenceTaskType: undefined, durationsSec: [Number.NaN] })).toBe(863)
    // Inputs past 20s together are capped there (KIE fails such a run; the routes refuse it first).
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: ID, resolution: "720p", outputDurationSec: 10, requestedDuration: 10, referenceTaskType: undefined, durationsSec: [15, 6] })).toBe(863)
    // A short clip still bills 2 × output.
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: ID, resolution: "720p", outputDurationSec: 10, requestedDuration: 10, referenceTaskType: undefined, durationsSec: [3] })).toBe(575)
  })

  it("the quote's expected cost is the requested output even with an auto-duration flag", () => {
    expect(seedance2RefVideoExpectedBaseCredits({ provider: ID, resolution: "720p", outputDurationSec: 6, autoDuration: true, durationsSec: [12] })).toBe(Math.ceil(28.75 * 18))
  })

  it("refuses reference videos outside 2-20s each or 20s together, before anything is reserved", () => {
    expect(VIDEO_REF_VIDEO_DURATION_LIMITS[ID]).toEqual({ minSec: 2, maxSec: 20, maxTotalSec: 20 })
    expect(checkRefVideoDurations(ID, [5, 10]).ok).toBe(true)
    expect(checkRefVideoDurations(ID, [2]).ok).toBe(true)
    expect(checkRefVideoDurations(ID, [1.5]).ok).toBe(false)
    expect(checkRefVideoDurations(ID, [21]).ok).toBe(false)
    expect(checkRefVideoDurations(ID, [12, 9]).ok).toBe(false)
    // An unreadable clip is never a refusal (the price holds its worst case).
    expect(checkRefVideoDurations(ID, [Number.NaN]).ok).toBe(true)
  })

  describe("the settlement", () => {
    const OUT = "https://kie.example/out.mp4"
    const REF = "https://r2.example.com/videos/ref.mp4"
    beforeEach(() => {
      probe.durations.clear()
      probe.probeMediaDuration.mockClear()
    })

    it("rounds the delivered clip to its whole second and prices the stored probe", async () => {
      probe.durations.set(OUT, 5.04)
      await expect(
        seedance2RefVideoActualBaseCredits({ provider: ID, resolution: "720p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [4.04] }),
      ).resolves.toBe(288)
      expect(probe.probeMediaDuration).toHaveBeenCalledTimes(1)
    })

    it("a clip the reservation could not measure is measured again: 5 s out + a 3 s clip bills 10 s, not the 20 s worst case", async () => {
      probe.durations.set(OUT, 5.04)
      probe.durations.set(REF, 3)
      // The reservation's probe failed (NaN, stored on the job as null).
      for (const stored of [[Number.NaN], [null]]) {
        await expect(
          seedance2RefVideoActualBaseCredits({ provider: ID, resolution: "720p", requestedDuration: 5, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: stored }),
        ).resolves.toBe(288)
      }
    })

    it("a clip that still cannot be read keeps the worst case (5 s out + 20 s = 25 s)", async () => {
      probe.durations.set(OUT, 5.04)
      probe.durations.set(REF, new Error("probe failed"))
      await expect(
        seedance2RefVideoActualBaseCredits({ provider: ID, resolution: "720p", requestedDuration: 5, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [Number.NaN] }),
      ).resolves.toBe(Math.ceil(28.75 * 25))
    })

    it("a clip whose probe hangs past the per-clip budget keeps the worst case, and the settlement answers at that budget", async () => {
      vi.useFakeTimers()
      try {
        probe.durations.set(OUT, 5.04)
        probe.durations.set(REF, "hang")
        let done = false
        const settled = seedance2RefVideoActualBaseCredits({ provider: ID, resolution: "720p", requestedDuration: 5, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [Number.NaN] })
          .finally(() => { done = true })
        await vi.advanceTimersByTimeAsync(SETTLE_REMEASURE_CLIP_TIMEOUT_MS - 1)
        expect(done).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(done).toBe(true)
        // 5 s out + the 20 s worst case: the charge the run reserved, never more.
        await expect(settled).resolves.toBe(Math.ceil(28.75 * 25))
      } finally {
        vi.useRealTimers()
      }
    })

    it("a clip measured now is never counted above the worst case the reservation held", async () => {
      probe.durations.set(OUT, 5.04)
      probe.durations.set(REF, 45)
      await expect(
        seedance2RefVideoActualBaseCredits({ provider: ID, resolution: "720p", requestedDuration: 5, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [Number.NaN] }),
      ).resolves.toBe(Math.ceil(28.75 * 25))
    })

    it("an input longer than the output bills output + input, at 720p whatever was asked", async () => {
      probe.durations.set(OUT, 8.02)
      probe.durations.set(REF, 12)
      await expect(
        seedance2RefVideoActualBaseCredits({ provider: ID, resolution: "1080p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF] }),
      ).resolves.toBe(Math.ceil(28.75 * 20))
    })
  })
})
