// @test-reads-none reads only the temp clips it makes with ffmpeg
/**
 * A Rhea run's delivery (lib/topaz-rhea-delivery.ts): the engine's file is
 * brought to the frame the run planned. A file with black rows padded below
 * the picture (as the engine returned 720×1284 for a 720×1281 picture) is
 * cropped to the planned even frame in one H.264 encode; a file already at the
 * planned frame is stored as delivered; a file that dropped the sound gets the
 * source's sound back. The download is stubbed; the real ffmpeg cases run only
 * where ffmpeg and ffprobe are on PATH.
 */
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const fetches = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock("../../providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()
  const { copyFile: copy } = await import("node:fs/promises")
  return {
    ...actual,
    // The real encode, its arguments kept for the length-bound case.
    runFfmpeg: vi.fn(actual.runFfmpeg),
    downloadFile: vi.fn(async (url: string, dest: string) => {
      const from = fetches.files.get(url)
      if (!from) throw new Error(`fetch failed: ${url}`)
      await copy(from, dest)
    }),
  }
})

import { runFfmpeg } from "../../providers/video/ffmpeg-utils.js"
import { deliverRheaOutput, rheaCropBitrate, rheaCropFor, rheaFitArgs, MAX_CROP_BITRATE, MIN_CROP_BITRATE } from "../topaz-rhea-delivery.js"
import { rheaExpectedFrame } from "@nodaro/render-rules"

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

