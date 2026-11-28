// @test-reads-none pure argument builders; reads no file
import { describe, expect, it } from "vitest"
import { editingSourceEncodeArgs, EDITING_SOURCE_PICTURE_ARGS, PREVIEW_SEC_PER_4K_SEC, previewEncodeArgs } from "../browser-safe-preview.js"
import { extendStitchArgs, stitchEncodesAtBitRate, stitchKeepsTenBit, type ExtendStitchEncode } from "../extend-stitch-args.js"
import { HEVC10_MAX_TIMEOUT_MS, HEVC10_SEC_PER_4K_SEC, hevc10PictureArgs, hevc10TimeoutMs, isTenBitOrMore } from "../hevc10-encode.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "../ffmpeg-timeouts.js"
import type { MatchedProbe } from "../matched-encode.js"

const HLG: MatchedProbe = {
  videoCodec: "hevc", pixFmt: "yuv420p10le", width: 1920, height: 1080, durationSec: 5, nominalFpsRational: "30/1", fpsRational: "30/1",
  colorPrimaries: "bt2020", colorTransfer: "arib-std-b67", colorSpace: "bt2020nc", colorRange: "tv",
}
const PQ: MatchedProbe = { ...HLG, colorTransfer: "smpte2084" }
const SDR10: MatchedProbe = { ...HLG, colorPrimaries: "bt709", colorTransfer: "bt709", colorSpace: "bt709" }
const SDR8: MatchedProbe = { ...SDR10, videoCodec: "h264", pixFmt: "yuv420p", videoBitRate: 8_000_000 }

const valueOf = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

describe("an editing step's source is the preview's own chain at a higher quality (decided 2026-11-22)", () => {
  it("differs from the preview's arguments only in the picture codec's quality options", () => {
    for (const probe of [HLG, SDR10, { ...SDR10, width: 853 }]) {
      const preview = previewEncodeArgs("in", "out", probe)
      const source = editingSourceEncodeArgs("in", "out", probe)
      // The same filter (an HLG / PQ tone map, the even crop), colour tags, sound and layout.
      expect(valueOf(source, "-vf")).toBe(valueOf(preview, "-vf"))
      const strip = (args: string[], quality: readonly string[]) => args.join(" ").replace(quality.join(" "), "<quality>")
      expect(strip(source, EDITING_SOURCE_PICTURE_ARGS)).toBe(strip(preview, ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23"]))
    }
  })

  it("is the working copy's near-lossless 8-bit H.264 in 4:2:0", () => {
    expect(EDITING_SOURCE_PICTURE_ARGS).toEqual(["-c:v", "libx264", "-preset", "fast", "-crf", "6", "-maxrate", "50M", "-bufsize", "100M", "-pix_fmt", "yuv420p"])
  })
})

describe("the 10-bit HEVC encode the finishing steps share", () => {
  it("is x265 10-bit, hvc1, CRF 20, with the source's colour in the tags and the stream", () => {
    expect(hevc10PictureArgs(HLG)).toEqual([
      "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-preset", "fast", "-crf", "20",
      "-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-color_range", "tv",
      "-x265-params", "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
    ])
  })

  it("is given twice the preview's time per second of 4K, inside the default and its maximum", () => {
    expect(HEVC10_SEC_PER_4K_SEC).toBe(2 * PREVIEW_SEC_PER_4K_SEC)
    expect(hevc10TimeoutMs(5, { width: 1920, height: 1080 })).toBe(DEFAULT_FFMPEG_TIMEOUT_MS)
    expect(hevc10TimeoutMs(20, { width: 3840, height: 2160 })).toBe(Math.max(DEFAULT_FFMPEG_TIMEOUT_MS, 20 * 30 * 1000))
    expect(hevc10TimeoutMs(300, { width: 3840, height: 2160 })).toBe(HEVC10_MAX_TIMEOUT_MS)
    expect(hevc10TimeoutMs(undefined, {})).toBe(HEVC10_MAX_TIMEOUT_MS)
  })

  it("reads 10-bit and deeper pixel formats", () => {
    for (const f of ["yuv420p10le", "yuv422p10le", "yuv444p12le", "p010le", "yuv420p10be"]) expect(isTenBitOrMore({ pixFmt: f }), f).toBe(true)
    for (const f of ["yuv420p", "yuvj420p", "yuv444p", "nv12", undefined]) expect(isTenBitOrMore({ pixFmt: f }), String(f)).toBe(false)
  })
})

describe("the Extend join keeps 10-bit when both clips are 10-bit (decided 2026-11-22)", () => {
  it("only for two 10-bit pictures of one dynamic range, on a run that keeps them", () => {
    expect(stitchKeepsTenBit(SDR10, SDR10, true)).toBe(true)
    expect(stitchKeepsTenBit(HLG, HLG, true)).toBe(true)
    expect(stitchKeepsTenBit(SDR10, SDR10, false)).toBe(false)
    expect(stitchKeepsTenBit(SDR10, SDR8, true)).toBe(false)
    expect(stitchKeepsTenBit(SDR8, SDR10, true)).toBe(false)
    expect(stitchKeepsTenBit(HLG, SDR10, true)).toBe(false)
    expect(stitchKeepsTenBit(HLG, PQ, true)).toBe(false)
  })

  const encode = (source: MatchedProbe, tenBit: boolean): ExtendStitchEncode => ({
    sourcePath: "s.mp4", extensionPath: "e.mp4", outputPath: "o.mp4", source,
    sourceFrames: 150, extensionFrames: 150, trimEndFrames: 2, trimStartFrames: 3,
    audioFadeSec: 0.15, sourceHasAudio: true, extensionHasAudio: true,
    ...(tenBit ? { tenBit: true } : {}),
  })

  it("joins in 10-bit HEVC at the source's colour, an HDR pair never tone-mapped, in one pass", () => {
    const args = extendStitchArgs(encode(HLG, true))
    const graph = valueOf(args, "-filter_complex") ?? ""
    expect(graph).not.toContain("tonemap")
    expect(graph).toContain("[sv]")
    expect(graph.match(/format=yuv420p10le/g)?.length).toBe(2)
    expect(args.slice(args.indexOf("-c:v"))).toEqual(expect.arrayContaining(["libx265", "yuv420p10le", "hvc1"]))
    // Every frame as the graph gives it, as the 8-bit delivery's matched encode.
    expect(valueOf(args, "-fps_mode")).toBe("passthrough")
    expect(valueOf(args, "-color_trc")).toBe("arib-std-b67")
    expect(stitchEncodesAtBitRate(SDR8, true)).toBe(false)
  })

  it("takes a full-range 10-bit source to limited range in 10 bits and tags it so", () => {
    const args = extendStitchArgs(encode({ ...SDR10, colorRange: "pc" }, true))
    expect(valueOf(args, "-filter_complex")).toContain("setparams=range=pc,scale=out_range=tv,format=yuv420p10le")
    expect(valueOf(args, "-color_range")).toBe("tv")
  })

  it("every other join is the 8-bit H.264 delivery, exactly as before", () => {
    const before = extendStitchArgs(encode(HLG, false))
    expect(valueOf(before, "-filter_complex")).toContain("tonemap=tonemap=hable")
    expect(before).toContain("libx264")
    expect(before).not.toContain("libx265")
  })
})
