import { describe, it, expect, vi, beforeEach } from "vitest"

const probe = vi.hoisted(() => ({ result: undefined as unknown, fail: false }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  probeVideoSource: vi.fn(async () => {
    if (probe.fail) throw new Error("ffprobe: invalid data")
    return probe.result
  }),
}))
vi.mock("@/lib/credit-base-cost.js", () => ({
  // The Topaz unit row at 40 base credits.
  unitRateBaseCredits: vi.fn(async (_id: string, units: number) => units * 40),
}))

import { topazVideoHoldUnits, topazVideoEstimateUnits, topazVideoMaxSourceSec, TOPAZ_VIDEO_MAX_OUTPUT_GIGAPIXELS } from "@nodaro/render-rules"
import {
  planTopazVideoUpscale,
  stampTopazVideoUpscale,
  topazVideoStampedBaseCredits,
  TopazVideoSourceUnreadableError,
  TopazVideoTooLongError,
} from "../topaz-video-plan.js"

/**
 * Every Topaz run measured on Replicate (2026-10-25): its source, target and
 * the units Replicate billed. The hold is a CEILING — the charge can only be
 * refunded down to the units, never raised above the hold — so it must cover
 * every one of them.
 */
const MEASURED: ReadonlyArray<{ source: { width: number; height: number }; sec: number; resolution: "720p" | "1080p" | "4k"; fps: number; units: number }> = [
  { source: { width: 1280, height: 720 }, sec: 5.085, resolution: "720p", fps: 30, units: 2 },
  { source: { width: 1280, height: 720 }, sec: 5.085, resolution: "720p", fps: 60, units: 3 },
  { source: { width: 1280, height: 720 }, sec: 5.085, resolution: "1080p", fps: 24, units: 2 },
  { source: { width: 1280, height: 720 }, sec: 5.085, resolution: "1080p", fps: 30, units: 3 },
  { source: { width: 1280, height: 720 }, sec: 5.085, resolution: "1080p", fps: 60, units: 6 },
  { source: { width: 1280, height: 720 }, sec: 5.085, resolution: "4k", fps: 30, units: 6 },
  { source: { width: 1280, height: 720 }, sec: 5.085, resolution: "4k", fps: 60, units: 19 },
  { source: { width: 1280, height: 720 }, sec: 7.662, resolution: "1080p", fps: 30, units: 3 },
  { source: { width: 1072, height: 1928 }, sec: 34.1, resolution: "1080p", fps: 30, units: 6 },
  // The HD-source probe (decided 2026-10-25: probe before scaling the hold by source pixels).
  { source: { width: 1080, height: 1920 }, sec: 4.04, resolution: "4k", fps: 60, units: 9 },
]

describe("the Topaz video hold", () => {
  it.each(MEASURED.map((m) => [`${m.resolution}@${m.fps} ${m.sec}s ${m.source.width}x${m.source.height}`, m] as const))(
    "covers what Replicate billed: %s",
    (_label, m) => {
      expect(topazVideoHoldUnits({ resolution: m.resolution, fps: m.fps, durationSec: m.sec, source: m.source })).toBeGreaterThanOrEqual(m.units)
    },
  )

  it("never holds fewer than the minimum, even for a sliver", () => {
    expect(topazVideoHoldUnits({ resolution: "720p", fps: 15, durationSec: 0.5 })).toBe(3)
  })

  it("an estimate with no known length prices the 10 s fallback at 1080p / 30 fps", () => {
    expect(topazVideoEstimateUnits({})).toBe(topazVideoHoldUnits({ resolution: "1080p", fps: 30, durationSec: 10 }))
  })
})

