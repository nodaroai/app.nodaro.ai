/**
 * Real-ffmpeg e2e for Mask Erase (`eraseMaskVideo`): a mask drawn by Video
 * Mask's own renderer (two faces), one erased by a box over part of the clip,
 * decoded back and checked frame by frame — same geometry, same frame count,
 * the erased face gone on its frames only, the other kept. Only
 * `downloadFile` is replaced (the fixture path is copied in). Skipped where no
 * ffmpeg is installed.
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

import { renderMaskVideo } from "../video-mask.js"
import { eraseMaskVideo, grayFrameToRle } from "../mask-erase.js"

function has(bin: string): boolean {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ffmpegAvailable = has("ffmpeg") && has("ffprobe")

const W = 64
const H = 48
const FRAMES = 30

/** Video Mask's RLE of a frame with white squares at [x, y, size]. */
function rleOf(squares: Array<[number, number, number]>): string {
  const f = new Uint8Array(W * H)
  for (const [x, y, n] of squares) for (let r = y; r < y + n; r++) f.fill(255, r * W + x, r * W + x + n)
  return grayFrameToRle(f)
}

/** Every frame of `path`, decoded to gray. */
function grayFrames(path: string): Uint8Array[] {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 64 * 1024 * 1024 })
  const out: Uint8Array[] = []
  for (let i = 0; i + W * H <= buf.length; i += W * H) out.push(buf.subarray(i, i + W * H))
  return out
}
/** Whether the square's centre pixel is white. */
const white = (f: Uint8Array, x: number, y: number) => f[y * W + x]! >= 128

describe.skipIf(!ffmpegAvailable)("eraseMaskVideo (real ffmpeg)", () => {
  let dir = ""
  let maskPath = ""
  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "mask-erase-e2e-"))
    maskPath = join(dir, "mask.mp4")
    // Face A top-left, face B bottom-right, on every frame.
    const rle = Array.from({ length: FRAMES }, () => rleOf([[4, 4, 12], [44, 30, 12]]))
    await renderMaskVideo(rle, { width: W, height: H, frameRate: "30/1", durationSec: 1 }, maskPath)
  })
  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  })

  it("drops the face centred in the box on frames 10–19 only, keeping the frame count and the other face", async () => {
    const work = await fs.mkdtemp(join(dir, "work-"))
    const r = await eraseMaskVideo(maskPath, [{ fromFrame: 10, toFrame: 19, leftPct: 50, topPct: 50, rightPct: 100, bottomPct: 100 }], work)
    expect(r).toMatchObject({ width: W, height: H, frames: FRAMES, droppedRegions: 10, kept: true })
    const frames = grayFrames(r.outputPath)
    expect(frames).toHaveLength(FRAMES)
    for (let f = 0; f < FRAMES; f++) {
      expect(white(frames[f]!, 10, 10), `face A on frame ${f}`).toBe(true)
      expect(white(frames[f]!, 50, 36), `face B on frame ${f}`).toBe(f < 10 || f > 19)
    }
  }, 60_000)

  it("draws an all-black mask (kept false) when every face is erased", async () => {
    const work = await fs.mkdtemp(join(dir, "work-"))
    const r = await eraseMaskVideo(maskPath, [{ fromFrame: 0, toFrame: FRAMES - 1, leftPct: 0, topPct: 0, rightPct: 100, bottomPct: 100 }], work)
    expect(r).toMatchObject({ frames: FRAMES, droppedRegions: 2 * FRAMES, kept: false, coveredFraction: 0 })
    expect(grayFrames(r.outputPath)).toHaveLength(FRAMES)
  }, 60_000)
})
