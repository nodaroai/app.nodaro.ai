import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { promises as fs, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

/**
 * Pitch & Tempo through the REAL rubberband filter. Only an ffmpeg built with
 * librubberband can run these — the production-pinned build CI installs does;
 * a Homebrew ffmpeg does not, so they skip on a dev Mac (and say so).
 *
 * The download is the only thing replaced: it copies a local fixture. The
 * ffmpeg launch is the real one; a test can ask it to run at the narrowest
 * SIMD alignment (below).
 */

/**
 * ffmpeg's encoder queue passes a cut frame on whenever it is aligned to the
 * CPU's widest SIMD register: 16 bytes on arm64 (and on an x86 without AVX),
 * 32 with AVX2, 64 with AVX-512. Some WAVs at tempo 0.8 failed MP3 encoding
 * only at 16. On an x86 runner these flags clear the wider sets, so the run
 * meets that case on any machine; arm64 is at 16 already.
 */
const simd = vi.hoisted(() => ({
  narrow: false,
  args: process.arch === "x64" ? ["-cpuflags", "-avx512-avx512icl-avx2-avx-fma3-fma4-xop-avxslow"] : [],
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  const runFfmpeg: typeof orig.runFfmpeg = (args, ...rest) => orig.runFfmpeg(simd.narrow ? [...simd.args, ...args] : args, ...rest)
  return {
    ...orig,
    downloadFile: async (src: string, dest: string) => {
      await fs.copyFile(src, dest)
    },
    runFfmpeg,
  }
})

import { pitchTempo } from "../pitch-tempo.js"

function hasRubberband(): boolean {
  try {
    const out = execFileSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return /\srubberband\s/.test(out)
  } catch {
    return false
  }
}

const RUBBERBAND = hasRubberband()
if (!RUBBERBAND) console.warn("[pitch-tempo-output] skipped: this ffmpeg has no rubberband filter (CI's pinned build does)")

function probe(path: string, entries: string): Record<string, string> {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "json", path], { encoding: "utf8" })
  return JSON.parse(out) as Record<string, string>
}

function streamInfo(path: string, sel: "v:0" | "a:0"): { duration: number; codec: string; frames?: number } {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", sel, "-count_packets", "-show_entries", "stream=duration,codec_name,nb_read_packets", "-of", "json", path],
    { encoding: "utf8" },
  )
  const s = (JSON.parse(out) as { streams: Array<{ duration?: string; codec_name: string; nb_read_packets?: string }> }).streams[0]!
  return { duration: Number(s.duration), codec: s.codec_name, frames: s.nb_read_packets === undefined ? undefined : Number(s.nb_read_packets) }
}

function formatDuration(path: string): number {
  return Number((probe(path, "format=duration") as unknown as { format: { duration: string } }).format.duration)
}

function audioStream(path: string): { codec: string; sampleRate: number; channels: number } {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels", "-of", "json", path],
    { encoding: "utf8" },
  )
  const s = (JSON.parse(out) as { streams: Array<{ codec_name: string; sample_rate: string; channels: number }> }).streams[0]!
  return { codec: s.codec_name, sampleRate: Number(s.sample_rate), channels: s.channels }
}

let sandbox: string
let toneWav: string
let wav44k: string
let wav48k: string
let clipMp4: string
let silentMp4: string

beforeAll(() => {
  if (!RUBBERBAND) return
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "pitch-tempo-test-")))
  toneWav = join(sandbox, "tone.wav")
  wav44k = join(sandbox, "tone-44k.wav")
  wav48k = join(sandbox, "tone-48k.wav")
  clipMp4 = join(sandbox, "clip.mp4")
  silentMp4 = join(sandbox, "silent.mp4")
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=4", "-ac", "2", toneWav])
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=5", "-ac", "2", wav44k])
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=10", "-ac", "2", wav48k])
  execFileSync("ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=3",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clipMp4,
  ])
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", silentMp4])
})

afterAll(async () => {
  if (sandbox) await fs.rm(sandbox, { recursive: true, force: true })
})

