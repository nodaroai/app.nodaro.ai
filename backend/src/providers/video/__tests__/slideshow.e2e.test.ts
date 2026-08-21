/**
 * Real-ffmpeg integration tests for the slideshow provider (`../slideshow.ts`).
 *
 * Same harness as still-to-video.e2e: skipIf when ffmpeg is absent, and a
 * partial mock of ONLY `downloadFile` resolving fixture URLs from local files
 * (safeFetch's SSRF guard stays untouched).
 *
 * The spec's acceptance cases:
 *   1. 5 images + a 30s track, transition: dissolve → output duration within
 *      ONE FRAME of 30s, i.e. no transition ate audio time (asserted on the
 *      VIDEO STREAM — AAC priming inflates container duration).
 *   2. No audio wired → the output has NO audio stream at all.
 * Plus a structural many-segments sanity (12 images, cut/copy path).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { basename, dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { runFfmpeg, runFfprobe, probeMediaDuration } from "../ffmpeg-utils.js"
import { slideshow } from "../slideshow.js"

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    downloadFile: async (url: string, dest: string): Promise<void> => {
      const dir = process.env.SLIDESHOW_E2E_FIXTURE_DIR
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

async function probeVideoStreamDuration(path: string): Promise<number> {
  const out = await runFfprobe([
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=duration", "-of", "csv=p=0", path,
  ])
  return parseFloat(out.trim())
}

async function hasAudioStream(path: string): Promise<boolean> {
  const out = await runFfprobe([
    "-v", "error", "-select_streams", "a",
    "-show_entries", "stream=codec_type", "-of", "csv=p=0", path,
  ])
  return out.trim().length > 0
}

const FIVE = ["a", "b", "c", "d", "e"].map((n) => `https://fixtures.invalid/slide-${n}.png`)

describe.skipIf(!ffmpegAvailable)("slideshow (real ffmpeg)", () => {
  let dir: string
  let audioDuration: number

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "slideshow-test-"))
    process.env.SLIDESHOW_E2E_FIXTURE_DIR = dir

    // 5 distinct tiny stills + one ~30s tone.
    for (const [i, name] of ["a", "b", "c", "d", "e"].entries()) {
      await runFfmpeg([
        "-y",
        "-f", "lavfi", "-i", `color=c=0x${(i + 1) * 30}${(i + 2) * 20}AA:size=640x360`,
        "-frames:v", "1",
        join(dir, `slide-${name}.png`),
      ])
    }
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "sine=frequency=330:duration=30",
      "-c:a", "libmp3lame",
      join(dir, "track-30s.mp3"),
    ])
    audioDuration = await probeMediaDuration(join(dir, "track-30s.mp3"))
  }, 120_000)

  afterAll(async () => {
    delete process.env.SLIDESHOW_E2E_FIXTURE_DIR
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it("5 images + 30s track + dissolve → duration within one frame of the audio (no transition ate it)", async () => {
    const phases: string[] = []
    const result = await slideshow({
      imageUrls: FIVE,
      audioUrl: "https://fixtures.invalid/track-30s.mp3",
      perImageDuration: 3,
      transition: "dissolve",
      transitionDuration: 0.5,
      motion: "none",
      intensity: 3,
      resolution: "720p",
      aspectRatio: "16:9",
      fps: 30,
      fit: "cover",
      padColor: "#000000",
      onProgress: (phase) => { if (!phases.includes(phase)) phases.push(phase) },
    })

    try {
      expect(result.slideCount).toBe(5)
      expect(result.appliedTransition).toBe("dissolve")
      expect(result.silent).toBe(false)
      const videoDuration = await probeVideoStreamDuration(result.outputPath)
      // The spec's bar: within one frame of the audio. Transitions consumed
      // outgoing slides only — the audio was never cropped, the video never
      // ends before it.
      expect(Math.abs(videoDuration - audioDuration)).toBeLessThanOrEqual(1 / 30 + 0.005)
      expect(await hasAudioStream(result.outputPath)).toBe(true)
      // Progress walked the real stages in order.
      expect(phases).toEqual(["segments", "concat", "mux"])
    } finally {
      await fs.rm(dirname(result.outputPath), { recursive: true, force: true }).catch(() => {})
    }
  }, 300_000)

  it("no audio wired → N × perImageDuration and NO audio stream at all", async () => {
    const result = await slideshow({
      imageUrls: FIVE.slice(0, 3),
      perImageDuration: 1,
      transition: "cut",
      transitionDuration: 0.5,
      motion: "none",
      intensity: 3,
      resolution: "720p",
      aspectRatio: "16:9",
      fps: 30,
      fit: "cover",
      padColor: "#000000",
    })
    try {
      expect(result.silent).toBe(true)
      expect(result.durationSeconds).toBeCloseTo(3, 5)
      const videoDuration = await probeVideoStreamDuration(result.outputPath)
      expect(Math.abs(videoDuration - 3)).toBeLessThanOrEqual(1 / 30 + 0.005)
      expect(await hasAudioStream(result.outputPath)).toBe(false)
    } finally {
      await fs.rm(dirname(result.outputPath), { recursive: true, force: true }).catch(() => {})
    }
  }, 120_000)

  it("many segments over the cut/copy path stay exact (12 slides × 0.5s)", async () => {
    const urls = Array.from({ length: 12 }, (_, i) => FIVE[i % 5]!)
    const result = await slideshow({
      imageUrls: urls,
      perImageDuration: 0.5,
      transition: "cut",
      transitionDuration: 0,
      motion: "none",
      intensity: 3,
      resolution: "720p",
      aspectRatio: "16:9",
      fps: 30,
      fit: "cover",
      padColor: "#000000",
    })
    try {
      expect(result.slideCount).toBe(12)
      const videoDuration = await probeVideoStreamDuration(result.outputPath)
      expect(Math.abs(videoDuration - 6)).toBeLessThanOrEqual(1 / 30 + 0.005)
    } finally {
      await fs.rm(dirname(result.outputPath), { recursive: true, force: true }).catch(() => {})
    }
  }, 180_000)
})
