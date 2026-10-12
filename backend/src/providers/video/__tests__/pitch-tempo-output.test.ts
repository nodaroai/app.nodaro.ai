import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { promises as fs, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

/**
 * Pitch & Tempo through the REAL rubberband filter. Only an ffmpeg built with
 * librubberband can run these — the production-pinned build CI installs does;
 * a Homebrew ffmpeg does not, so they skip on a dev Mac (and say so).
 *
 * The download is the only thing replaced: it copies a local fixture.
 */
vi.mock("../ffmpeg-utils.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../ffmpeg-utils.js")>()
  return {
    ...orig,
    downloadFile: async (src: string, dest: string) => {
      await fs.copyFile(src, dest)
    },
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

let sandbox: string
let toneWav: string
let clipMp4: string
let silentMp4: string

beforeAll(() => {
  if (!RUBBERBAND) return
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "pitch-tempo-test-")))
  toneWav = join(sandbox, "tone.wav")
  clipMp4 = join(sandbox, "clip.mp4")
  silentMp4 = join(sandbox, "silent.mp4")
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=4", "-ac", "2", toneWav])
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
