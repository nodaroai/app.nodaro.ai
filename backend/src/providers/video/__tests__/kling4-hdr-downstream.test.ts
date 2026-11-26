// @test-reads-none pure argument builders; reads no file
import { describe, expect, it, vi } from "vitest"

vi.mock("../ffmpeg-threads.js", async (orig) => ({
  ...(await orig<object>()),
  ffmpegEffectiveThreads: () => ({ decode: 2, filter: 2, encode: 2 }),
}))

import { PREVIEW_MAX_TIMEOUT_MS, previewChangesFile, previewEncodeArgs, previewTimeoutMs } from "../browser-safe-preview.js"
import { deliveredPictureFilter, isHdr } from "../extend-stitch-args.js"
import type { MatchedProbe } from "../matched-encode.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "../ffmpeg-timeouts.js"
import { mergeVideoStreamArgs } from "../merge-video-audio.js"
import { loopCutPictureArgs, loopCutTimeoutMs } from "../smart-loop-cut.js"
import { STALE_THRESHOLD_MS } from "../../../lib/reconcile/types.js"
import { BROWSER_SAFE_VIDEO_ARGS } from "../ffmpeg-utils.js"

/**
 * A Kling 4.0 HDR clip as the provider delivers it (the 2026-11-22 sample:
 * HEVC Main 10, yuv420p10le, BT.2020 / bt2020nc, HLG `arib-std-b67`), at 1080p
 * and at 4K, and its 4K SDR clip (H.264 8-bit). The stored original keeps the
 * HDR file; the preview, and every editing step that reads the picture through
 * the delivered-picture chain, is tone-mapped to SDR BT.709 (decided
 * 2026-11-22: HDR is kept in the download, editing nodes produce SDR). Nothing
 * here adds ffmpeg work: it holds the existing path to the Kling file.
 */
const KLING_HDR_1080P: MatchedProbe = {
  videoCodec: "hevc", pixFmt: "yuv420p10le", width: 1920, height: 1080, durationSec: 3,
  colorPrimaries: "bt2020", colorTransfer: "arib-std-b67", colorSpace: "bt2020nc", colorRange: "tv",
}
const KLING_HDR_4K: MatchedProbe = { ...KLING_HDR_1080P, width: 3840, height: 2160, durationSec: 30 }
const KLING_SDR_4K: MatchedProbe = { videoCodec: "h264", pixFmt: "yuv420p", width: 3840, height: 2160, durationSec: 5 }

const valueOf = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

describe("a Kling 4.0 HDR clip downstream", () => {
  it("is read as HDR and gets a preview copy beside its original, at both HDR sizes", () => {
    for (const probe of [KLING_HDR_1080P, KLING_HDR_4K]) {
      expect(isHdr(probe)).toBe(true)
      expect(previewChangesFile(probe)).toBe(true)
    }
  })

  it("its preview is tone-mapped to 8-bit SDR BT.709 and tagged so", () => {
    for (const probe of [KLING_HDR_1080P, KLING_HDR_4K]) {
      const args = previewEncodeArgs("in.mp4", "out.mp4", probe)
      const vf = valueOf(args, "-vf") ?? ""
      expect(vf).toContain("color_trc=arib-std-b67")
      expect(vf).toContain("color_primaries=bt2020")
      expect(vf).toContain("tonemap=tonemap=hable")
      expect(valueOf(args, "-pix_fmt")).toBe("yuv420p")
      expect(valueOf(args, "-color_trc")).toBe("bt709")
      expect(valueOf(args, "-colorspace")).toBe("bt709")
    }
  })

  it("an editing step's delivered picture is the same SDR tone map", () => {
    const filter = deliveredPictureFilter(KLING_HDR_4K) ?? ""
    expect(filter).toContain("zscale=t=linear:npl=100")
    expect(filter).toContain("tonemap=tonemap=hable")
    expect(filter).toContain("zscale=t=bt709:m=bt709:r=tv")
  })

  it("a 30 s 4K HDR preview gets its time scaled by length, inside the maximum", () => {
    // 15 s per second of 4K picture, never below the default ffmpeg ceiling.
    const ms = previewTimeoutMs(KLING_HDR_4K)
    expect(ms).toBe(Math.max(DEFAULT_FFMPEG_TIMEOUT_MS, 30 * 15 * 1000))
    expect(ms).toBeLessThanOrEqual(PREVIEW_MAX_TIMEOUT_MS)
  })
})

