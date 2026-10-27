/**
 * Upscaling a trend's videos to 1080p: the pure half (ee/lib/trends/upscale.ts).
 *
 * What must hold:
 *  - the resize makes the SHORT side exactly 1080, keeps the aspect and the
 *    orientation, and both sides even (720×1280 → 1080×1920, 1280×720 →
 *    1920×1080, odd sizes rounded to the nearest even long side);
 *  - a video at exactly 1080 on its short side is offered an enhance, one above it nothing;
 *  - an upscale in the making is named by the video it was made from, so it
 *    follows its example through a reorder and stops applying once that video
 *    is replaced or removed.
 */
import { describe, expect, it } from "vitest"
import { trendUpscaleOfferFor } from "@nodaro/render-rules"
import type { TrendExample, TrendUpscaleJob, TrendVersionData } from "../types.js"
import {
  UPSCALE_APPLY_STALE_MS,
  UPSCALE_SHORT_SIDE,
  clampPreviewStart,
  isApplying,
  currentUpscaleTarget,
  offersUpscale,
  pendingUpscaleJobs,
  upscaleSourceOf,
  upscaleTargetSize,
  withUpscaleJob,
  withoutUpscaleJob,
} from "../upscale.js"
import { MAX_UPSCALE_JOBS } from "../schemas.js"

const ex = (n: number, over: Partial<TrendExample> = {}): TrendExample => ({
  videoUrl: `https://cdn.test/trends/t/ex${n}.mp4`,
  width: 720,
  height: 1280,
  durationSec: 10,
  slots: {},
  sourceJobId: `job-${n}`,
  ...over,
})

function data(over: Partial<TrendVersionData> = {}): Pick<TrendVersionData, "source" | "examples" | "upscaleJobs"> {
  return {
    source: { videoUrl: "https://cdn.test/trends/t/src.mp4", durationSec: 12, width: 720, height: 1280 },
    examples: [ex(1), ex(2)],
    ...over,
  }
}

const job = (over: Partial<TrendUpscaleJob> = {}): TrendUpscaleJob => ({
  jobId: "j1",
  target: "example",
  fromUrl: "https://cdn.test/trends/t/ex2.mp4",
  startedAt: "2026-10-25T10:00:00.000Z",
  ...over,
})

describe("upscaleTargetSize", () => {
  it.each([
    [720, 1280, 1080, 1920],
    [1280, 720, 1920, 1080],
    [540, 960, 1080, 1920],
    [1440, 2560, 1080, 1920],
    [720, 720, 1080, 1080],
    // Odd sides: the long side rounded to the nearest even number.
    [721, 1281, 1080, 1918],
    [1281, 721, 1918, 1080],
    [719, 1279, 1080, 1922],
    [480, 853, 1080, 1920],
    // A 4:5 portrait.
    [576, 720, 1080, 1350],
  ])("%i×%i → %i×%i", (w, h, ow, oh) => {
    const out = upscaleTargetSize(w, h)
    expect(out).toEqual({ width: ow, height: oh })
    expect(Math.min(out.width, out.height)).toBe(UPSCALE_SHORT_SIDE)
    expect(out.width % 2).toBe(0)
    expect(out.height % 2).toBe(0)
  })

  it("keeps the aspect within a pixel of rounding", () => {
    for (const [w, h] of [[720, 1280], [853, 480], [1001, 1777], [998, 1503]] as const) {
      const out = upscaleTargetSize(w, h)
      expect(Math.abs(out.width / out.height - w / h)).toBeLessThan(2 / Math.min(out.width, out.height))
    }
  })

  it("refuses a size that is no size", () => {
    expect(() => upscaleTargetSize(0, 720)).toThrow(RangeError)
    expect(() => upscaleTargetSize(720, Number.NaN)).toThrow(RangeError)
  })
})

