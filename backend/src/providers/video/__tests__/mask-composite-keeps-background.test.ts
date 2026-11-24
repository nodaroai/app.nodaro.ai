/**
 * Mask Composite never converts the background (mask-composite.ts,
 * `overlayInFormat`): outside the mask, a pixelate or blur fill and a video
 * fill hand back the background's own pixels, bit for bit through a lossless
 * encode, for a 4:2:0 and a 4:4:4 clip, tagged and untagged, on the delivery
 * encode and the working copy. The overlay used to ask for an alpha plane on
 * the background (`format=auto`), and ffmpeg's converter for it went through
 * RGB whenever the inputs' colour tags differed: a blur fill of a tagged clip
 * came back darker everywhere (−1.41 luma levels on the pinned ffmpeg on x86,
 * −0.84 on arm64), its blur 2.7 levels darker too. A conversion that comes back
 * fails here as moved pixels.
 */
import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveMaskCompositeSettings } from "@nodaro/shared/media"
import { buildMaskCompositeArgs, buildMaskCompositeFillArgs } from "../mask-composite.js"

const W = 320, H = 180, N = 8
/** The mask's covered box, and the margin its 1 px feather may reach past it. */
const BOX = { x: 40, y: 40, w: 100, h: 100 }, MARGIN = 8
const TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]

const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { maxBuffer: 1e9 })
/** Every plane of every frame, as stored. */
const planes = (file: string, pixFmt: "yuv420p" | "yuv444p"): Buffer[] => {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", pixFmt, "pipe:1"], { maxBuffer: 1e9 })
  const size = pixFmt === "yuv420p" ? (W * H * 3) / 2 : W * H * 3
  return Array.from({ length: raw.length / size }, (_, f) => raw.subarray(f * size, (f + 1) * size))
}
/** How many samples outside the box (and its margin) differ, over every plane of every frame. */
const movedOutside = (a: Buffer[], b: Buffer[], pixFmt: "yuv420p" | "yuv444p"): number => {
  expect(b).toHaveLength(a.length)
  const sub = pixFmt === "yuv420p" ? 2 : 1
  const inBox = (x: number, y: number, s: number) =>
    x * s >= BOX.x - MARGIN && x * s < BOX.x + BOX.w + MARGIN && y * s >= BOX.y - MARGIN && y * s < BOX.y + BOX.h + MARGIN
  let moved = 0
  for (let f = 0; f < a.length; f++) {
    let at = 0
    for (const [pw, ph, s] of [[W, H, 1], [W / sub, H / sub, sub], [W / sub, H / sub, sub]] as const) {
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++, at++) if (!inBox(x, y, s) && a[f]![at] !== b[f]![at]) moved++
    }
  }
  return moved
}

describe("Mask Composite keeps the background outside the mask (real ffmpeg, lossless encode)", () => {
  const cases = (["yuv420p", "yuv444p"] as const).flatMap((pixFmt) => [true, false].map((tagged) => ({ pixFmt, tagged })))

  it.each(cases)("$pixFmt, tagged $tagged: pixelate, blur and the video fill, delivery and working copy", async ({ pixFmt, tagged }) => {
    const dir = await mkdtemp(join(tmpdir(), "mask-composite-bg-"))
    try {
      const bg = join(dir, "bg.mkv"), fg = join(dir, "fg.mkv"), mask = join(dir, "mask.mkv")
      // An in-gamut picture (made in RGB, converted exactly), lossless.
      ff(["-f", "lavfi", "-i", `testsrc2=s=${W}x${H}:r=30`, "-vf", `format=rgb24,scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=${pixFmt}`,
        "-frames:v", String(N), "-c:v", "ffv1", ...(tagged ? TAGS : []), bg])
      // The video fill's foreground: tagged, as an engine's output is.
      ff(["-f", "lavfi", "-i", `testsrc=s=${W}x${H}:r=30`, "-vf", "format=yuv420p", "-frames:v", String(N), "-c:v", "ffv1", ...TAGS, fg])
      ff(["-f", "lavfi", "-i", `color=black:s=${W}x${H}:r=30`, "-vf", `drawbox=x=${BOX.x}:y=${BOX.y}:w=${BOX.w}:h=${BOX.h}:c=white:t=fill,format=yuv420p`, "-frames:v", String(N), "-c:v", "ffv1", mask])
      const probe = { width: W, height: H, frameRate: "30/1", durationSec: N / 30, startSec: 0, frameCount: N, sar: 1, foregroundHasAudio: false, backgroundHasAudio: false }
      const source = { pixFmt, ...(tagged ? { colorSpace: "bt709", colorPrimaries: "bt709", colorTransfer: "bt709", colorRange: "tv" } : {}) }
      const before = { yuv420p: planes(bg, "yuv420p"), yuv444p: planes(bg, "yuv444p") }
      /** Render `argv` losslessly (its quality made `-qp 0`) and return how many samples moved outside the box. */
      const render = (name: string, argv: string[], outFmt: "yuv420p" | "yuv444p") => {
        const out = join(dir, `${name}.mp4`)
        const at = argv.indexOf("-crf")
        const lossless = [...argv.slice(1, at), "-qp", "0", ...argv.slice(at + 2)].map((a) => (a === "OUT" ? out : a))
        ff(lossless)
        // Only the delivery encode of a 4:4:4 clip changes format (to 4:2:0): compared against the source taken to 4:2:0.
        return movedOutside(before[outFmt], planes(out, outFmt), outFmt)
      }
      const moved: Record<string, number> = {}
      for (const wc of [false, true]) {
        const w = wc ? { workingCopy: source } : {}
        const outFmt = wc ? pixFmt : "yuv420p"
        for (const fill of ["pixelate", "blur"] as const) {
          const settings = resolveMaskCompositeSettings({ fill })
          moved[`${fill} ${wc ? "working copy" : "delivery"}`] = render(`${fill}-${wc}`, buildMaskCompositeFillArgs({ backgroundPath: bg, maskPath: mask, outputPath: "OUT", settings, probe, ...w }), outFmt)
        }
        if (tagged) {
          // The video fill over an untagged background still converts it to the foreground's tags (a separate case).
          moved[`video ${wc ? "working copy" : "delivery"}`] = render(`video-${wc}`, buildMaskCompositeArgs({ foregroundPath: fg, backgroundPath: bg, maskPath: mask, outputPath: "OUT", settings: resolveMaskCompositeSettings({}), probe, ...w }), outFmt)
        }
      }
      expect(moved).toEqual(Object.fromEntries(Object.keys(moved).map((k) => [k, 0])))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
