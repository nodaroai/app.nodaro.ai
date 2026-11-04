/**
 * Real-ffmpeg e2e for Split into Chunks' shots mode (`splitMedia` with
 * `mode: "shots"`): lavfi fixtures with known cut frames through the REAL
 * provider — the scoring decode on the source, the encode keyed at the cuts,
 * the copy cut and each part's sound. Every part is measured: its frames, its
 * colour (one shot each) and its sound (never past its picture). Only
 * `downloadFile` is replaced. Skipped where no ffmpeg is installed.
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

import { splitMedia } from "../split-media.js"
import { cleanupWorkDir } from "../ffmpeg-utils.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

function has(bin: string): boolean {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ffmpegAvailable = has("ffmpeg") && has("ffprobe")
const run = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] })
const probe = (args: string[]) => execFileSync("ffprobe", ["-v", "error", ...args]).toString().trim()
const videoFrames = (path: string) => Number(probe(["-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path]))
function decodedSampleCount(path: string): number {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-map", "0:a:0", "-ac", "1", "-f", "s16le", "-"], { maxBuffer: 64 * 1024 * 1024 })
  return Math.floor(buf.byteLength / 2)
}
/** The mean colour of a part's middle frame, as [r, g, b]. */
function colourOf(path: string): [number, number, number] {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-vf", "select=eq(n\\,5),scale=1:1:flags=area", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
  return [buf[0]!, buf[1]!, buf[2]!]
}

describe.skipIf(!ffmpegAvailable)("splitMedia at the shots (real ffmpeg)", () => {
  let dir: string
  const at = (n: string) => join(dir, n)

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "split-shots-e2e-"))
    // Red 1 s, blue 1.5 s, green 1 s at 24 fps (cuts at frames 24 and 60, 84 frames), with a 48 kHz tone.
    run([
      "-f", "lavfi", "-i", "color=red:s=160x90:r=24:d=1",
      "-f", "lavfi", "-i", "color=blue:s=160x90:r=24:d=1.5",
      "-f", "lavfi", "-i", "color=green:s=160x90:r=24:d=1",
      "-f", "lavfi", "-i", "sine=f=440:r=48000:d=3.5",
      "-filter_complex", "[0][1][2]concat=n=3:v=1[v]", "-map", "[v]", "-map", "3:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", at("three.mp4"),
    ])
    run(["-f", "lavfi", "-i", "color=red:s=160x90:r=24:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", at("one.mp4")])
  }, 120_000)

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("one part per shot, frame-exact at the measured cuts, each part one colour, its sound never past its picture", async () => {
    const r = await splitMedia({ videoUrl: at("three.mp4"), mode: "shots" })
    try {
      expect(r.videoPaths).toHaveLength(3)
      expect(r.audioPaths).toBeUndefined()
      expect(r.videoPaths!.map(videoFrames)).toEqual([24, 36, 24])
      expect(r.videoPartDurationsSec).toEqual([1, 1.5, 1])
      expect(r.shots).toEqual([
        { index: 0, startSec: 0, endSec: 1, durationSec: 1 },
        { index: 1, startSec: 1, endSec: 2.5, durationSec: 1.5 },
        { index: 2, startSec: 2.5, endSec: 3.5, durationSec: 1 },
      ])
      const [red, blue, green] = r.videoPaths!.map(colourOf)
      expect(red![0]).toBeGreaterThan(200)
      expect(blue![2]).toBeGreaterThan(200)
      expect(green![1]).toBeGreaterThan(100)
      for (const [i, path] of r.videoPaths!.entries()) {
        const samples = decodedSampleCount(path)
        expect(samples).toBeGreaterThan(0)
        expect(samples / 48000).toBeLessThanOrEqual(r.videoPartDurationsSec![i]! + 1e-9)
      }
    } finally {
      await cleanupWorkDir(r.workDir)
    }
  }, 120_000)

  it("a single shot is a single part (the whole video)", async () => {
    const r = await splitMedia({ videoUrl: at("one.mp4"), mode: "shots" })
    try {
      expect(r.videoPaths).toHaveLength(1)
      expect(videoFrames(r.videoPaths![0]!)).toBe(48)
      expect(r.shots).toEqual([{ index: 0, startSec: 0, endSec: 2, durationSec: 2 }])
    } finally {
      await cleanupWorkDir(r.workDir)
    }
  }, 120_000)

  it("refuses a separate audio input and a missing video, deterministically", async () => {
    const withAudio = await splitMedia({ videoUrl: at("three.mp4"), audioUrl: at("three.mp4"), mode: "shots" }).catch((e: unknown) => e)
    expect(isDeterministicJobError(withAudio)).toBe(true)
    const noVideo = await splitMedia({ audioUrl: at("three.mp4"), mode: "shots" }).catch((e: unknown) => e)
    expect(isDeterministicJobError(noVideo)).toBe(true)
    expect((noVideo as Error).message).toMatch(/needs a video/)
  })
})