describe("trendUpscaleOfferFor / offersUpscale", () => {
  it("an upscale below a 1080 short side", () => {
    expect(trendUpscaleOfferFor(720, 1280)).toBe("upscale")
    expect(trendUpscaleOfferFor(1280, 720)).toBe("upscale")
    expect(trendUpscaleOfferFor(1079, 1920)).toBe("upscale")
  })

  it("an enhance at exactly 1080, portrait, landscape or ultra-wide", () => {
    expect(trendUpscaleOfferFor(1080, 1920)).toBe("enhance")
    expect(trendUpscaleOfferFor(1920, 1080)).toBe("enhance")
    expect(trendUpscaleOfferFor(2568, 1080)).toBe("enhance")
    expect(offersUpscale(1920, 1080)).toBe(true)
  })

  it("nothing above 1080: a 1080p target would shrink it", () => {
    expect(trendUpscaleOfferFor(1081, 1920)).toBeNull()
    expect(trendUpscaleOfferFor(2160, 3840)).toBeNull()
    expect(offersUpscale(2160, 3840)).toBe(false)
  })

  it("an upscale when the size is not known", () => {
    expect(trendUpscaleOfferFor(undefined, undefined)).toBe("upscale")
    expect(trendUpscaleOfferFor(1080, undefined)).toBe("upscale")
  })
})

describe("what an upscale is made from and where it applies", () => {
  it("the source's video and size, else its display copy's size; an example's own", () => {
    expect(upscaleSourceOf(data(), { target: "source" })).toEqual({ fromUrl: "https://cdn.test/trends/t/src.mp4", width: 720, height: 1280, durationSec: 12 })
    const display = { videoUrl: "https://cdn.test/trends/t/d.mp4", posterUrl: "https://cdn.test/trends/t/d.png", width: 1080, height: 1920, durationSec: 12 }
    expect(upscaleSourceOf(data({ source: { videoUrl: "https://cdn.test/trends/t/src.mp4", durationSec: 12, display } }), { target: "source" })).toMatchObject({ width: 1080, height: 1920 })
    expect(upscaleSourceOf(data(), { target: "example", index: 1 })).toEqual({ fromUrl: ex(2).videoUrl, width: 720, height: 1280, durationSec: 10 })
    expect(upscaleSourceOf(data(), { target: "example", index: 2 })).toBeNull()
    expect(upscaleSourceOf(data({ source: null }), { target: "source" })).toBeNull()
  })

  it("follows its example through a reorder, and stops applying once the video is replaced or removed", () => {
    expect(currentUpscaleTarget(data(), job())).toEqual({ target: "example", index: 1 })
    expect(currentUpscaleTarget(data({ examples: [ex(2), ex(1)] }), job())).toEqual({ target: "example", index: 0 })
    expect(currentUpscaleTarget(data({ examples: [ex(1)] }), job())).toBeNull()
    expect(currentUpscaleTarget(data({ examples: [ex(1), ex(2, { videoUrl: "https://cdn.test/trends/t/new.mp4" })] }), job())).toBeNull()
    const src = job({ target: "source", fromUrl: "https://cdn.test/trends/t/src.mp4" })
    expect(currentUpscaleTarget(data(), src)).toEqual({ target: "source" })
    expect(currentUpscaleTarget(data({ source: { videoUrl: "https://cdn.test/trends/t/other.mp4", durationSec: 12 } }), src)).toBeNull()
  })

  it("an example's URL never matches the source, nor the source's an example", () => {
    expect(currentUpscaleTarget(data(), job({ target: "source" }))).toBeNull()
    expect(currentUpscaleTarget(data(), job({ target: "example", fromUrl: "https://cdn.test/trends/t/src.mp4" }))).toBeNull()
  })
})

