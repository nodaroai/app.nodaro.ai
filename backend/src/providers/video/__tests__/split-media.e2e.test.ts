/**
 * Real-ffmpeg e2e for Split into Chunks (`splitMedia`): lavfi fixtures through
 * the REAL provider, every part measured — frames by decoding (`-count_frames`),
 * sound by decoding to PCM and counting samples. Asserts the product rule: every
 * part in [min, x], frame-exact for a video (its sound never longer than its
 * picture, short by under one AAC frame), sample-exact for a sound file. Only
 * `downloadFile` is replaced (fixture paths are copied in); ffmpeg/ffprobe run
 * for real. Skipped where no ffmpeg is installed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ff = vi.hoisted(() => ({ calls: [] as string[][] }))
vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...actual,
    runFfmpeg: async (...args: Parameters<typeof actual.runFfmpeg>) => {
      ff.calls.push([...args[0]])
      return actual.runFfmpeg(...args)
    },
    downloadFile: async (url: string, dest: string) => {
      await fs.copyFile(url, dest)
    },
  }
})

import { aacWholeFrameSamples, audioSamplesForFrames, cutPointsOf, splitMedia, unitRate, type UnitRate } from "../split-media.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

function has(bin: string, args: string[]): boolean {
  try {
    execFileSync(bin, args, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ffmpegAvailable = has("ffmpeg", ["-version"]) && has("ffprobe", ["-version"])

const run = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] })
const probe = (args: string[]) => execFileSync("ffprobe", ["-v", "error", ...args]).toString().trim()

function videoFrames(path: string): number {
  return Number(probe(["-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path]))
}
function sampleRateOf(path: string): number {
  return Number(probe(["-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", path]))
}
/** The first audio stream decoded to mono s16 — what a player hears, priming and padding resolved. */
function decodedSamples(path: string): Int16Array {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-map", "0:a:0", "-ac", "1", "-f", "s16le", "-"], { maxBuffer: 256 * 1024 * 1024 })
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2))
}
const rms = (s: Int16Array) => Math.sqrt(s.reduce((a, v) => a + v * v, 0) / Math.max(1, s.length))

interface PartRow { part: number; frames?: number; videoSec?: number; samples?: number; audioSec?: number }
const table: Record<string, PartRow[]> = {}

/** Measure every video part against the plan and the rule; returns the rows. */
function checkVideoParts(paths: string[], fps: UnitRate, x: number, min: number, expectFrames: number[], withSound: boolean): PartRow[] {
  expect(paths.map((p) => p.split("/").pop())).toEqual(paths.map((_, i) => `video-part-${String(i).padStart(5, "0")}.mp4`))
  const rows = paths.map((p, i) => {
    const frames = videoFrames(p)
    const videoSec = (frames * fps.den) / fps.num
    const row: PartRow = { part: i, frames, videoSec }
    if (withSound) {
      const sr = sampleRateOf(p)
      const samples = decodedSamples(p).length
      Object.assign(row, { samples, audioSec: samples / sr })
      // exactly the samples under the picture in whole AAC frames — on this
      // decoder AND the pinned one (which decodes AAC-in-MP4 to whole frames)
      const cuts = cutPointsOf(expectFrames)
      const window = audioSamplesForFrames(cuts[i]!, cuts[i + 1]!, fps, sr)
      expect(samples).toBe(aacWholeFrameSamples(window.end - window.start))
      // so never longer than the picture, and short by under one AAC frame (+1 at the seam)
      expect(BigInt(samples) * BigInt(fps.num)).toBeLessThanOrEqual(BigInt(frames) * BigInt(fps.den) * BigInt(sr))
      expect(BigInt(samples + 1024 + 1) * BigInt(fps.num)).toBeGreaterThan(BigInt(frames) * BigInt(fps.den) * BigInt(sr))
    }
    expect(videoSec).toBeLessThanOrEqual(x + 1e-9)
    expect(videoSec).toBeGreaterThanOrEqual(min - 1e-9)
    return row
  })
  expect(rows.map((r) => r.frames)).toEqual(expectFrames)
  return rows
}