describe("a Kling 4.0 4K SDR clip downstream", () => {
  it("is stored as it is (8-bit H.264: no preview copy, no tone map)", () => {
    expect(isHdr(KLING_SDR_4K)).toBe(false)
    expect(previewChangesFile(KLING_SDR_4K)).toBe(false)
    expect(deliveredPictureFilter(KLING_SDR_4K)).toBeUndefined()
  })
})

describe("HDR kept through Generate Video's post-steps (decided 2026-11-25)", () => {
  it("the audio-track merge copies an HDR picture as it is (HEVC tagged hvc1), only the audio encoded", () => {
    expect(mergeVideoStreamArgs({ needsReencode: true, keepHdr: true, probe: KLING_HDR_4K })).toEqual(["-c:v", "copy", "-tag:v", "hvc1"])
  })

  it("the merge is as before for an SDR picture, and for a caller that keeps no HDR", () => {
    expect(mergeVideoStreamArgs({ needsReencode: false, keepHdr: true, probe: KLING_SDR_4K })).toEqual(["-c:v", "copy"])
    expect(mergeVideoStreamArgs({ needsReencode: true, keepHdr: true, probe: { videoCodec: "hevc", pixFmt: "yuv420p10le" } })).toEqual([...BROWSER_SAFE_VIDEO_ARGS])
    expect(mergeVideoStreamArgs({ needsReencode: true, keepHdr: false, probe: KLING_HDR_4K })).toEqual([...BROWSER_SAFE_VIDEO_ARGS])
  })

  it("the precise loop cut re-encodes an HDR source as 10-bit HEVC with its HLG / BT.2020 signalling", () => {
    expect(loopCutPictureArgs(KLING_HDR_1080P)).toEqual([
      "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-preset", "fast", "-crf", "20",
      "-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-color_range", "tv",
      "-x265-params", "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
    ])
  })

  it("a PQ source carries its own transfer into the HEVC stream too", () => {
    const pq: MatchedProbe = { ...KLING_HDR_1080P, colorTransfer: "smpte2084" }
    const args = loopCutPictureArgs(pq)
    expect(args.slice(args.indexOf("-x265-params"))).toEqual(["-x265-params", "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc"])
    expect(args).toContain("smpte2084")
  })

  it("the HDR cut's encode limit fits a 30 s 4K clip inside its recovery kind's 75 minutes; SDR keeps the default", () => {
    expect(loopCutTimeoutMs(KLING_SDR_4K)).toBeUndefined()
    expect(loopCutTimeoutMs(KLING_HDR_4K)).toBe(15 * 60 * 1000)
    expect(loopCutTimeoutMs({ ...KLING_HDR_4K, durationSec: 10 })).toBe(10 * 60 * 1000)
    expect(loopCutTimeoutMs(KLING_HDR_1080P)).toBe(DEFAULT_FFMPEG_TIMEOUT_MS)
    // poll (45) + cut (15) + merge copy (~1) + preview (10) + uploads stays under the kind's 75 min.
    expect(STALE_THRESHOLD_MS["kie-long-video"]).toBe(75 * 60 * 1000)
    expect(45 + 15 + 1 + 10).toBeLessThan(75)
  })

  it("the precise loop cut of an SDR source is byte-identical to before", () => {
    for (const probe of [KLING_SDR_4K, {}, { videoCodec: "hevc", pixFmt: "yuv420p10le", colorTransfer: "bt709" }]) {
      expect(loopCutPictureArgs(probe)).toEqual(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "20"])
    }
  })
})
