import { describe, expect, it } from "vitest"
import {
  SIDE_BY_SIDE_LABELS,
  SIDE_BY_SIDE_MAX_PANE_PIXELS,
  canvasOf,
  labelFilter,
  originalFrameSpan,
  paneIsScaled,
  paneOf,
  sideBySideArgs,
  sideBySideBitRate,
  sideBySideEncodesAtBitRate,
  sideBySideLayout,
  type SideBySideEncode,
} from "../side-by-side.js"
import type { MatchedProbe } from "../matched-encode.js"
import { MEASURED_CAMERA } from "../ffmpeg-memory-model.js"

/**
 * The side by side's picture (pure): which layout a shape gets, the cut of
 * the original by frame number, its fit inside the pane, the result's
 * length, sound and quality.
 */
const tall: MatchedProbe = {
  width: 720, height: 1280, videoCodec: "h264", pixFmt: "yuv420p", videoBitRate: 5_910_549,
  audioCodec: "aac", fpsRational: "24/1", nominalFpsRational: "24/1",
  colorSpace: "bt709", colorPrimaries: "bt709", colorTransfer: "bt709", colorRange: "tv",
}
const wide: MatchedProbe = { ...tall, width: 1280, height: 720 }
const original: MatchedProbe = { width: 480, height: 854, videoCodec: "h264", pixFmt: "yuvj420p", fpsRational: "24/1", nominalFpsRational: "24/1" }

const encode = (over: Partial<SideBySideEncode> = {}): SideBySideEncode => ({
  originalPath: "/w/original",
  resultPath: "/w/result",
  outputPath: "/w/out.mp4",
  original,
  result: tall,
  resultFrames: 97,
  startSec: 0,
  lengthSec: 4,
  ...over,
})

const graphOf = (args: string[]): string => args[args.indexOf("-filter_complex") + 1]!

describe("sideBySideLayout", () => {
  it("stacks a picture wider than square and sets a square or taller one side by side", () => {
    expect(sideBySideLayout({ width: 1280, height: 720 })).toBe("stack")
    expect(sideBySideLayout({ width: 720, height: 1280 })).toBe("side")
    expect(sideBySideLayout({ width: 1024, height: 1024 })).toBe("side")
  })

  it("doubles the pane along the layout", () => {
    expect(canvasOf({ width: 1280, height: 720 }, "stack")).toEqual({ width: 1280, height: 1440 })
    expect(canvasOf({ width: 720, height: 1280 }, "side")).toEqual({ width: 1440, height: 1280 })
  })

  it("takes the pane from the result, rounded down to even", () => {
    expect(paneOf({ width: 721, height: 1281 })).toEqual({ width: 720, height: 1280 })
  })
})

describe("originalFrameSpan", () => {
  it("cuts by frame number at the clip's own rate, as the run cut it", () => {
    expect(originalFrameSpan(2, 4, 24)).toEqual({ startFrame: 48, frames: 96 })
    expect(originalFrameSpan(1.02, 4, 30000 / 1001)).toEqual({ startFrame: 31, frames: 120 })
  })
})

describe("labelFilter", () => {
  it("draws a small label in the pane's top start corner, sized from the pane", () => {
    const f = labelFilter(SIDE_BY_SIDE_LABELS.original, { width: 720, height: 1280 })
    expect(f).toContain("text='Original'")
    expect(f).toContain("fontsize=26")
    expect(f).not.toMatch(/fontfile|textfile/)
  })
})