describe("planTopazVideoUpscale", () => {
  beforeEach(() => {
    probe.fail = false
    probe.result = { width: 1280, height: 720, durationSeconds: 5.085, videoDurationSeconds: 5.08, fps: 24 }
  })

  it("resolves the target over the measured source and holds its units", async () => {
    const plan = await planTopazVideoUpscale("https://cdn.example/a.mp4", { targetResolution: "4k", targetFps: 60 })
    expect(plan).toMatchObject({ resolution: "4k", fps: 60, sourceDurationSec: 5.08 })
    expect(plan.holdUnits).toBe(topazVideoHoldUnits({ resolution: "4k", fps: 60, durationSec: 5.08, source: { width: 1280, height: 720 } }))
  })

  it("\"same as source\" is the source's own rate; a legacy factor maps over its size", async () => {
    const plan = await planTopazVideoUpscale("https://cdn.example/a.mp4", { upscaleFactor: "1" })
    expect(plan).toMatchObject({ resolution: "720p", fps: 24 })
  })

  it("refuses an output past the cap, naming the longest clip the settings allow", async () => {
    // 60 s of 4K60 is ~29.9 GP, past the 25 GP cap.
    probe.result = { width: 1920, height: 1080, durationSeconds: 60, fps: 30 }
    const err = await planTopazVideoUpscale("https://cdn.example/a.mp4", { targetResolution: "4k", targetFps: 60 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TopazVideoTooLongError)
    expect((err as TopazVideoTooLongError).maxSec).toBe(50)
    expect((err as Error).message).toContain("up to 50 seconds")
    // The same clip at 1080p30 is ~3.7 GP: accepted.
    await expect(planTopazVideoUpscale("https://cdn.example/a.mp4", { targetResolution: "1080p", targetFps: 30 })).resolves.toMatchObject({ resolution: "1080p" })
  })

  it("the cap reads as about 50 s at 4K60, 100 s at 4K30 and 6.5 min at 1080p30 (16:9)", () => {
    expect(TOPAZ_VIDEO_MAX_OUTPUT_GIGAPIXELS).toBe(25)
    expect(topazVideoMaxSourceSec({ resolution: "4k", fps: 60 })).toBe(50)
    expect(topazVideoMaxSourceSec({ resolution: "4k", fps: 30 })).toBe(100)
    expect(topazVideoMaxSourceSec({ resolution: "1080p", fps: 30 })).toBe(401)
  })

  it("refuses a source it cannot read", async () => {
    probe.fail = true
    await expect(planTopazVideoUpscale("https://cdn.example/a.mp4", {})).rejects.toBeInstanceOf(TopazVideoSourceUnreadableError)
  })
})

describe("the workflow run's stamp", () => {
  beforeEach(() => {
    probe.fail = false
    probe.result = { width: 1920, height: 1080, durationSeconds: 10, fps: 30 }
  })

  it("stamps the resolved target and its hold onto a Topaz payload", async () => {
    const stamp = await stampTopazVideoUpscale("video-upscale", { provider: "topaz", videoUrl: "https://cdn.example/a.mp4", targetResolution: "1080p" })
    expect(stamp).toEqual({ ok: true, patch: { targetResolution: "1080p", targetFps: 30, topazHoldUnits: expect.any(Number) } })
    const held = await topazVideoStampedBaseCredits("video-upscale", { provider: "topaz", ...(stamp.ok ? stamp.patch : {}) })
    expect(held).toBe((stamp.ok ? (stamp.patch.topazHoldUnits as number) : 0) * 40)
  })

  it("leaves VEO and the Seedance finalize alone", async () => {
    expect(await stampTopazVideoUpscale("video-upscale", { provider: "veo-4k", videoUrl: "https://x/v.mp4" })).toEqual({ ok: true, patch: {} })
    expect(await topazVideoStampedBaseCredits("video-upscale", { provider: "veo-4k", topazHoldUnits: 5 })).toBeUndefined()
    expect(await stampTopazVideoUpscale("extend-video", { videoUrl: "https://x/v.mp4" })).toEqual({ ok: true, patch: {} })
  })

  it("refuses a too-long source with its own code", async () => {
    probe.result = { width: 1920, height: 1080, durationSeconds: 600, fps: 30 }
    expect(await stampTopazVideoUpscale("video-upscale", { videoUrl: "https://x/v.mp4", targetResolution: "4k" })).toEqual({
      ok: false,
      refusal: { code: "video_too_long", message: expect.stringContaining("Trim the clip") },
    })
  })

  it("refuses an unreadable source with a code the run reports", async () => {
    probe.fail = true
    expect(await stampTopazVideoUpscale("video-upscale", { videoUrl: "https://x/v.mp4" })).toEqual({
      ok: false,
      refusal: { code: "video_unreadable", message: expect.any(String) },
    })
  })
})
