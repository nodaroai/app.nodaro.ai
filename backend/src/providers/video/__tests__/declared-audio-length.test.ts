// @test-reads-none reads only the audio files it makes with ffmpeg in a temp dir
/**
 * The length a caller's audio states for its first audio track (decided
 * 2026-11-12), read only to refuse a decode that comes up clearly short of it.
 * The parse is pinned on ffprobe's JSON; the real ffprobe runs where it is on
 * PATH (Backend Tests install the production-pinned build).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DECLARED_LENGTH_FORMATS,
  DECLARED_LENGTH_TOLERANCE_SEC,
  WHOLE_FILE_LENGTH_FORMATS,
  declaredLengthArgs,
  parseDeclaredLength,
  probeDeclaredAudioLength,
} from "../declared-audio-length.js"
import { CALLER_AUDIO_FORMATS, localInputArgs } from "../decoded-audio-length.js"

const json = (format: Record<string, string>, streams: Array<Record<string, unknown>>) => JSON.stringify({ format, streams })

describe("the rule", () => {
  it("only containers whose stated length is exact, every one a container the lane takes; Ogg's is not the whole file's", () => {
    expect([...DECLARED_LENGTH_FORMATS]).toEqual(["matroska", "mov", "ogg", "flac", "wav", "w64", "aiff", "caf", "au", "wv", "tta", "ape", "mpc", "mpc8", "asf"])
    for (const f of DECLARED_LENGTH_FORMATS) expect(CALLER_AUDIO_FORMATS).toContain(f)
    expect(WHOLE_FILE_LENGTH_FORMATS.has("ogg")).toBe(false)
    expect(WHOLE_FILE_LENGTH_FORMATS.size).toBe(DECLARED_LENGTH_FORMATS.size - 1)
    expect(DECLARED_LENGTH_TOLERANCE_SEC).toBe(0.5)
  })

  it("probes through the decode's own whitelist, for each stream's type, codec, pre-skip, length, start and DURATION tag", () => {
    expect(declaredLengthArgs("in", ["-protocol_whitelist", "file", "-format_whitelist", "mp3,mov"])).toEqual([
      "-v", "warning", "-protocol_whitelist", "file", "-format_whitelist", "mp3,mov",
      "-show_entries", "format=format_name,duration,start_time:stream=codec_type,codec_name,initial_padding,duration,start_time:stream_tags=DURATION",
      "-of", "json", "in",
    ])
  })
})

describe("parseDeclaredLength — what each format's figure means (ffprobe's output for the shapes, as measured)", () => {
  it("Matroska: a stream duration with other streams is ffprobe's copy of the file's (audio 6 s after the video) — nothing stated", () => {
    expect(parseDeclaredLength(json({ format_name: "matroska,webm", duration: "60.0", start_time: "0.0" }, [
      { codec_type: "video", duration: "N/A", tags: { DURATION: "00:01:00.000000000" } },
      { codec_type: "audio", duration: "60.000000", start_time: "0.000000", tags: { DURATION: "00:00:16.008000000" } },
    ]), "")).toEqual({ format: "matroska" })
    // Its own start known (4 s late, the analysis reached it): the DURATION tag less that start.
    expect(parseDeclaredLength(json({ format_name: "matroska,webm", duration: "30.0" }, [
      { codec_type: "video", duration: "N/A", tags: { DURATION: "00:00:30.000000000" } },
      { codec_type: "audio", duration: "N/A", start_time: "4.001000", tags: { DURATION: "00:00:14.008000000" } },
    ]), "")?.seconds).toBeCloseTo(10.007, 6)
  })

  it("ASF: every stream states the file's play time — used only when the audio is the only stream", () => {
    const wmv = json({ format_name: "asf", duration: "22.957" }, [
      { codec_type: "video", duration: "20.000000" },
      { codec_type: "audio", duration: "20.000000", start_time: "2.957000" },
    ])
    expect(parseDeclaredLength(wmv, "")).toEqual({ format: "asf" })
    expect(parseDeclaredLength(json({ format_name: "asf", duration: "10.03" }, [{ codec_type: "audio", duration: "10.030000" }]), "")).toEqual({ format: "asf", seconds: 10.03 })
  })

  it("Ogg Opus: the last granule's time, less a positive start and the pre-skip the decoder drops", () => {
    const opus = (start: string, preSkip: number, duration: string) =>
      parseDeclaredLength(json({ format_name: "ogg" }, [{ codec_type: "audio", codec_name: "opus", initial_padding: preSkip, start_time: start, duration }]), "")?.seconds
    expect(opus("0.000000", 312, "30.006500")).toBeCloseTo(30, 6)
    expect(opus("5.000000", 312, "30.006500")).toBeCloseTo(25, 6) // a capture that began 5 s in
    expect(opus("3600.000000", 312, "3630.006500")).toBeCloseTo(30, 6)
    expect(opus("0.000000", 48_000, "20.006500")).toBeCloseTo(19.0065, 6) // a 1 s pre-skip
  })

  it("Ogg Vorbis and FLAC: a positive start is taken off (Vorbis's is a span already: it only understates)", () => {
    expect(parseDeclaredLength(json({ format_name: "ogg" }, [{ codec_type: "audio", codec_name: "vorbis", start_time: "4.063492", duration: "25.936689" }]), "")?.seconds).toBeCloseTo(21.873, 3)
    expect(parseDeclaredLength(json({ format_name: "ogg" }, [{ codec_type: "audio", codec_name: "flac", start_time: "0.000000", duration: "10.000000" }]), "")).toEqual({ format: "ogg", seconds: 10 })
  })
})

describe("parseDeclaredLength", () => {
  it("the first audio track's own length (MP4, video first)", () => {
    expect(parseDeclaredLength(json({ format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "10.0" }, [
      { codec_type: "video", duration: "10.000000" },
      { codec_type: "audio", duration: "6.000000", start_time: "0.000000" },
    ]), "")).toEqual({ format: "mov", seconds: 6 })
  })

  it("Matroska's DURATION tag is an end time: the track's start is taken off", () => {
    expect(parseDeclaredLength(json({ format_name: "matroska,webm", duration: "9.0", start_time: "1.0" }, [
      { codec_type: "audio", duration: "N/A", start_time: "1.000000", tags: { DURATION: "00:00:09.000000000" } },
    ]), "")).toEqual({ format: "matroska", seconds: 8 })
    // A negative start (Opus pre-skip) is not added on.
    expect(parseDeclaredLength(json({ format_name: "matroska,webm" }, [
      { codec_type: "audio", start_time: "-0.007000", tags: { DURATION: "00:01:00.008000000" } },
    ]), "")?.seconds).toBeCloseTo(60.008, 6)
  })

  it("a track with no length of its own uses the file's only when it is the file's only stream (Matroska: an end time too)", () => {
    expect(parseDeclaredLength(json({ format_name: "matroska,webm", duration: "12.5", start_time: "0.5" }, [
      { codec_type: "audio", duration: "N/A" },
    ]), "")).toEqual({ format: "matroska", seconds: 12 })
    expect(parseDeclaredLength(json({ format_name: "matroska,webm", duration: "12.5" }, [
      { codec_type: "video", duration: "N/A" },
      { codec_type: "audio", duration: "N/A" },
    ]), "")).toEqual({ format: "matroska" })
  })

  it("no exact length: an estimate from the bitrate, a format left out, no audio track, no length at all", () => {
    const wav = json({ format_name: "wav", duration: "10.0" }, [{ codec_type: "audio", duration: "10.000000" }])
    expect(parseDeclaredLength(wav, "[wav @ 0x1] Estimating duration from bitrate, this may be inaccurate\n")).toEqual({ format: "wav" })
    expect(parseDeclaredLength(json({ format_name: "mp3", duration: "10.0" }, [{ codec_type: "audio", duration: "10.0" }]), "")).toEqual({ format: "mp3" })
    expect(parseDeclaredLength(json({ format_name: "aac" }, [{ codec_type: "audio", duration: "10.0" }]), "")).toEqual({ format: "aac" })
    expect(parseDeclaredLength(json({ format_name: "flac" }, [{ codec_type: "video", duration: "10.0" }]), "")).toEqual({ format: "flac" })
    expect(parseDeclaredLength(json({ format_name: "flac" }, [{ codec_type: "audio", duration: "N/A" }]), "")).toEqual({ format: "flac" })
    expect(parseDeclaredLength("not json", "")).toBeUndefined()
  })
})

const encoders = (() => {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"] }).toString()
  } catch {
    return undefined
  }
})()
const hasFfmpeg = encoders !== undefined && encoders.includes("libmp3lame")
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args], { stdio: "ignore" })
const REAL_MEDIA_TIMEOUT_MS = 30_000

describe.skipIf(!hasFfmpeg)("probeDeclaredAudioLength (real ffprobe)", () => {
  let dir = ""
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "declared-audio-length-"))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const probe = (f: string) => probeDeclaredAudioLength(f, localInputArgs(CALLER_AUDIO_FORMATS))

  it.each([
    ["an M4A", "a.m4a", ["-c:a", "aac"], "mov"],
    ["a FLAC", "a.flac", ["-c:a", "flac"], "flac"],
    ["an MKA", "a.mka", ["-c:a", "flac"], "matroska"],
    ["a WAV", "a.wav", ["-c:a", "pcm_s16le"], "wav"],
    ["a WavPack", "a.wv", ["-c:a", "wavpack"], "wv"],
  ])("%s states its length", async (_label, name, codec, format) => {
    const f = join(dir, name)
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "7.5", "-ac", "2", ...codec, f)
    const d = await probe(f)
    expect(d?.format).toBe(format)
    expect(d?.seconds).toBeCloseTo(7.5, 1)
  }, REAL_MEDIA_TIMEOUT_MS)

  it("an MKA whose audio starts 1 s in states 8 s, not its 9 s end", async () => {
    const f = join(dir, "offset.mka")
    ffmpeg("-itsoffset", "1", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=8", "-c:a", "flac", f)
    expect((await probe(f))?.seconds).toBeCloseTo(8, 1)
  }, REAL_MEDIA_TIMEOUT_MS)

  it("a WAV written as a stream (sizes 0xFFFFFFFF) states nothing exact: its length is estimated", async () => {
    const f = join(dir, "stream.wav")
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=48000", "-t", "5", "-ac", "2", "-c:a", "pcm_s16le", f)
    const bytes = await readFile(f)
    bytes.writeUInt32LE(0xffff_ffff, 4)
    bytes.writeUInt32LE(0xffff_ffff, bytes.indexOf("data") + 4)
    await writeFile(f, bytes)
    expect(await probe(f)).toEqual({ format: "wav" })
  }, REAL_MEDIA_TIMEOUT_MS)

  it("an MP3 states nothing exact, and a file ffprobe cannot read states nothing at all", async () => {
    const mp3 = join(dir, "a.mp3")
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "3", "-c:a", "libmp3lame", mp3)
    expect(await probe(mp3)).toEqual({ format: "mp3" })
    const junk = join(dir, "junk.bin")
    await writeFile(junk, "not audio")
    expect(await probe(junk)).toBeUndefined()
  }, REAL_MEDIA_TIMEOUT_MS)
})
