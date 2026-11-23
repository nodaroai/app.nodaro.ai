/**
 * Real-ffmpeg e2e for the face grow: a synthetic clip (a skin-coloured face
 * with a neck below, skin above its top, dark hair beside it, a green ground),
 * its face mask drawn by Video Mask's own renderer, then
 *   - `growFaceMaskVideo`: the grown mask decoded back frame for frame — the
 *     same size and frame count, the neck covered, nothing above the face's
 *     top, the hair beyond the edge band left as filmed;
 *   - `maskComposite` (blur fill) with `faceGrowPct`: the render reads the
 *     grown mask (`faceGrow` answered, the neck blurred), and without it the
 *     render is exactly as before (no `faceGrow`).
 * Only `downloadFile` is replaced (the fixture path is copied in). Skipped
 * where no ffmpeg is installed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return { ...actual, downloadFile: async (url: string, dest: string) => { await fs.copyFile(url, dest) } }
})

import { resolveMaskCompositeSettings } from "@nodaro/shared/media"
import { buildNormaliseArgs, countVideoFrames, planVideoMaskSource, renderMaskVideo } from "../video-mask.js"
import { probeVideoOverlayBase } from "../ffmpeg-utils.js"
import { grayFrameToRle } from "../mask-erase.js"
import { growFaceMaskVideo } from "../mask-face-grow-video.js"
import { maskComposite } from "../mask-composite.js"

function has(bin: string): boolean {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ffmpegAvailable = has("ffmpeg") && has("ffprobe")

const W = 96
const H = 96
const FRAMES = 12
const FACE = { x0: 36, y0: 30, x1: 60, y1: 60 } // 30 rows tall
type RGB = readonly [number, number, number]

function paint(rgb: Uint8Array, r: { x0: number; y0: number; x1: number; y1: number }, c: RGB): void {
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) rgb.set(c, 3 * (y * W + x))
}

function sceneFrame(): Uint8Array {
  const rgb = new Uint8Array(W * H * 3)
  paint(rgb, { x0: 0, y0: 0, x1: W, y1: H }, [60, 120, 70])
  paint(rgb, { x0: 36, y0: 10, x1: 60, y1: 30 }, [214, 160, 130]) // the forehead, above the mask
  paint(rgb, { x0: 40, y0: 60, x1: 56, y1: H }, [214, 160, 130]) // the neck
  paint(rgb, { x0: 18, y0: 10, x1: 36, y1: 72 }, [58, 40, 30]) // hair at the left
  paint(rgb, { x0: 60, y0: 10, x1: 78, y1: 72 }, [58, 40, 30]) // hair at the right
  paint(rgb, FACE, [214, 160, 130])
  return rgb
}

function grayFrames(path: string): Uint8Array[] {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 64 * 1024 * 1024 })
  const out: Uint8Array[] = []
  for (let i = 0; i + W * H <= buf.length; i += W * H) out.push(buf.subarray(i, i + W * H))
  return out
}
const white = (f: Uint8Array, x: number, y: number) => f[y * W + x]! >= 128

describe.skipIf(!ffmpegAvailable)("the face grow over real videos", () => {
  let dir: string
  let clipPath: string
  let maskPath: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "face-grow-e2e-"))
    clipPath = join(dir, "clip.mp4")
    maskPath = join(dir, "mask.mp4")
    const raw = join(dir, "clip.rgb")
    const frame = sceneFrame()
    await fs.writeFile(raw, Buffer.concat(Array.from({ length: FRAMES }, () => Buffer.from(frame))))
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-framerate", "12", "-i", raw, "-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p", clipPath])
    const m = new Uint8Array(W * H)
    for (let y = FACE.y0; y < FACE.y1; y++) m.fill(255, y * W + FACE.x0, y * W + FACE.x1)
    await renderMaskVideo(Array.from({ length: FRAMES }, () => grayFrameToRle(m)), { width: W, height: H, frameRate: "12/1", durationSec: 1 }, maskPath)
  }, 60_000)

  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  })

  it("grows the mask onto the neck, never above the face's top, never onto the hair beyond the edge band; frame count kept", async () => {
    const work = await fs.mkdtemp(join(dir, "grow-"))
    const { outputPath, stats } = await growFaceMaskVideo({ maskPath, clipPath, workDir: work, growPct: 20 })
    expect(stats).toMatchObject({ growPct: 20, frames: FRAMES, grownFrames: FRAMES })
    expect(stats.areaRatio).toBeGreaterThan(1)
    const frames = grayFrames(outputPath)
    expect(frames).toHaveLength(FRAMES)
    for (const f of frames) {
      expect(white(f, 47, FACE.y1 + 3)).toBe(true) // the neck
      expect(white(f, 47, FACE.y0 - 2)).toBe(false) // the forehead, above the top
      expect(white(f, FACE.x0 - 5, 45)).toBe(false) // hair, beyond the band
      expect(white(f, 47, 45)).toBe(true) // the face itself
    }
  }, 60_000)

  it("a clip larger than the mask (the mask was drawn on a scaled-down copy): read at the mask's size, grown as at 1:1", async () => {
    const big = join(dir, "clip-2x.mp4")
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", clipPath, "-vf", "scale=192:192:flags=neighbor", "-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p", big])
    const work = await fs.mkdtemp(join(dir, "grow-2x-"))
    const { outputPath, stats } = await growFaceMaskVideo({ maskPath, clipPath: big, workDir: work, growPct: 20 })
    expect(stats).toMatchObject({ frames: FRAMES, grownFrames: FRAMES })
    const f = grayFrames(outputPath)[4]!
    expect(white(f, 47, FACE.y1 + 3)).toBe(true)
    expect(white(f, 47, FACE.y0 - 2)).toBe(false)
    expect(white(f, FACE.x0 - 5, 45)).toBe(false)
  }, 60_000)

  it("a variable-rate clip: read re-timed exactly as Video Mask normalised it, one clip frame for every mask frame", async () => {
    const vfr = join(dir, "clip-vfr.mp4")
    // Frames after the sixth twice as far apart: the average rate (9.6) is not the nominal (12), so Video Mask re-times it.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", clipPath, "-vf", "setpts='if(lt(N,6),N/(12*TB),(N*2-6)/(12*TB))'", "-fps_mode", "vfr", "-c:v", "libx264", "-crf", "8", "-pix_fmt", "yuv420p", vfr])
    const plan = planVideoMaskSource(await probeVideoOverlayBase(vfr))
    expect(plan?.fps).toBe(30)
    // The mask Video Mask would draw: one frame for every frame of the normalised clip, at its rate.
    const normalised = join(dir, "clip-vfr-normalised.mp4")
    execFileSync("ffmpeg", buildNormaliseArgs(vfr, normalised, plan!))
    const frames = (await countVideoFrames(normalised))!
    const vfrMask = join(dir, "mask-vfr.mp4")
    const m = new Uint8Array(W * H)
    for (let y = FACE.y0; y < FACE.y1; y++) m.fill(255, y * W + FACE.x0, y * W + FACE.x1)
    await renderMaskVideo(Array.from({ length: frames }, () => grayFrameToRle(m)), { width: W, height: H, frameRate: "30/1", durationSec: frames / 30 }, vfrMask)
    const work = await fs.mkdtemp(join(dir, "grow-vfr-"))
    const { outputPath, stats } = await growFaceMaskVideo({ maskPath: vfrMask, clipPath: vfr, workDir: work, growPct: 20 })
    // Every mask frame found its clip frame (a frame short would be kept unscaled, and not count as grown).
    expect(stats).toMatchObject({ frames, grownFrames: frames })
    expect(grayFrames(outputPath)).toHaveLength(frames)
  }, 60_000)

  it("a blur composite with faceGrowPct renders the grown mask and says so; without it, as before", async () => {
    const settings = resolveMaskCompositeSettings({ fill: "blur", blurStrengthPct: 5 })
    const grown = await maskComposite({ backgroundUrl: clipPath, maskUrl: maskPath, settings, billedUnits: 1, faceGrowPct: 20 })
    const plain = await maskComposite({ backgroundUrl: clipPath, maskUrl: maskPath, settings, billedUnits: 1 })
    expect(grown.faceGrow).toMatchObject({ growPct: 20, frames: FRAMES })
    expect(plain.faceGrow).toBeUndefined()
    const g = grayFrames(grown.outputPath)
    const p = grayFrames(plain.outputPath)
    expect(g).toHaveLength(p.length)
    // At the neck just under the chin, the grown render differs from the plain one (blurred there), above the top it does not.
    const at = (frames: Uint8Array[], x: number, y: number) => frames[5]![y * W + x]!
    expect(Math.abs(at(g, 41, FACE.y1 + 4) - at(p, 41, FACE.y1 + 4))).toBeGreaterThan(3)
    expect(Math.abs(at(g, 47, 12) - at(p, 47, 12))).toBeLessThanOrEqual(3)
  }, 60_000)
})