describe("the planned frame and the crop rule", () => {
  it("plans source × factor, each side brought down to even", () => {
    expect(rheaExpectedFrame({ width: 480, height: 854 }, 1.5)).toEqual({ width: 720, height: 1280 })
    expect(rheaExpectedFrame({ width: 1280, height: 720 }, 1.5)).toEqual({ width: 1920, height: 1080 })
    expect(rheaExpectedFrame({ width: 1920, height: 1080 }, 2)).toEqual({ width: 3840, height: 2160 })
  })

  it("crops only a side that is larger, never stretches a smaller one, and reads a turned file in its own orientation", () => {
    expect(rheaCropFor({ width: 720, height: 1284 }, { width: 720, height: 1280 })).toEqual({ width: 720, height: 1280 })
    expect(rheaCropFor({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBeUndefined()
    expect(rheaCropFor({ width: 718, height: 1280 }, { width: 720, height: 1280 })).toBeUndefined()
    // Planned portrait, delivered landscape (a rotation tag): the plan is turned, not cropped across.
    expect(rheaCropFor({ width: 1284, height: 720 }, { width: 720, height: 1280 })).toEqual({ width: 1280, height: 720 })
  })

  it("encodes a crop at the engine file's bitrate, within the bounds", () => {
    expect(rheaCropBitrate(5_600_000)).toBe(MIN_CROP_BITRATE)
    expect(rheaCropBitrate(20_000_000)).toBe(20_000_000)
    expect(rheaCropBitrate(500_000_000)).toBe(MAX_CROP_BITRATE)
  })

  it("copies the picture when nothing needs cropping, and lays the source's sound back on, padded and capped at the picture's length", () => {
    expect(rheaFitArgs({ input: "a.mp4", output: "b.mp4", bitrate: 1, soundFrom: "s.mp4", pictureSec: 4.04 })).toEqual([
      "-y", "-i", "a.mp4", "-i", "s.mp4", "-map", "0:v:0", "-c:v", "copy", "-map", "1:a:0", "-af", "apad", "-c:a", "aac", "-b:a", "192k", "-t", "4.04", "-movflags", "+faststart", "b.mp4",
    ])
  })
})

describe.skipIf(!hasFfmpeg)("delivering a real file", () => {
  let dir = ""
  const probe = (file: string): { width: number; height: number; audio: boolean } => {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", file]).toString()
    const streams = (JSON.parse(out) as { streams: Array<{ codec_type: string; width?: number; height?: number }> }).streams
    const v = streams.find((s) => s.codec_type === "video")!
    return { width: v.width!, height: v.height!, audio: streams.some((s) => s.codec_type === "audio") }
  }
  /** The mean luma of the bottom `rows` rows of the first frame (0 = black). */
  const bottomLuma = (file: string, rows: number, height: number): number => {
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-frames:v", "1", "-vf", `crop=iw:${rows}:0:${height - rows},format=gray`, "-f", "rawvideo", "-"])
    return raw.reduce((sum, b) => sum + b, 0) / raw.length
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rhea-delivery-"))
    // The engine's padded file: a grey 720×1281 picture with 3 black rows below it (720×1284), H.264, silent.
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=720x1281:d=1:r=24", "-vf", "pad=720:1284:0:0:black", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", join(dir, "padded.mp4")])
    // An exact file: 1280×720, with sound.
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=1280x720:d=1:r=24", "-f", "lavfi", "-i", "sine=d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", join(dir, "exact.mp4")])
    // A source with sound, for a silent engine file.
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=480x854:d=1:r=24", "-f", "lavfi", "-i", "sine=d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", join(dir, "source.mp4")])
    // A silent 2-second engine file, and a source whose sound is only 0.5 s long.
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=1280x720:d=2:r=24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", join(dir, "long-silent.mp4")])
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=640x360:d=2:r=24", "-f", "lavfi", "-i", "sine=d=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", join(dir, "short-sound.mp4")])
    // A silent 2-second engine file in Matroska, whose video stream states no length of its own.
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:s=1280x720:d=2:r=24", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", join(dir, "no-stream-length.mkv")])
    fetches.files.set("https://engine/no-stream-length.mkv", join(dir, "no-stream-length.mkv"))
    fetches.files.set("https://engine/long-silent.mp4", join(dir, "long-silent.mp4"))
    fetches.files.set("https://src/short-sound.mp4", join(dir, "short-sound.mp4"))
    fetches.files.set("https://engine/not-a-video.mp4", join(dir, "not-a-video.mp4"))
    await writeFile(join(dir, "not-a-video.mp4"), "this is not a video")
    fetches.files.set("https://engine/padded.mp4", join(dir, "padded.mp4"))
    fetches.files.set("https://engine/exact.mp4", join(dir, "exact.mp4"))
    fetches.files.set("https://src/take.mp4", join(dir, "source.mp4"))
  }, 60_000)

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it("crops the padded rows to the planned frame (no black rows left) and lays the source's sound back on", async () => {
    let stored: { width: number; height: number; audio: boolean; luma: number } | undefined
    const result = await deliverRheaOutput({
      outputUrl: "https://engine/padded.mp4",
      expected: rheaExpectedFrame({ width: 480, height: 854 }, 1.5),
      sourceUrl: "https://src/take.mp4",
      jobId: "job-pad",
      store: async (path) => {
        const p = probe(path)
        stored = { ...p, luma: bottomLuma(path, 2, p.height) }
      },
    })
    expect(stored).toMatchObject({ width: 720, height: 1280, audio: true })
    expect(stored!.luma).toBeGreaterThan(80)
    // The frame reported is the stored file's, probed.
    expect(result).toMatchObject({ width: 720, height: 1280 })
  }, 60_000)

  it("stores a file already at the planned frame as delivered (the same file, no encode)", async () => {
    let storedPath = ""
    await deliverRheaOutput({
      outputUrl: "https://engine/exact.mp4",
      expected: { width: 1280, height: 720 },
      sourceUrl: "https://src/take.mp4",
      jobId: "job-exact",
      store: async (path) => { storedPath = path },
    })
    expect(storedPath.endsWith("engine.mp4")).toBe(true)
  }, 60_000)

  it("a sound track shorter than the picture never shortens it: the sound is padded, the file as long as the picture", async () => {
    let seconds = 0
    let audio = false
    await deliverRheaOutput({
      outputUrl: "https://engine/long-silent.mp4",
      expected: { width: 1280, height: 720 },
      sourceUrl: "https://src/short-sound.mp4",
      jobId: "job-short",
      store: async (path) => {
        seconds = Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", path]).toString().trim())
        audio = probe(path).audio
      },
    })
    expect(audio).toBe(true)
    expect(seconds).toBeGreaterThan(1.9)
  }, 60_000)

  it("a picture whose stream states no length is still bounded explicitly (its packets, else the file's length), never by -shortest", async () => {
    vi.mocked(runFfmpeg).mockClear()
    let seconds = 0
    await deliverRheaOutput({
      outputUrl: "https://engine/no-stream-length.mkv",
      expected: { width: 1280, height: 720 },
      sourceUrl: "https://src/short-sound.mp4",
      jobId: "job-mkv",
      store: async (path) => {
        seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).toString().trim())
      },
    })
    const args = vi.mocked(runFfmpeg).mock.calls.at(-1)![0] as string[]
    expect(args).not.toContain("-shortest")
    const t = Number(args[args.indexOf("-t") + 1])
    expect(t).toBeGreaterThan(1.9)
    expect(t).toBeLessThan(2.2)
    expect(seconds).toBeGreaterThan(1.9)
  }, 60_000)

  it("a file that cannot be read as a video is a FINAL failure (the recovery refunds it at once), after the provider: never refunded as a provider failure by the worker", async () => {
    const { isDeterministicJobError } = await import("../deterministic-job-error.js")
    const { isPostProcessingError } = await import("../post-processing-error.js")
    const err = await deliverRheaOutput({ outputUrl: "https://engine/not-a-video.mp4", expected: { width: 720, height: 1280 }, jobId: "job-bad", store: async () => undefined }).catch((e: unknown) => e)
    expect(isPostProcessingError(err)).toBe(true)
    expect(isDeterministicJobError(err)).toBe(true)
  }, 60_000)
})
