/**
 * Real-ffmpeg check for the Video Depth grayscale pass (`grayscaleVideo`).
 *
 * The Replicate depth model can return a clip with an odd width or height.
 * libx264 refuses 4:2:0 at an odd size, so the pass must round the frame to
 * even dimensions — otherwise the job fails after the provider was paid.
 * Only `downloadFile` is replaced (it copies a local lavfi fixture); ffmpeg is
 * the real binary. Skips cleanly where ffmpeg is not installed, like the other
 * `.e2e.test.ts` files here.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async (src: string, dest: string) => {
      copyFileSync(src, dest)
    },
  }
})

import { grayscaleVideo } from "../grayscale-video.js"
import { cleanupWorkDir } from "../ffmpeg-utils.js"

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ffmpegAvailable = isFfmpegAvailable()

function videoStream(path: string): { width: number; height: number; pixFmt: string } {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt", "-of", "csv=p=0", path], { encoding: "utf8" })
  const [w, h, pixFmt] = r.stdout.trim().split(",")
  return { width: Number(w), height: Number(h), pixFmt: pixFmt ?? "" }
}

describe.skipIf(!ffmpegAvailable)("grayscaleVideo (real ffmpeg)", () => {
  let dir: string
  let oddClip: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "grayscale-video-"))
    oddClip = join(dir, "odd-321x181.mkv")
    // RGB + lossless FFV1 keeps the odd size (a 4:2:0 source or libx264 would
    // round it); the pass must still produce an even-sized 4:2:0 file.
    const r = spawnSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=s=321x181:r=10:d=1,format=rgb24",
      "-c:v", "ffv1", oddClip,
    ], { encoding: "utf8" })
    if (r.status !== 0) throw new Error(`ffmpeg fixture gen failed: ${r.stderr}`)
    expect(videoStream(oddClip)).toMatchObject({ width: 321, height: 181 })
  }, 60_000)

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("renders a 321x181 clip as an even-sized 4:2:0 grayscale video", async () => {
    const { outputPath, workDir } = await grayscaleVideo(oddClip)
    try {
      expect(existsSync(outputPath)).toBe(true)
      expect(videoStream(outputPath)).toEqual({ width: 320, height: 180, pixFmt: "yuv420p" })
    } finally {
      await cleanupWorkDir(workDir)
    }
  }, 60_000)
})
