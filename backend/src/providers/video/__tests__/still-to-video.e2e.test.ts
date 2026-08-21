/**
 * Real-ffmpeg integration test for still-to-video (`../still-to-video.ts`).
 *
 * Follows the extract-tail.test.ts precedent: a synchronous availability
 * check so a machine without ffmpeg skips cleanly (CI installs ffmpeg via a
 * dedicated step in ci.yml). Like the characterization suite, it partial-mocks
 * ONLY `downloadFile` to resolve fixture URLs from local files — safeFetch's
 * SSRF guard (which rightly blocks loopback/private hosts) stays untouched.
 *
 * The core contract under test: **output duration == the audio's duration,
 * within one frame** — for the cheap path (motion: none) AND the zoompan
 * path (ken-burns), at 1080p 16:9. Duration is asserted on the VIDEO STREAM,
 * not the container: AAC encoder priming/padding inflates format-level
 * duration by ~40-50ms, which is more than one frame at 30fps and would
 * flake the assertion without measuring anything real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { basename, dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { runFfmpeg, runFfprobe, probeMediaDuration } from "../ffmpeg-utils.js"
import { stillToVideo } from "../still-to-video.js"

// Partial mock: fixture "downloads" copy local files; everything else —
// runFfmpeg, runFfprobe, probes, workdir helpers, the FIFO semaphore — is the
// real module. (Mock only the side-effectful member; never weaken safe-fetch.)
vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async (url: string, dest: string): Promise<void> => {
      const dir = process.env.STILL_E2E_FIXTURE_DIR
      if (!dir) throw new Error("fixture dir not set")
      await fs.copyFile(join(dir, basename(new URL(url).pathname)), dest)
    },
  }
})

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const ffmpegAvailable = isFfmpegAvailable()

async function probeVideoStream(path: string): Promise<{ width: number; height: number; durationSeconds: number }> {
  const out = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,duration",
    "-of", "csv=p=0",
    path,
  ])
  const [w, h, d] = out.trim().split(",").map((p) => parseFloat(p.trim()))
  return { width: w!, height: h!, durationSeconds: d! }
}

describe.skipIf(!ffmpegAvailable)("stillToVideo (real ffmpeg)", () => {
  let dir: string
  let audioDuration: number

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "still-to-video-test-"))
    process.env.STILL_E2E_FIXTURE_DIR = dir

    // Fixtures: one 640x360 PNG still + ~1s of sine-tone audio (small source
    // keeps the lanczos-upscale zoompan case fast).
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc=duration=1:size=640x360:rate=1",
      "-frames:v", "1",
      join(dir, "still.png"),
    ])
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1.04",
      "-c:a", "libmp3lame",
      join(dir, "tone.mp3"),
    ])
    // The provider's contract is "duration == the audio's PROBED duration" —
    // mp3 framing rounds the encoded length, so compare against the same
    // probe the provider itself uses.
    audioDuration = await probeMediaDuration(join(dir, "tone.mp3"))
  }, 60_000)

  afterAll(async () => {
    delete process.env.STILL_E2E_FIXTURE_DIR
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  async function renderAndAssert(motion: "none" | "ken-burns"): Promise<number[]> {
    const progress: number[] = []
    const result = await stillToVideo({
      imageUrl: "https://fixtures.invalid/still.png",
      audioUrl: "https://fixtures.invalid/tone.mp3",
      motion,
      intensity: 3,
      resolution: "1080p",
      aspectRatio: "16:9",
      fps: 30,
      fit: "cover",
      padColor: "#000000",
      onProgress: (frame, total) => progress.push(frame / total),
    })

    try {
      expect(result.durationSeconds).toBeCloseTo(audioDuration, 3)
      expect(result.frames).toBe(Math.ceil(audioDuration * 30))

      const stream = await probeVideoStream(result.outputPath)
      expect(stream.width).toBe(1920)
      expect(stream.height).toBe(1080)
      // The spec's acceptance bar: output duration matches the audio within
      // one frame (1/30s), plus a tiny epsilon for timebase rounding.
      expect(Math.abs(stream.durationSeconds - audioDuration)).toBeLessThanOrEqual(1 / 30 + 0.005)
    } finally {
      await fs.rm(dirname(result.outputPath), { recursive: true, force: true }).catch(() => {})
    }
    return progress
  }

  it("motion: none — 1080p 16:9, duration == audio within one frame", async () => {
    await renderAndAssert("none")
  }, 120_000)

  it("motion: ken-burns — zoompan path streams real frame progress, duration == audio within one frame", async () => {
    const progress = await renderAndAssert("ken-burns")
    // -progress pipe:1 streamed at least one real frame count, normalized 0..1.
    expect(progress.length).toBeGreaterThan(0)
    expect(Math.max(...progress)).toBeLessThanOrEqual(1)
  }, 120_000)

  it("fails loudly (not a hang, not a zero-length render) when the audio is unreadable", async () => {
    await fs.writeFile(join(dir, "garbage.mp3"), Buffer.from([0x00, 0x01, 0x02, 0x03]))
    await expect(
      stillToVideo({
        imageUrl: "https://fixtures.invalid/still.png",
        audioUrl: "https://fixtures.invalid/garbage.mp3",
        motion: "none",
        intensity: 3,
        resolution: "1080p",
        aspectRatio: "16:9",
        fps: 30,
        fit: "cover",
        padColor: "#000000",
      }),
    ).rejects.toThrow()
  }, 60_000)
})