describe("the draft's upscales in the making", () => {
  it("recording keeps one per video (the newer wins) and drops the ones whose video is gone", () => {
    const gone = job({ jobId: "gone", fromUrl: "https://cdn.test/trends/t/removed.mp4" })
    const older = job({ jobId: "older" })
    const src = job({ jobId: "src", target: "source", fromUrl: "https://cdn.test/trends/t/src.mp4" })
    const out = withUpscaleJob(data({ upscaleJobs: [gone, older, src] }), job({ jobId: "newer" }))
    expect(out.map((j) => j.jobId)).toEqual(["src", "newer"])
  })

  it("keeps at most MAX_UPSCALE_JOBS, the oldest dropped", () => {
    const examples = Array.from({ length: MAX_UPSCALE_JOBS + 2 }, (_, i) => ex(i))
    const upscaleJobs = examples.slice(0, MAX_UPSCALE_JOBS).map((e, i) => job({ jobId: `j${i}`, fromUrl: e.videoUrl }))
    const out = withUpscaleJob(data({ examples, upscaleJobs }), job({ jobId: "last", fromUrl: examples.at(-1)!.videoUrl }))
    expect(out).toHaveLength(MAX_UPSCALE_JOBS)
    expect(out[0]!.jobId).toBe("j1")
    expect(out.at(-1)!.jobId).toBe("last")
  })

  it("removing one leaves the key out when none is left", () => {
    expect(withoutUpscaleJob(data({ upscaleJobs: [job()] }), "j1")).not.toHaveProperty("upscaleJobs")
    expect(withoutUpscaleJob(data({ upscaleJobs: [job(), job({ jobId: "j2" })] }), "j1").upscaleJobs).toEqual([job({ jobId: "j2" })])
  })

  it("the editor's view says where each applies now, and which no longer do", () => {
    const views = pendingUpscaleJobs(data({ examples: [ex(2)], upscaleJobs: [job(), job({ jobId: "j2", fromUrl: ex(1).videoUrl })] }))
    expect(views).toEqual([
      { jobId: "j1", target: "example", fromUrl: ex(2).videoUrl, startedAt: job().startedAt, current: true, index: 0 },
      { jobId: "j2", target: "example", fromUrl: ex(1).videoUrl, startedAt: job().startedAt, current: false },
    ])
    expect(pendingUpscaleJobs(data())).toEqual([])
  })
})

describe("an apply in the background", () => {
  const at = Date.parse("2026-10-25T10:00:00.000Z")
  it("runs from its mark until UPSCALE_APPLY_STALE_MS (15 minutes), then may be tried again", () => {
    expect(UPSCALE_APPLY_STALE_MS).toBe(15 * 60 * 1000)
    const j = job({ applying: { startedAt: "2026-10-25T10:00:00.000Z", by: "admin" } })
    expect(isApplying(j, at + 60_000)).toBe(true)
    expect(isApplying(j, at + UPSCALE_APPLY_STALE_MS - 1)).toBe(true)
    expect(isApplying(j, at + UPSCALE_APPLY_STALE_MS)).toBe(false)
    expect(isApplying(job(), at)).toBe(false)
    expect(isApplying(job({ applying: { startedAt: "not a date", by: "admin" } }), at)).toBe(false)
  })

  it("the editor's view carries the mark (and whether it went stale) and the last error", () => {
    const views = pendingUpscaleJobs(
      data({
        upscaleJobs: [
          job({ applying: { startedAt: "2026-10-25T10:00:00.000Z", by: "admin" } }),
          job({ jobId: "j2", target: "source", fromUrl: "https://cdn.test/trends/t/src.mp4", error: { code: "media_busy", message: "Try again.", at: "x" } }),
        ],
      }),
      at + UPSCALE_APPLY_STALE_MS + 1,
    )
    expect(views[0]).toMatchObject({ jobId: "j1", applying: { startedAt: "2026-10-25T10:00:00.000Z", stale: true } })
    expect(views[1]).toMatchObject({ jobId: "j2", current: true, error: { code: "media_busy", message: "Try again." } })
    expect(views[1]).not.toHaveProperty("applying")
  })
})

describe("clampPreviewStart", () => {
  it("keeps the 4 s preview inside the new clip, as the editor does", () => {
    expect(clampPreviewStart(null, 12)).toBeNull()
    expect(clampPreviewStart(2, 12)).toBe(2)
    expect(clampPreviewStart(8, 11.96)).toBeCloseTo(7.96)
    expect(clampPreviewStart(3, 4)).toBe(0)
  })
})
