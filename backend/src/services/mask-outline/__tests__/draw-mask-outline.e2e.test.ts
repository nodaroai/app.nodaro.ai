/**
 * Real-ffmpeg e2e for Mask Outline (`drawMaskOutlineVideo`): a mask drawn by
 * Video Mask's own renderer (two people), a gray clip with a sound, one
 * outline per person over part of the clip — decoded back and checked: the
 * clip's exact frame count, size and audio stream kept, each ring in its
 * colour on its frames only, the people themselves untouched. Skipped where
 * no ffmpeg is installed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { renderMaskVideo } from "../../../providers/video/video-mask.js"
import { grayFrameToRle } from "../../../providers/video/mask-erase.js"
import { drawMaskOutlineVideo, maskOutlineOutputPath } from "../draw-mask-outline.js"

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

/** Every frame of `path`, decoded to RGB. */
function rgbFrames(path: string): Uint8Array[] {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 })
  const size = W * H * 3
  const out: Uint8Array[] = []
  for (let i = 0; i + size <= buf.length; i += size) out.push(buf.subarray(i, i + size))
  return out
}
const at = (f: Uint8Array, x: number, y: number) => Array.from(f.subarray((y * W + x) * 3, (y * W + x) * 3 + 3))
const magenta = ([r, g, b]: number[]) => r! > 170 && g! < 90 && b! > 170
const yellow = ([r, g, b]: number[]) => r! > 170 && g! > 170 && b! < 90
const gray = ([r, g, b]: number[]) => [r, g, b].every((v) => Math.abs(v! - 128) < 24)

