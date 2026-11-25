// @test-reads-none pure argument builders; reads no file
import { describe, expect, it, vi } from "vitest"

vi.mock("../ffmpeg-threads.js", async (orig) => ({
  ...(await orig<object>()),
  ffmpegEffectiveThreads: () => ({ decode: 2, filter: 2, encode: 2 }),
}))

import {
  PREVIEW_MAX_TIMEOUT_MS,
  previewChangesFile,
  previewEncodeArgs,
  previewPeakMemoryMiB,
  previewTimeoutMs,
} from "../browser-safe-preview.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "../ffmpeg-timeouts.js"
import type { MatchedProbe } from "../matched-encode.js"

const H264_8BIT: MatchedProbe = { videoCodec: "h264", pixFmt: "yuv420p", width: 1920, height: 1080 }
const HEVC_10BIT_SDR: MatchedProbe = {
  videoCodec: "hevc", pixFmt: "yuv420p10le", width: 3840, height: 2160, durationSec: 4,
  colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709", colorRange: "tv",
}
const HEVC_HLG: MatchedProbe = {
  videoCodec: "hevc", pixFmt: "yuv420p10le", width: 1920, height: 1080, durationSec: 3,
  colorPrimaries: "bt2020", colorTransfer: "arib-std-b67", colorSpace: "bt2020nc",
}

const valueOf = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

describe("the browser-safe preview rule (keyed on the probed file)", () => {
  it("leaves an 8-bit H.264 file as it is", () => {
    expect(previewChangesFile(H264_8BIT)).toBe(false)
  })

  it("changes a 10-bit HEVC file, an HLG one, and a file the probe could not read", () => {
    expect(previewChangesFile(HEVC_10BIT_SDR)).toBe(true)
    expect(previewChangesFile(HEVC_HLG)).toBe(true)
    expect(previewChangesFile({})).toBe(true)
  })
})

describe("previewEncodeArgs", () => {
  it("takes a 10-bit SDR picture plainly to 8-bit H.264, its colour tags kept", () => {
    const args = previewEncodeArgs("in.mp4", "out.mp4", HEVC_10BIT_SDR)
    expect(args).not.toContain("-vf")
    expect(valueOf(args, "-c:v")).toBe("libx264")
    expect(valueOf(args, "-pix_fmt")).toBe("yuv420p")
    expect(valueOf(args, "-crf")).toBe("23")
    expect(valueOf(args, "-color_trc")).toBe("bt709")
    expect(valueOf(args, "-color_primaries")).toBe("bt709")
  })

  it("tone-maps an HLG picture to SDR BT.709 first, and tags it so (never HLG on an 8-bit file)", () => {
    const args = previewEncodeArgs("in.mp4", "out.mp4", HEVC_HLG)
    const vf = valueOf(args, "-vf") ?? ""
    expect(vf).toContain("color_trc=arib-std-b67")
    expect(vf).toContain("tonemap=tonemap=hable")
    expect(vf).toMatch(/zscale=t=bt709:m=bt709:r=tv/)
    expect(valueOf(args, "-color_trc")).toBe("bt709")
    expect(valueOf(args, "-color_primaries")).toBe("bt709")
    expect(valueOf(args, "-colorspace")).toBe("bt709")
    expect(args.join(" ")).not.toContain("-color_trc arib-std-b67")
  })

  it("tone-maps a PQ picture too", () => {
    const vf = valueOf(previewEncodeArgs("in.mp4", "out.mp4", { ...HEVC_HLG, colorTransfer: "smpte2084" }), "-vf") ?? ""
    expect(vf).toContain("tonemap=tonemap=hable")
  })

  it("keeps the caller's CRF (an upscale's 18)", () => {
    expect(valueOf(previewEncodeArgs("in.mp4", "out.mp4", HEVC_10BIT_SDR, "18"), "-crf")).toBe("18")
  })
})

describe("the preview's memory and time are sized for its picture", () => {
  it("reserves the canvas model at 4K, with the tone-map's frames for an HDR picture", () => {
    // 257 + 8.29·(136 + 8.85 + 8.15·2 + 2.9·2) = 1,642 MiB at 2 threads (measured 1,436 on the pinned build).
    expect(previewPeakMemoryMiB(HEVC_10BIT_SDR)).toBe(1642)
    const hdr4k = { ...HEVC_HLG, width: 3840, height: 2160 }
    // + 8.29 MP · 72 for the float frames (measured 1,827 MiB tone-mapped at 2 threads).
    expect(previewPeakMemoryMiB(hdr4k)).toBe(2239)
    // Both far above the default launch estimate.
    expect(previewPeakMemoryMiB(HEVC_10BIT_SDR)).toBeGreaterThan(1000)
  })

  it("assumes 4K for a picture the probe could not size", () => {
    expect(previewPeakMemoryMiB({ videoCodec: "hevc" })).toBe(previewPeakMemoryMiB({ videoCodec: "hevc", width: 3840, height: 2160 }))
  })

  it("gives at least the default ceiling, 15 s per second of 4K beyond it, at most 30 minutes", () => {
    expect(previewTimeoutMs(HEVC_10BIT_SDR)).toBe(DEFAULT_FFMPEG_TIMEOUT_MS)
    expect(previewTimeoutMs({ ...HEVC_10BIT_SDR, durationSec: 60 })).toBe(15 * 60 * 1000)
    expect(previewTimeoutMs({ ...HEVC_10BIT_SDR, durationSec: 600 })).toBe(PREVIEW_MAX_TIMEOUT_MS)
    // A 1080p picture is a quarter of 4K: 60 s of it fits in the default ceiling.
    expect(previewTimeoutMs({ ...HEVC_HLG, durationSec: 60 })).toBe(DEFAULT_FFMPEG_TIMEOUT_MS)
    expect(previewTimeoutMs({ videoCodec: "hevc" })).toBe(PREVIEW_MAX_TIMEOUT_MS)
  })
})
