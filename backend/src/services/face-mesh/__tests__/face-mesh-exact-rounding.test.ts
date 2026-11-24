/**
 * Video Face Mesh's colour round trip (draw-face-mesh.ts): the frames drawn on
 * are decoded YUV → RGB and encoded RGB → YUV, and both conversions round
 * exactly (`EXACT_DECODE_FLAGS`, `EXACT_ENCODE_FLAGS`), on the delivery encode
 * and on the working copy alike, so a clip that goes through with nothing
 * drawn keeps its luma mean. With the scaler's defaults the pinned ffmpeg on
 * x86 darkened an in-gamut 4:2:0 clip by 0.52 of a luma level (0.35 on its
 * mid-grey gradient) and arm64 gave other frames; with these flags it moved
 * +0.006 (the gradient not one pixel), the same frames on both. The reads that
 * only decide which faces get lines (the detector's, the mask's) and the
 * depth's colours keep the scaler's defaults. Mask Outline (draw-mask-outline.ts)
 * shares this decode and encode.
 */
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EXACT_DECODE_FLAGS, EXACT_ENCODE_FLAGS, buildFaceMeshEncodeArgs, buildStreamFramesArgs, clipColourOf } from "../draw-face-mesh.js"

const vfOf = (argv: string[]) => argv[argv.indexOf("-vf") + 1]!
const colour = clipColourOf({ color_space: "bt709", color_range: "tv" })
const encode = (workingCopy?: { pixFmt: "yuv420p" | "yuv422p" | "yuv444p" }) =>
  buildFaceMeshEncodeArgs({ width: 1280, height: 720, frameRate: "30/1", audioFrom: "/in.mp4", outputPath: "/out.mp4", colour, ...(workingCopy ? { workingCopy } : {}) })

describe("the exact rounding, in the argv", () => {
  it("exact rounding and full chroma interpolation; chroma repeated on the way up, averaged on the way down", () => {
    expect(EXACT_DECODE_FLAGS).toBe("neighbor+accurate_rnd+full_chroma_int")
    expect(EXACT_ENCODE_FLAGS).toBe("area+accurate_rnd+full_chroma_int")
  })

  it("the decode of the frames drawn on: resized alone first, then converted to RGB with the flags", () => {
    const argv = buildStreamFramesArgs("/in.mp4", { pixFmt: "rgb24", width: 1280, height: 720, colour, exact: true })
    expect(vfOf(argv)).toBe(`scale=1280:720,scale=in_color_matrix=bt709:in_range=tv:flags=${EXACT_DECODE_FLAGS}`)
    expect(argv.slice(argv.indexOf("-pix_fmt"), argv.indexOf("-pix_fmt") + 2)).toEqual(["-pix_fmt", "rgb24"])
  })

  it("the encode: on the scale that converts back to YUV, delivery and working copy alike", () => {
    const pinned = new RegExp(`^scale=out_color_matrix=bt709:out_range=tv:flags=${EXACT_ENCODE_FLAGS.replaceAll("+", "\\+")},format=yuv4(20|44)p,setparams=`)
    for (const argv of [encode(), encode({ pixFmt: "yuv420p" }), encode({ pixFmt: "yuv444p" })]) expect(vfOf(argv)).toMatch(pinned)
    expect(vfOf(encode({ pixFmt: "yuv444p" }))).toContain(",format=yuv444p,")
  })

  it("the reads that only decide (detector, mask) and the depth's colours are unchanged", () => {
    expect(vfOf(buildStreamFramesArgs("/in.mp4", { pixFmt: "bgr24", width: 960, height: 540 }))).toBe("scale=960:540")
    expect(vfOf(buildStreamFramesArgs("/m.mp4", { pixFmt: "gray", width: 960, height: 540 }))).toBe("scale=960:540")
    expect(vfOf(buildStreamFramesArgs("/d.mp4", { pixFmt: "rgb24", width: 480, height: 270, colour }))).toBe("scale=480:270:in_color_matrix=bt709:in_range=tv")
  })
})

describe("the round trip, rendered by the real ffmpeg", () => {
  const ff = (args: string[], input?: Buffer) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 1e9, ...(input ? { input } : {}) })
  /** The luma planes of `file`'s frames, decoded as they are stored. */
  const lumaPlanes = (file: string, w: number, h: number): Uint8Array[] => {
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "extractplanes=y", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], { maxBuffer: 1e9 })
    return Array.from({ length: raw.length / (w * h) }, (_, f) => raw.subarray(f * w * h, (f + 1) * w * h))
  }
  const W = 640, H = 360, N = 12

  it.each(["yuv420p", "yuv444p"] as const)("a %s clip with nothing drawn keeps its luma mean, and its grey gradient every pixel (lossless encode)", async (pixFmt) => {
    const dir = await mkdtemp(join(tmpdir(), "face-mesh-rounding-"))
    try {
      // An in-gamut picture (made in RGB, converted exactly), its right half a mid-grey gradient; limited BT.709.
      const src = join(dir, "src.mp4"), out = join(dir, "out.mp4")
      const half = `s=${W / 2}x${H}:r=24`
      ff(["-filter_complex", `testsrc2=${half},format=rgb24[a];nullsrc=${half},format=gray,geq=lum=96+64*X/W,format=rgb24[b];[a][b]hstack,scale=out_color_matrix=bt709:out_range=tv:flags=${EXACT_ENCODE_FLAGS},format=${pixFmt}`,
        "-frames:v", String(N), "-c:v", "libx264", "-qp", "0", "-pix_fmt", pixFmt, "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", src])
      const rgb = ff(buildStreamFramesArgs(src, { pixFmt: "rgb24", width: W, height: H, colour, exact: true }))
      // The working copy's argv in the clip's format, its quality made lossless so only the conversions are measured.
      const argv = buildFaceMeshEncodeArgs({ width: W, height: H, frameRate: "24/1", audioFrom: src, outputPath: out, colour, workingCopy: { pixFmt } })
      argv.splice(argv.indexOf("-crf"), 2, "-qp", "0")
      ff(argv.slice(1), rgb)
      const before = lumaPlanes(src, W, H), after = lumaPlanes(out, W, H)
      expect(after).toHaveLength(N)
      let shift = 0, greyMoved = 0
      for (let f = 0; f < N; f++) {
        for (let i = 0; i < W * H; i++) {
          const d = after[f]![i]! - before[f]![i]!
          shift += d
          if (d !== 0 && i % W >= W / 2) greyMoved++
        }
      }
      expect(Math.abs(shift / (N * W * H))).toBeLessThan(0.05)
      expect(greyMoved).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
