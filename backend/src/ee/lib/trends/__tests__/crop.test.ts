import { describe, it, expect } from "vitest"
import {
  CROP_STALE_MS,
  cropAspectFor,
  cropEncodeArgs,
  cropFilter,
  cropTargetSize,
  isCropping,
  pendingSourceCrop,
  shownSourceSize,
  withoutSourceCrop,
} from "../crop.js"
import { trendCropCut } from "@nodaro/render-rules"
import type { TrendSourceCrop, TrendVersionData } from "../types.js"

/** Cropping a trend's source clip to 16:9 or 9:16 (../crop.ts): the pure rules. */

describe("cropAspectFor: only the crop that trims", () => {
  it("offers 16:9 to a clip wider than 16:9 and 9:16 to one taller than 9:16", () => {
    expect(cropAspectFor(2568, 1080)).toBe("16:9")
    expect(cropAspectFor(3840, 1080)).toBe("16:9")
    expect(cropAspectFor(1080, 2568)).toBe("9:16")
  })

  it("offers nothing to a clip at 16:9 or 9:16, one a few pixels off, or one in between", () => {
    expect(cropAspectFor(1920, 1080)).toBeNull()
    expect(cropAspectFor(1080, 1920)).toBeNull()
    expect(cropAspectFor(1928, 1080)).toBeNull()
    expect(cropAspectFor(1440, 1080)).toBeNull()
    expect(cropAspectFor(1080, 1080)).toBeNull()
    expect(cropAspectFor(undefined, 1080)).toBeNull()
  })
})

describe("cropTargetSize", () => {
  it("keeps the height for 16:9 and the width for 9:16, both sides even", () => {
    expect(cropTargetSize(2568, 1080, "16:9")).toEqual({ width: 1920, height: 1080 })
    expect(cropTargetSize(1080, 2568, "9:16")).toEqual({ width: 1080, height: 1920 })
    expect(cropTargetSize(2560, 1081, "16:9")).toEqual({ width: 1920, height: 1080 })
    expect(cropTargetSize(721, 2000, "9:16")).toEqual({ width: 720, height: 1280 })
  })
})

describe("trendCropCut: what the trend builder shows the position takes off each side", () => {
  it("splits the cut as the renderer places the frame (its offset even)", () => {
    expect(trendCropCut(2568, 1080, "16:9", 0.5)).toEqual({ before: 324, after: 324 })
    expect(trendCropCut(2568, 1080, "16:9", 0)).toEqual({ before: 0, after: 648 })
    expect(trendCropCut(2568, 1080, "16:9", 1)).toEqual({ before: 648, after: 0 })
    expect(trendCropCut(2568, 1080, "16:9", 0.2)).toEqual({ before: 128, after: 520 })
    expect(trendCropCut(1080, 2568, "9:16", 0.25)).toEqual({ before: 162, after: 486 })
  })

  it("matches the renderer's offset trunc((iw - ow) * p / 2) * 2 for an odd width, and holds the position inside 0–1", () => {
    // 2569 - 1920 = 649 cut; at 0.5 the renderer's x is trunc(649 * 0.5 / 2) * 2 = 324.
    expect(trendCropCut(2569, 1080, "16:9", 0.5)).toEqual({ before: 324, after: 325 })
    expect(trendCropCut(2568, 1080, "16:9", 3)).toEqual({ before: 648, after: 0 })
  })
})

describe("shownSourceSize", () => {
  it("is the display copy's size (its rotation applied), else the clip's own", () => {
    const display = { videoUrl: "https://x/d.mp4", posterUrl: "https://x/d.png", width: 1080, height: 2568, durationSec: 12 }
    expect(shownSourceSize({ videoUrl: "https://x/s.mp4", durationSec: 12, width: 2568, height: 1080, display })).toEqual({ width: 1080, height: 2568 })
    expect(shownSourceSize({ videoUrl: "https://x/s.mp4", durationSec: 12, width: 2568, height: 1080 })).toEqual({ width: 2568, height: 1080 })
    expect(shownSourceSize({ videoUrl: "https://x/s.mp4", durationSec: 12 })).toBeNull()
    expect(shownSourceSize(null)).toBeNull()
  })
})

describe("cropFilter", () => {
  it("keeps the height for 16:9 and places the frame at the position of the cut from the left", () => {
    expect(cropFilter("16:9", 0.5)).toBe("crop=w='trunc(ih*16/9/2)*2':h='trunc(ih/2)*2':x='trunc((iw-ow)*0.5/2)*2':y=0")
    expect(cropFilter("16:9", 0)).toContain("x='trunc((iw-ow)*0/2)*2'")
  })

  it("keeps the width for 9:16 and places it from the top; a position out of 0–1 is held inside", () => {
    expect(cropFilter("9:16", 0.25)).toBe("crop=w='trunc(iw/2)*2':h='trunc(iw*16/9/2)*2':x=0:y='trunc((ih-oh)*0.25/2)*2'")
    expect(cropFilter("9:16", 7)).toContain("y='trunc((ih-oh)*1/2)*2'")
  })
})