describe.skipIf(!ffmpegAvailable)("splitMedia (real ffmpeg)", () => {
  let dir: string
  const fx = {} as Record<"ntsc65" | "ntsc60" | "pal60shift" | "vfr" | "silent" | "tone" | "long5fps" | "short3" | "pipedVideo" | "pipedAudio", string>

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "split-media-e2e-"))
    const p = (n: string) => join(dir, n)
    // 29.97 fps, 65 s, frame-counter picture + 48 kHz tone.
    fx.ntsc65 = p("ntsc65.mp4")
    run(["-f", "lavfi", "-i", "testsrc2=s=320x240:r=30000/1001:d=65", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=65",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", fx.ntsc65])
    // 29.97 fps, 60 s: 1798 frames → the minimum rebalances the tail.
    fx.ntsc60 = p("ntsc60.mp4")
    run(["-f", "lavfi", "-i", "testsrc2=s=320x240:r=30000/1001:d=60", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=60",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", fx.ntsc60])
    // 25 fps, 60 s; the tone (44.1 kHz) starts 0.5 s AFTER the picture.
    fx.pal60shift = p("pal60shift.mp4")
    run(["-f", "lavfi", "-i", "testsrc2=s=320x240:r=25:d=60", "-itsoffset", "0.5", "-f", "lavfi", "-i", "sine=f=440:r=44100:d=59.5",
      "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", fx.pal60shift])
    // Variable frame rate: a 30 fps clock with frames dropped irregularly.
    fx.vfr = p("vfr.mp4")
    run(["-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=20", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=20",
      "-vf", "select='not(mod(n\\,3))+not(mod(n\\,7))'", "-fps_mode", "vfr",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", fx.vfr])
    // No sound at all, 25 fps, 12 s.
    fx.silent = p("silent.mp4")
    run(["-f", "lavfi", "-i", "testsrc2=s=320x240:r=25:d=12", "-c:v", "libx264", "-pix_fmt", "yuv420p", fx.silent])
    // A sound file: 23.5 s, 48 kHz.
    fx.tone = p("tone.wav")
    run(["-f", "lavfi", "-i", "sine=f=330:r=48000:d=23.5", "-c:a", "pcm_s16le", fx.tone])
    // 205 s at 5 fps: 205 one-second parts — over the cap.
    fx.long5fps = p("long5fps.mp4")
    run(["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=5:d=205", "-c:v", "libx264", "-pix_fmt", "yuv420p", fx.long5fps])
    // 3 s: shorter than a 4 s minimum.
    fx.short3 = p("short3.mp4")
    run(["-f", "lavfi", "-i", "testsrc2=s=320x240:r=25:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", fx.short3])
    // Written to a pipe, so the file states NO length (MediaRecorder WebM and
    // streamed Matroska look like this): nothing to refuse on before the encode.
    const piped = (out: string, args: string[]) => fs.writeFile(out, execFileSync("ffmpeg", ["-v", "error", ...args, "pipe:1"], { maxBuffer: 64 * 1024 * 1024 }))
    fx.pipedVideo = p("piped.mkv")
    await piped(fx.pipedVideo, ["-f", "lavfi", "-i", "testsrc2=s=320x240:r=25:d=12", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=12",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "matroska"])
    fx.pipedAudio = p("piped.mka")
    await piped(fx.pipedAudio, ["-f", "lavfi", "-i", "sine=f=440:r=48000:d=7", "-c:a", "flac", "-f", "matroska"])
  }, 120_000)

  afterAll(async () => {
    // The measured table, for a PR or a report: SPLIT_MEDIA_E2E_TABLE=<path>.
    const out = process.env.SPLIT_MEDIA_E2E_TABLE
    if (out) await fs.writeFile(out, JSON.stringify({ ffmpeg: execFileSync("ffmpeg", ["-version"]).toString().split("\n")[0], table }, null, 1))
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it("29.97 fps, 65 s, x = 10: 299 frames × 6 + 154, sound exact under each picture, ONE encode", async () => {
    ff.calls.length = 0
    const r = await splitMedia({ videoUrl: fx.ntsc65, chunkDuration: 10 })
    table.ntsc65 = checkVideoParts(r.videoPaths!, unitRate(30000, 1001), 10, 4, [299, 299, 299, 299, 299, 299, 154], true)
    expect(r.videoPartDurationsSec).toEqual([299, 299, 299, 299, 299, 299, 154].map((f) => (f * 1001) / 30000))
    const encodes = ff.calls.filter((a) => a.includes("libx264"))
    expect(encodes).toHaveLength(1)
    expect(encodes[0]).toContain("fps=fps=30000/1001")
    await fs.rm(r.workDir, { recursive: true, force: true })
  }, 120_000)

  it("29.97 fps, 60 s, x = 10, min 4: the 4-frame tail is rebalanced → 299 × 5, 152, 151", async () => {
    const r = await splitMedia({ videoUrl: fx.ntsc60, chunkDuration: 10, minPartDuration: 4 })
    table.ntsc60 = checkVideoParts(r.videoPaths!, unitRate(30000, 1001), 10, 4, [299, 299, 299, 299, 299, 152, 151], true)
    await fs.rm(r.workDir, { recursive: true, force: true })
  }, 120_000)

  it("25 fps, 60 s, x = 10: exactly 6 × 250 (no empty tail part); the sound keeps its 0.5 s offset", async () => {
    const r = await splitMedia({ videoUrl: fx.pal60shift, chunkDuration: 10 })
    table.pal60shift = checkVideoParts(r.videoPaths!, unitRate(25), 10, 4, [250, 250, 250, 250, 250, 250], true)
    const first = decodedSamples(r.videoPaths![0]!)
    const sr = sampleRateOf(r.videoPaths![0]!)
    expect(rms(first.subarray(0, Math.floor(0.45 * sr)))).toBeLessThan(50)
    expect(rms(first.subarray(Math.floor(0.6 * sr), sr))).toBeGreaterThan(1000)
    await fs.rm(r.workDir, { recursive: true, force: true })
  }, 120_000)

  it("a variable-frame-rate source is normalised to its nominal rate, then cut exactly", async () => {
    const r = await splitMedia({ videoUrl: fx.vfr, chunkDuration: 5, minPartDuration: 2 })
    const fps = unitRate(30)
    const rows = r.videoPaths!.map((p) => videoFrames(p))
    // every part but the rebalanced tail is exactly 150 frames; all within [2 s, 5 s]
    table.vfr = checkVideoParts(r.videoPaths!, fps, 5, 2, rows, true)
    expect(rows.slice(0, -2).every((f) => f === 150)).toBe(true)
    expect(rows.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(590)
    await fs.rm(r.workDir, { recursive: true, force: true })
  }, 120_000)

  it("a soundless video makes picture-only parts", async () => {
    const r = await splitMedia({ videoUrl: fx.silent, chunkDuration: 5, minPartDuration: 0 })
    table.silent = checkVideoParts(r.videoPaths!, unitRate(25), 5, 0, [125, 125, 50], false)
    expect(probe(["-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", r.videoPaths![0]!])).toBe("")
    await fs.rm(r.workDir, { recursive: true, force: true })
  }, 120_000)

  for (const format of ["wav", "mp3"] as const) {
    it(`a sound file, ${format}: parts sample-exact to the partition (23.5 s, x = 5, min 4 → 5, 5, 5, 4.25, 4.25 s)`, async () => {
      const r = await splitMedia({ audioUrl: fx.tone, chunkDuration: 5, minPartDuration: 4, audioFormat: format })
      const want = [240000, 240000, 240000, 204000, 204000]
      expect(r.audioPartDurationsSec).toEqual(want.map((s) => s / 48000))
      const got = r.audioPaths!.map((p) => decodedSamples(p).length)
      table[`tone-${format}`] = got.map((samples, part) => ({ part, samples, audioSec: samples / 48000 }))
      expect(r.audioPaths!.map((p) => p.split("/").pop())).toEqual(want.map((_, i) => `audio-part-${String(i).padStart(5, "0")}.${format}`))
      expect(got).toEqual(want)
      await fs.rm(r.workDir, { recursive: true, force: true })
    }, 120_000)
  }

  it("a sound file, aac: .m4a parts in whole AAC frames, each decoding to exactly its samples (234 × 3, 200, 199 frames)", async () => {
    const r = await splitMedia({ audioUrl: fx.tone, chunkDuration: 5, minPartDuration: 4, audioFormat: "aac" })
    const want = [234, 234, 234, 200, 199].map((f) => f * 1024)
    expect(r.audioPartDurationsSec).toEqual(want.map((s) => s / 48000))
    const got = r.audioPaths!.map((p) => decodedSamples(p).length)
    table["tone-aac-m4a"] = got.map((samples, part) => ({ part, samples, audioSec: samples / 48000 }))
    expect(r.audioPaths!.map((p) => p.split("/").pop())).toEqual(want.map((_, i) => `audio-part-${String(i).padStart(5, "0")}.m4a`))
    expect(got).toEqual(want)
    for (const s of got) {
      expect(s / 48000).toBeLessThanOrEqual(5)
      expect(s / 48000).toBeGreaterThanOrEqual(4)
    }
    expect(probe(["-show_entries", "format=format_name", "-of", "csv=p=0", r.audioPaths![0]!])).toMatch(/mp4|m4a/)
    await fs.rm(r.workDir, { recursive: true, force: true })
  }, 120_000)

  it("a video that states no length (piped Matroska) is split by its real frame count", async () => {
    expect(probe(["-show_entries", "format=duration", "-of", "csv=p=0", fx.pipedVideo])).toMatch(/^(N\/A)?$/)
    const r = await splitMedia({ videoUrl: fx.pipedVideo, chunkDuration: 5, minPartDuration: 0 })
    table.pipedVideo = checkVideoParts(r.videoPaths!, unitRate(25), 5, 0, [125, 125, 50], true)
    await fs.rm(r.workDir, { recursive: true, force: true })
  }, 120_000)

  it("a sound file that states no length is split by its decoded sample count", async () => {
    expect(probe(["-show_entries", "format=duration", "-of", "csv=p=0", fx.pipedAudio])).toMatch(/^(N\/A)?$/)
    const r = await splitMedia({ audioUrl: fx.pipedAudio, chunkDuration: 5, minPartDuration: 1, audioFormat: "wav" })
    const got = r.audioPaths!.map((p) => decodedSamples(p).length)
    table.pipedAudio = got.map((samples, part) => ({ part, samples, audioSec: samples / 48000 }))
    expect(got).toEqual([240000, 96000])
    await fs.rm(r.workDir, { recursive: true, force: true })
  }, 120_000)

  it("refuses past 200 parts BEFORE any encode, deterministically, naming a length that fits", async () => {
    ff.calls.length = 0
    const err = await splitMedia({ videoUrl: fx.long5fps, chunkDuration: 1, minPartDuration: 0 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("This video would make 205 parts; the limit is 200. Use a part length of at least 2 s, or trim the video first.")
    expect(ff.calls).toHaveLength(0)
  }, 120_000)

  it("refuses a video shorter than the minimum, deterministically", async () => {
    const err = await splitMedia({ videoUrl: fx.short3, chunkDuration: 10 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("This 3 s video is shorter than the 4 s minimum part length.")
  }, 120_000)
})