describe("sideBySideArgs", () => {
  it("sets a tall result side by side, the original on the left, its label on each pane", () => {
    const graph = graphOf(sideBySideArgs(encode()))
    expect(graph).toMatch(/^\[0:v:0\]trim=end_frame=96,setpts=PTS-STARTPTS,/)
    expect(graph).toContain("[o][r]hstack=inputs=2:shortest=1[v]")
    expect(graph).toContain("text='Original'")
    expect(graph).toContain("text='Remake'")
  })

  it("stacks a wide result, the original on top", () => {
    expect(graphOf(sideBySideArgs(encode({ result: wide })))).toContain("[o][r]vstack=inputs=2:shortest=1[v]")
  })

  it("fits the original inside the pane (never stretched or cropped) and holds its last frame", () => {
    const graph = graphOf(sideBySideArgs(encode()))
    expect(graph).toContain("scale=720:1280:force_original_aspect_ratio=decrease")
    expect(graph).toContain("pad=720:1280:(ow-iw)/2:(oh-ih)/2")
    expect(graph).toContain("tpad=stop_mode=clone:stop=-1")
  })

  it("puts the original on the result's frame rate and delivers a full-range clip in limited range", () => {
    const graph = graphOf(sideBySideArgs(encode()))
    expect(graph).toContain("fps=24/1")
    expect(graph).toContain("scale=out_range=tv")
  })

  it("seeks half a frame before the stretch's first frame, so that frame is the first one kept", () => {
    const args = sideBySideArgs(encode({ startSec: 2 }))
    // Frame 48 at 24 fps is 2 s; the seek is to 47.5 / 24 s, the cut then counts 96 frames from there.
    expect(args.slice(0, 5)).toEqual(["-y", "-ss", "1.979167", "-i", "/w/original"])
    expect(graphOf(args)).toMatch(/^\[0:v:0\]trim=end_frame=96,/)
  })

  it("does not seek a stretch that starts at the clip's start", () => {
    expect(sideBySideArgs(encode())).not.toContain("-ss")
  })

  it("cuts a clip with no rate by time", () => {
    const graph = graphOf(sideBySideArgs(encode({ original: { ...original, fpsRational: undefined, nominalFpsRational: undefined } })))
    expect(graph).toMatch(/^\[0:v:0\]trim=duration=4,/)
  })

  it("is the result's length (its frames) with its AAC sound copied", () => {
    const args = sideBySideArgs(encode())
    expect(args.join(" ")).toContain("-map 1:a:0 -c:a copy")
    expect(args.join(" ")).toContain("-frames:v 97")
    expect(args[args.indexOf("-t") + 1]).toBe("4.041667")
    expect(args.at(-1)).toBe("/w/out.mp4")
  })

  it("encodes another sound as AAC, and leaves out a sound the result does not have", () => {
    expect(sideBySideArgs(encode({ result: { ...tall, audioCodec: "opus" } })).join(" ")).toContain("-map 1:a:0 -c:a aac")
    expect(sideBySideArgs(encode({ result: { ...tall, audioCodec: undefined } }))).toContain("-an")
  })

  it("encodes at twice the result's picture bitrate, in two passes; pass 1 writes nothing", () => {
    const pass1 = sideBySideArgs(encode({ pass: { n: 1, log: "/w/p" } }))
    const pass2 = sideBySideArgs(encode({ pass: { n: 2, log: "/w/p" } }))
    expect(pass1[pass1.indexOf("-b:v") + 1]).toBe(String(5_910_549 * 2))
    expect(pass1.slice(-3)).toEqual(["-f", "null", "-"])
    expect(pass1).toContain("-an")
    expect(pass2[pass2.indexOf("-pass") + 1]).toBe("2")
    expect(pass2.at(-1)).toBe("/w/out.mp4")
    expect(sideBySideEncodesAtBitRate(tall)).toBe(true)
  })

  it("falls back to the visually lossless constant quality, one pass, when the result's bitrate is unread", () => {
    const result = { ...tall, videoBitRate: undefined }
    expect(sideBySideEncodesAtBitRate(result)).toBe(false)
    expect(sideBySideArgs(encode({ result }))).toContain("-crf")
  })
})

describe("the size bound (a result larger than the picture the memory model was measured on)", () => {
  const uhd: MatchedProbe = { ...wide, width: 3840, height: 2160, videoBitRate: 40_000_000 }

  it("is the measured 1080p picture's pixels, a pane of either shape", () => {
    expect(SIDE_BY_SIDE_MAX_PANE_PIXELS).toBe(MEASURED_CAMERA.width * MEASURED_CAMERA.height)
    expect(paneOf({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 })
    expect(paneOf({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 })
  })

  it("leaves a pane at the bound as it is, and scales one a pixel over it", () => {
    expect(paneIsScaled({ width: 1920, height: 1080 })).toBe(false)
    expect(paneIsScaled({ width: 1920, height: 1081 })).toBe(true)
    const over = paneOf({ width: 1920, height: 1081 })
    expect(over.width * over.height).toBeLessThanOrEqual(SIDE_BY_SIDE_MAX_PANE_PIXELS)
    expect(over.width % 2 + over.height % 2).toBe(0)
  })

  it("scales a 4K result's pane to 1080p, its shape kept, so the canvas is two 1080p pictures", () => {
    expect(paneOf(uhd)).toEqual({ width: 1920, height: 1080 })
    expect(paneOf({ width: 2160, height: 3840 })).toEqual({ width: 1080, height: 1920 })
    const pane = paneOf({ width: 2560, height: 1440 })
    expect(pane.width * pane.height).toBeLessThanOrEqual(SIDE_BY_SIDE_MAX_PANE_PIXELS)
    expect(pane.width / pane.height).toBeCloseTo(16 / 9, 2)
    expect(canvasOf(paneOf(uhd), sideBySideLayout(paneOf(uhd)))).toEqual({ width: 1920, height: 2160 })
  })

  it("draws a larger result scaled down to its pane, and the original fitted inside that pane", () => {
    const graph = graphOf(sideBySideArgs(encode({ result: uhd })))
    expect(graph).toContain("[1:v:0]setpts=PTS-STARTPTS,scale=1920:1080:flags=lanczos,setsar=1,")
    expect(graph).not.toContain("crop=")
    expect(graph).toContain("scale=1920:1080:force_original_aspect_ratio=decrease")
    expect(graph).toContain("[o][r]vstack=inputs=2:shortest=1[v]")
  })

  it("encodes a scaled pane at its share of the doubled bitrate, by area", () => {
    expect(sideBySideBitRate(uhd)).toBe(20_000_000)
    const pass1 = sideBySideArgs(encode({ result: uhd, pass: { n: 1, log: "/w/p" } }))
    expect(pass1[pass1.indexOf("-b:v") + 1]).toBe("20000000")
  })

  it("leaves a result within the bound exactly as before: cropped to even, at twice its bitrate", () => {
    expect(sideBySideBitRate(tall)).toBe(5_910_549 * 2)
    expect(graphOf(sideBySideArgs(encode()))).toContain("[1:v:0]setpts=PTS-STARTPTS,crop=720:1280:0:0,setsar=1,")
    const odd = { ...tall, width: 1079, height: 1919 }
    expect(graphOf(sideBySideArgs(encode({ result: odd })))).toContain("crop=1078:1918:0:0")
  })
})