describe("cropEncodeArgs: the original's quality", () => {
  it("H.264 at a known bitrate: H.264 at that bitrate, in the pass given, its pixel format and colour tags kept", () => {
    const args = cropEncodeArgs(
      { codec: "h264", pixFmt: "yuv422p", bitRate: 6624434.4, colorSpace: "bt709", colorPrimaries: "bt709", colorTransfer: "bt709", colorRange: "tv" },
      { n: 2, log: "/t/pass" },
    )
    expect(args.join(" ")).toBe(
      "-c:v libx264 -preset medium -b:v 6624434 -pass 2 -passlogfile /t/pass -pix_fmt yuv422p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv",
    )
  })

  it("HEVC stays HEVC (hvc1), its two passes through x265's own parameters, 10-bit kept", () => {
    const args = cropEncodeArgs({ codec: "hevc", pixFmt: "yuv420p10le", bitRate: 8_000_000 }, { n: 1, log: "/t/pass" })
    expect(args.join(" ")).toBe("-c:v libx265 -tag:v hvc1 -preset medium -b:v 8000000 -x265-params pass=1:stats=/t/pass -pix_fmt yuv420p10le")
  })

  it("an unknown bitrate encodes at a visually lossless constant quality, in one pass", () => {
    expect(cropEncodeArgs({ codec: "vp9", pixFmt: "yuv420p" }, { n: 2, log: "/t/pass" }).join(" ")).toBe("-c:v libx264 -preset medium -crf 14 -pix_fmt yuv420p")
  })

  it("a pixel format the encoder cannot keep is yuv420p (10-bit on H.264, JPEG-range yuvj420p is its yuv420p); unknown colour tags are left out", () => {
    expect(cropEncodeArgs({ codec: "h264", pixFmt: "yuv420p10le", bitRate: 1, colorSpace: "unknown" })).toEqual(expect.arrayContaining(["-pix_fmt", "yuv420p"]))
    expect(cropEncodeArgs({ codec: "h264", pixFmt: "yuvj420p", bitRate: 1 })).toEqual(expect.arrayContaining(["-pix_fmt", "yuv420p"]))
    expect(cropEncodeArgs({ codec: "h264", bitRate: 1, colorSpace: "unknown" })).not.toContain("-colorspace")
  })
})

describe("the crop record", () => {
  const SRC = "https://cdn.test/trends/t/src.mp4"
  const crop = (over: Partial<TrendSourceCrop> = {}): TrendSourceCrop => ({
    aspect: "16:9", position: 0.5, fromUrl: SRC, startedAt: new Date(1_000_000).toISOString(), by: "admin", ...over,
  })
  const data = (sourceCrop?: TrendSourceCrop) =>
    ({ source: { videoUrl: SRC, durationSec: 12 }, ...(sourceCrop ? { sourceCrop } : {}) }) as Pick<TrendVersionData, "source" | "sourceCrop">

  it("runs until it fails or goes stale", () => {
    expect(isCropping(crop(), 1_000_000 + 1000)).toBe(true)
    expect(isCropping(crop(), 1_000_000 + CROP_STALE_MS + 1)).toBe(false)
    expect(isCropping(crop({ error: { code: "x", message: "y", at: "z" } }), 1_000_000 + 1000)).toBe(false)
    expect(isCropping(undefined)).toBe(false)
  })

  it("is shown to the editor with its position, whether it is current, running, stale or failed", () => {
    expect(pendingSourceCrop(data(crop({ position: 0.3 })), 1_000_000 + 1000)).toEqual({
      aspect: "16:9", position: 0.3, fromUrl: SRC, startedAt: crop().startedAt, current: true, running: true, stale: false,
    })
    expect(pendingSourceCrop(data(crop()), 1_000_000 + CROP_STALE_MS + 1)).toMatchObject({ running: false, stale: true })
    expect(pendingSourceCrop(data(crop({ fromUrl: "https://cdn.test/old.mp4", error: { code: "c", message: "m", at: "a" } })))).toMatchObject({
      current: false, running: false, stale: false, error: { code: "c", message: "m" },
    })
    expect(pendingSourceCrop(data())).toBeNull()
  })

  it("withoutSourceCrop leaves the key out", () => {
    expect("sourceCrop" in withoutSourceCrop(data(crop()))).toBe(false)
  })
})