describe.skipIf(!RUBBERBAND)("pitchTempo (real rubberband)", () => {
  it("audio: a pitch shift keeps the length and returns MP3", async () => {
    const { outputPath, inputType } = await pitchTempo({ audioUrl: toneWav, semitones: 3, tempo: 1, preserveFormants: true })
    expect(inputType).toBe("audio")
    expect(outputPath.endsWith(".mp3")).toBe(true)
    expect(formatDuration(outputPath)).toBeCloseTo(4, 1)
    await fs.rm(dirname(outputPath), { recursive: true, force: true })
  })

  it("audio: two octaves either way, and a half step, run in one pass and keep the length", async () => {
    for (const semitones of [24, -24, 0.5]) {
      const { outputPath, inputType } = await pitchTempo({ audioUrl: toneWav, semitones, tempo: 1, preserveFormants: true, maxSemitones: 24 })
      expect(inputType, String(semitones)).toBe("audio")
      expect(formatDuration(outputPath), String(semitones)).toBeCloseTo(4, 1)
      await fs.rm(dirname(outputPath), { recursive: true, force: true })
    }
    // Three real rubberband passes: well over the default 5 s on a loaded CI runner.
  }, 60_000)

  it("audio: tempo 0.5 doubles the length", async () => {
    const { outputPath } = await pitchTempo({ audioUrl: toneWav, semitones: 0, tempo: 0.5, preserveFormants: false })
    expect(formatDuration(outputPath)).toBeCloseTo(8, 0)
    await fs.rm(dirname(outputPath), { recursive: true, force: true })
  })

  it("video: copies the picture untouched, ignores tempo, and the audio ends with the picture", async () => {
    const { outputPath, inputType } = await pitchTempo({ videoUrl: clipMp4, semitones: -5, tempo: 0.5, preserveFormants: true })
    expect(inputType).toBe("video")
    const src = streamInfo(clipMp4, "v:0")
    const vid = streamInfo(outputPath, "v:0")
    const aud = streamInfo(outputPath, "a:0")
    expect(vid.codec).toBe(src.codec)
    expect(vid.frames).toBe(src.frames)
    // Within one AAC frame (1024 samples at 48 kHz ≈ 21 ms) of the picture.
    expect(Math.abs(aud.duration - vid.duration)).toBeLessThan(0.025)
    await fs.rm(dirname(outputPath), { recursive: true, force: true })
  })

  it("an audio field holding a video file still takes the video lane (streams decide)", async () => {
    const { inputType } = await pitchTempo({ audioUrl: clipMp4, semitones: 2, tempo: 1, preserveFormants: true })
    expect(inputType).toBe("video")
  })

  it("a video with no audio track is refused, deterministically", async () => {
    await expect(pitchTempo({ videoUrl: silentMp4, semitones: 2, tempo: 1, preserveFormants: true })).rejects.toMatchObject({
      name: "PitchTempoInputError",
      message: "This media has no audio track to shift.",
    })
  })
})

/**
 * Both WAVs failed at tempo 0.8 on the pinned ffmpeg at a 16-byte alignment
 * ("inadequate AVFrame plane padding" from libmp3lame on the last frame),
 * while every other tempo passed. The audio lane now hands the encoder
 * 1152-sample frames, so the encode reaches the end at every alignment and
 * every tempo, with the same length and format as before.
 */
describe.skipIf(!RUBBERBAND)("pitchTempo: WAVs that failed at tempo 0.8 encode to the end (real rubberband)", () => {
  afterEach(() => {
    simd.narrow = false
  })

  const cases = [
    { name: "5 s at 44.1 kHz", input: () => wav44k, seconds: 5, sampleRate: 44100 },
    { name: "10 s at 48 kHz", input: () => wav48k, seconds: 10, sampleRate: 48000 },
  ] as const

  async function render(input: string, tempo: number): Promise<{ seconds: number; codec: string; sampleRate: number; channels: number }> {
    const { outputPath, inputType } = await pitchTempo({ audioUrl: input, semitones: 0, tempo, preserveFormants: true })
    expect(inputType).toBe("audio")
    expect(outputPath.endsWith(".mp3")).toBe(true)
    const result = { seconds: formatDuration(outputPath), ...audioStream(outputPath) }
    await fs.rm(dirname(outputPath), { recursive: true, force: true })
    return result
  }

  for (const c of cases) {
    it(`${c.name}: tempo 0.8 and the other tempos, at a 16-byte alignment, keep the length and the format`, async () => {
      simd.narrow = true
      for (const tempo of [0.8, 0.5, 1, 1.25, 2]) {
        const out = await render(c.input(), tempo)
        expect(out.codec, String(tempo)).toBe("mp3")
        expect(out.sampleRate, String(tempo)).toBe(c.sampleRate)
        expect(out.channels, String(tempo)).toBe(2)
        // Rubber Band ends a stretch within a few hundredths of a second of input ÷ tempo.
        expect(Math.abs(out.seconds - c.seconds / tempo), String(tempo)).toBeLessThan(0.1)
      }
      // Five real rubberband passes of up to 20 s of output each.
    }, 120_000)

    it(`${c.name}: tempo 0.8 at this machine's own alignment`, async () => {
      const out = await render(c.input(), 0.8)
      expect(out.codec).toBe("mp3")
      expect(Math.abs(out.seconds - c.seconds / 0.8)).toBeLessThan(0.1)
    }, 60_000)
  }
})