describe.skipIf(!ffmpegAvailable)("drawMaskOutlineVideo (real ffmpeg)", () => {
  let dir = ""
  let maskPath = ""
  let videoPath = ""
  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "mask-outline-e2e-"))
    maskPath = join(dir, "mask.mp4")
    videoPath = join(dir, "clip.mp4")
    // Person A left (x 10–21, y 18–29), person B right (x 42–53, y 18–29), on every frame.
    const rle = Array.from({ length: FRAMES }, () => rleOf([[10, 18, 12], [42, 18, 12]]))
    await renderMaskVideo(rle, { width: W, height: H, frameRate: "30/1", durationSec: 1 }, maskPath)
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", `color=c=0x808080:s=${W}x${H}:r=30:d=1`,
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-frames:v", String(FRAMES), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoPath,
    ])
  })
  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  })

  it("rings each person in their colour on their frames, keeping the frame count, size and sound", async () => {
    const work = await fs.mkdtemp(join(dir, "work-"))
    const r = await drawMaskOutlineVideo({
      videoPath,
      maskPath,
      outlines: [
        { colour: "#FF00FF", boxes: [{ fromFrame: 0, toFrame: FRAMES - 1, leftPct: 0, topPct: 0, rightPct: 50, bottomPct: 100 }] },
        { colour: "#FFE600", boxes: [{ fromFrame: 10, toFrame: 19, leftPct: 50, topPct: 0, rightPct: 100, bottomPct: 100 }] },
      ],
      outputPath: maskOutlineOutputPath(work),
    })
    expect(r).toMatchObject({
      width: W,
      height: H,
      frames: FRAMES,
      perOutline: [{ framesDrawn: FRAMES, regionsDrawn: FRAMES }, { framesDrawn: 10, regionsDrawn: 10 }],
      ambiguous: 0,
      strokePx: 3,
    })
    const frames = rgbFrames(r.outputPath)
    expect(frames).toHaveLength(FRAMES)
    const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", r.outputPath]).toString()
    expect(streams).toContain("audio")
    for (let f = 0; f < FRAMES; f++) {
      const frame = frames[f]!
      // A's ring left of A (x 9 the edge, 8–6 the colour): every frame.
      expect(magenta(at(frame, 6, 24)), `A's ring on frame ${f}: ${at(frame, 6, 24)}`).toBe(true)
      // B's ring right of B (x 54 the edge, 55–57 the colour): frames 10–19 only.
      expect(yellow(at(frame, 56, 24)), `B's ring on frame ${f}: ${at(frame, 56, 24)}`).toBe(f >= 10 && f <= 19)
      // The people themselves, and the far background: as filmed.
      expect(gray(at(frame, 15, 24))).toBe(true)
      expect(gray(at(frame, 47, 24))).toBe(true)
      expect(gray(at(frame, 32, 4))).toBe(true)
    }
  }, 60_000)

  it("leaves a person two outlines claim undrawn, and counts them", async () => {
    const work = await fs.mkdtemp(join(dir, "work-"))
    const all = { fromFrame: 0, toFrame: FRAMES - 1, leftPct: 0, topPct: 0, rightPct: 100, bottomPct: 100 }
    const left = { ...all, rightPct: 50 }
    const r = await drawMaskOutlineVideo({
      videoPath,
      maskPath,
      outlines: [{ colour: "#FF00FF", boxes: [all] }, { colour: "#FFE600", boxes: [left] }],
      outputPath: maskOutlineOutputPath(work),
    })
    // A is claimed by both (undrawn); B by the first only.
    expect(r.perOutline).toEqual([{ framesDrawn: FRAMES, regionsDrawn: FRAMES }, { framesDrawn: 0, regionsDrawn: 0 }])
    expect(r.ambiguous).toBe(FRAMES)
    const frames = rgbFrames(r.outputPath)
    expect(gray(at(frames[5]!, 6, 24))).toBe(true)
    expect(magenta(at(frames[5]!, 56, 24))).toBe(true)
  }, 60_000)

  it("reads a mask of another frame count over the same span by TIME, its boxes on the mask's own frames", async () => {
    const work = await fs.mkdtemp(join(dir, "work-"))
    // The mask at 25 fps (25 frames) beside the 30 fps clip (30 frames), both one second.
    const mask25 = join(work, "mask-25.mp4")
    await renderMaskVideo(Array.from({ length: 25 }, () => rleOf([[10, 18, 12], [42, 18, 12]])), { width: W, height: H, frameRate: "25/1", durationSec: 1 }, mask25)
    const r = await drawMaskOutlineVideo({
      videoPath,
      maskPath: mask25,
      // B's box holds on MASK frames 10–14 (0.40–0.56 s): clip frames 12–17 show those mask frames.
      outlines: [{ colour: "#FFE600", boxes: [{ fromFrame: 10, toFrame: 14, leftPct: 50, topPct: 0, rightPct: 100, bottomPct: 100 }] }],
      outputPath: maskOutlineOutputPath(work),
    })
    expect(r.frames).toBe(FRAMES)
    expect(r.perOutline).toEqual([{ framesDrawn: 6, regionsDrawn: 6 }])
    const frames = rgbFrames(r.outputPath)
    expect(frames).toHaveLength(FRAMES)
    for (let f = 0; f < FRAMES; f++) {
      expect(yellow(at(frames[f]!, 56, 24)), `B's ring on clip frame ${f}`).toBe(f >= 12 && f <= 17)
    }
  }, 60_000)

  it("refuses a mask that is not this clip's (another length)", async () => {
    const work = await fs.mkdtemp(join(dir, "work-"))
    const longMask = join(work, "long-mask.mp4")
    const rle = Array.from({ length: 90 }, () => rleOf([[10, 18, 12]]))
    await renderMaskVideo(rle, { width: W, height: H, frameRate: "30/1", durationSec: 3 }, longMask)
    await expect(
      drawMaskOutlineVideo({
        videoPath,
        maskPath: longMask,
        outlines: [{ colour: "#FF00FF", boxes: [{ fromFrame: 0, toFrame: 89, leftPct: 0, topPct: 0, rightPct: 100, bottomPct: 100 }] }],
        outputPath: maskOutlineOutputPath(work),
      }),
    ).rejects.toThrow(/mask outline: .*not this video's mask/)
  }, 60_000)
})
