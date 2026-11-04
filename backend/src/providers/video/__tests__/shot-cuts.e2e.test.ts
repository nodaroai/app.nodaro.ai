/**
 * Real-ffmpeg e2e for Shot Cuts (`measureShotCuts`): lavfi fixtures through the
 * REAL provider — the scoring decode, the shot list, and the frames decode, each
 * saved frame's colour read back. Only `downloadFile` is replaced (fixture paths
 * are copied in). Skipped where no ffmpeg is installed.
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

import { measureShotCuts } from "../shot-cuts.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { cleanupWorkDir } from "../ffmpeg-utils.js"

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

/** The mean colour of an image, as [r, g, b]. */
function colourOf(path: string): [number, number, number] {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-vf", "scale=1:1:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
  return [buf[0]!, buf[1]!, buf[2]!]
}
const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 60 && b! < 60
const isBlue = ([r, g, b]: number[]) => b! > 200 && r! < 60 && g! < 60
const isGreen = ([r, g, b]: number[]) => g! > 100 && r! < 60 && b! < 60

let dir: string
const at = (name: string) => join(dir, name)

describe.skipIf(!ffmpegAvailable)("measureShotCuts (real ffmpeg)", () => {
  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "shot-cuts-e2e-"))
    // Red 1 s, blue 1.5 s, green 1 s at 24 fps: cuts at frames 24 and 60, 84 frames.
    run([
      "-f", "lavfi", "-i", "color=red:s=160x90:r=24:d=1",
      "-f", "lavfi", "-i", "color=blue:s=160x90:r=24:d=1.5",
      "-f", "lavfi", "-i", "color=green:s=160x90:r=24:d=1",
      "-filter_complex", "[0][1][2]concat=n=3:v=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", at("three.mp4"),
    ])
    run(["-f", "lavfi", "-i", "color=red:s=160x90:r=24:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", at("one.mp4")])
    // 1 801 s at one tiny frame a second: past the 30-minute limit, quick to make.
    run(["-f", "lavfi", "-i", "color=red:s=16x16:r=1:d=1801", "-c:v", "libx264", "-pix_fmt", "yuv420p", at("long.mp4")])
    await fs.writeFile(at("notes.mp4"), "not a video")
  }, 120_000)

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("frames off: the shots with their times, no frames written", async () => {
    const out = await measureShotCuts({ videoUrl: at("three.mp4") })
    try {
      expect(out.cutsSec).toEqual([1, 2.5])
      expect(out.durationSec).toBe(3.5)
      expect(out.shots).toEqual([
        { index: 0, startSec: 0, endSec: 1, durationSec: 1, firstFrame: 0, lastFrame: 23 },
        { index: 1, startSec: 1, endSec: 2.5, durationSec: 1.5, firstFrame: 24, lastFrame: 59 },
        { index: 2, startSec: 2.5, endSec: 3.5, durationSec: 1, firstFrame: 60, lastFrame: 83 },
      ])
      expect(out.framePaths).toBeUndefined()
    } finally {
      await cleanupWorkDir(out.workDir)
    }
  }, 60_000)

  it("frames on: each shot's exact first and last frame — the last red before the blue, the first blue after it", async () => {
    const out = await measureShotCuts({ videoUrl: at("three.mp4"), frames: true })
    try {
      expect([...out.framePaths!.keys()]).toEqual([0, 23, 24, 59, 60, 83])
      const colour = (n: number) => colourOf(out.framePaths!.get(n)!)
      expect(isRed(colour(0)) && isRed(colour(23))).toBe(true)
      expect(isBlue(colour(24)) && isBlue(colour(59))).toBe(true)
      expect(isGreen(colour(60)) && isGreen(colour(83))).toBe(true)
      for (const path of out.framePaths!.values()) expect(path.endsWith(".png")).toBe(true)
    } finally {
      await cleanupWorkDir(out.workDir)
    }
  }, 60_000)

  it("one shot: no cuts, one shot covering the clip; with frames, its first and last frame", async () => {
    const out = await measureShotCuts({ videoUrl: at("one.mp4"), frames: true })
    try {
      expect(out.cutsSec).toEqual([])
      expect(out.shots).toEqual([{ index: 0, startSec: 0, endSec: 2, durationSec: 2, firstFrame: 0, lastFrame: 47 }])
      expect([...out.framePaths!.keys()]).toEqual([0, 47])
    } finally {
      await cleanupWorkDir(out.workDir)
    }
  }, 60_000)

  it("refuses a clip past 30 minutes before decoding it, deterministically", async () => {
    const err = await measureShotCuts({ videoUrl: at("long.mp4") }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/1801 seconds long; Shot Cuts measures clips up to 30 minutes/)
  }, 60_000)

  it("refuses a file that is not a video, deterministically", async () => {
    const err = await measureShotCuts({ videoUrl: at("notes.mp4") }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/not a video that can be read/)
  }, 60_000)
})
