// @test-watches backend/src/** packages/*/src/**
/**
 * EVERY MP3 ENCODE IS BUILT BY ONE MODULE — a build-enforced invariant.
 *
 * libmp3lame refuses a frame whose float plane is not padded to a whole group
 * of 8 samples, and ffmpeg's encoder queue can hand it one on a 16-byte SIMD
 * machine (arm64, an x86 without AVX). `mp3-encode.ts` builds every MP3 encode
 * so the encoder only ever gets whole 1152-sample frames. An encode written
 * anywhere else names the encoder itself, and this scan fails the build on it:
 * `libmp3lame` as a string, or `mp3` as the codec or the muxer of an ffmpeg
 * argument list.
 *
 * An encode that names no codec (an `.mp3` output, or an `.avi`/`.flv`/`.swf`
 * one, whose container's default audio is MP3) has no encoder to scan for. The
 * launcher catches it at run time (`assertFramedMp3Encode` in
 * `ffmpeg-process.ts` throws under test for any MP3 encode not built by the
 * helper) — but only on a launch a test reaches with the real runner, never
 * one whose test mocks it. So a file that launches ffmpeg and names such a
 * path must import the helper, or say here why that path is no MP3 encode.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { MP3_DEFAULT_EXTENSIONS } from "../mp3-encode.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND_SRC = join(HERE, "..", "..", "..")
const REPO = join(BACKEND_SRC, "..", "..")
const PACKAGES = join(REPO, "packages")

/** The one file allowed to name the encoder. */
const HELPER = "backend/src/providers/video/mp3-encode.ts"

/** An option naming an output's audio codec, with any stream specifier (`-c:a:0`, `-codec:1`, `-acodec:0`), or its muxer (`-f`). */
const CODEC_OR_MUXER = String.raw`-(?:(?:c|codec)(?::a(?::\d+)?|:\d+)?|acodec(?::\d+)?|f)`

/** The encoder named as a string, or `mp3` as an ffmpeg codec or muxer value. */
const ENCODER_USE = [
  /["'`]libmp3lame["'`]/g,
  new RegExp(String.raw`["'\`]${CODEC_OR_MUXER}["'\`]\s*,\s*["'\`]mp3["'\`]`, "g"),
  new RegExp(String.raw`["'\`]${CODEC_OR_MUXER} mp3\b`, "g"),
]

/** A call to an ffmpeg runner or the launcher. */
const LAUNCH = /\b(?:runFfmpeg|runFfmpegCapture|runFfmpegWithProgress|runFfmpegCancellable|spawnFfmpeg|execFileFfmpeg)\s*\(/
/** A path literal in a container whose default audio is MP3 (`output.mp3`, `clip.avi`, `` `${x}.flv` ``). */
const MP3_DEFAULT_PATH = new RegExp(String.raw`\.(?:${MP3_DEFAULT_EXTENSIONS.join("|")})["'\`]`, "i")
const IMPORTS_HELPER = /from\s+["'][^"']*\/mp3-encode\.js["']/

/** Files that launch ffmpeg and name an MP3-default path without importing the helper: why that path is no MP3 encode. */
const NOT_AN_ENCODE: Readonly<Record<string, string>> = {
  "backend/src/providers/video/extract-audio-track.ts": "its audio.mp3 is encoded by extractAudioArgs (extract-audio.ts), built by the helper",
  "backend/src/providers/video/merge-video-audio.ts": "audio_<i>.mp3 are the MP3 tracks it downloads and reads; its output is AAC in MP4",
  "backend/src/providers/video/slideshow.ts": "input-audio.mp3 is the track it downloads and reads; its output is AAC in MP4",
  "backend/src/providers/video/still-to-video.ts": "input-audio.mp3 is the track it downloads and reads; its output is AAC in MP4",
  "backend/src/providers/video/youtube-video.ts": ".avi/.flv are names of files yt-dlp wrote, looked for after the download",
  "backend/src/workers/render-worker.ts": "audio-<i>.mp3 are the tracks it downloads and reads; its output is AAC in MP4",
  "backend/src/workers/handlers/heygen-avatar-audio-cap.ts": ".mp3 is a key of its extension → MIME map; its cut encodes AAC",
  "backend/src/ee/pipelines/services/pipeline-final-merge.ts": "music.mp3 / narration.mp3 are tracks it downloads and reads; its output is AAC in MP4",
  "backend/src/lib/private-plugins/types.ts": "declares the plugin toolkit's types (runFfmpeg among them); launches nothing",
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__" || entry === "__characterization__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(?:ts|tsx|mts|js|mjs)$/.test(entry) && !/\.test\.|\.char\.|\.d\.ts$/.test(entry)) out.push(full)
  }
  return out
}

function sourceFiles(): string[] {
  const packageSrcs = readdirSync(PACKAGES)
    .map((p) => join(PACKAGES, p, "src"))
    .filter((p) => {
      try {
        return statSync(p).isDirectory()
      } catch {
        return false
      }
    })
  return [BACKEND_SRC, ...packageSrcs].flatMap((d) => walk(d))
}

function uses(source: string): number[] {
  const lines: number[] = []
  for (const re of ENCODER_USE) {
    for (const m of source.matchAll(re)) lines.push(source.slice(0, m.index).split("\n").length)
  }
  return lines.sort((a, b) => a - b)
}

describe("MP3 encode census", () => {
  it("recognizes every way a file could name the encoder", () => {
    // Guards the matcher: a pattern that matched nothing would make the scan below a test that can never fail.
    const samples = [
      `await runFfmpeg(["-i", input, "-c:a", "libmp3lame", output])`,
      `const codec = { mp3: "libmp3lame", wav: "pcm_s16le" }`,
      `args.push("-acodec", "mp3")`,
      `["-f", 'mp3', "pipe:1"]`,
      "spawn(`-c:a mp3 out`)",
      `["-c:a:0", "mp3", out]`,
      `["-codec:1", "mp3"]`,
      `["-acodec:0", 'mp3']`,
      "`-codec:a:0 mp3`",
    ]
    for (const s of samples) expect(uses(s), s).not.toHaveLength(0)
    // Prose that mentions it in a comment, and other codecs, are not encodes.
    expect(uses("// demuxed and converted to mp3 (`-vn -c:a libmp3lame`, the call yt-dlp makes)")).toHaveLength(0)
    expect(uses(`["-c:a", "aac", "-f", "mp4"]`)).toHaveLength(0)
    expect(uses(`["-c:v", "mp3"]`)).toHaveLength(0)
  })

  it("no file but the helper names the MP3 encoder", () => {
    const files = sourceFiles()
    // Guards the walk: the helper itself must be found and must match.
    expect(files.some((f) => relative(REPO, f) === HELPER)).toBe(true)
    expect(uses(readFileSync(join(REPO, HELPER), "utf8")).length).toBeGreaterThan(0)
    const offenders = files
      .filter((f) => relative(REPO, f) !== HELPER)
      .flatMap((f) => uses(readFileSync(f, "utf8")).map((line) => `${relative(REPO, f)}:${line}`))
    expect(offenders, "build the encode with mp3EncodeArgs / mp3GraphEncodeArgs (providers/video/mp3-encode.ts)").toEqual([])
  })

  it("a file that launches ffmpeg and names an MP3-default path imports the helper, or says why it is no encode", () => {
    // Guards the matchers.
    expect(LAUNCH.test("await runFfmpeg([\"-i\", a, out])")).toBe(true)
    expect(["join(dir, \"output.mp3\")", "`clip.AVI`", "'x.flv'", "`${id}.swf`"].every((t) => MP3_DEFAULT_PATH.test(t))).toBe(true)
    expect(MP3_DEFAULT_PATH.test("\"output.mp4\"")).toBe(false)
    const files = sourceFiles()
    const named = new Map(files.map((f) => [relative(REPO, f), readFileSync(f, "utf8")] as const))
    const offenders = [...named]
      .filter(([rel, src]) => rel !== HELPER && LAUNCH.test(src) && MP3_DEFAULT_PATH.test(src) && !IMPORTS_HELPER.test(src) && !(rel in NOT_AN_ENCODE))
      .map(([rel]) => rel)
    expect(offenders, "build the encode with mp3EncodeArgs / mp3GraphEncodeArgs, or add the file to NOT_AN_ENCODE with why its path is no MP3 encode").toEqual([])
    // Every exemption still describes a file that needs one.
    const stale = Object.keys(NOT_AN_ENCODE).filter((rel) => {
      const src = named.get(rel)
      return src === undefined || !LAUNCH.test(src) || !MP3_DEFAULT_PATH.test(src) || IMPORTS_HELPER.test(src)
    })
    expect(stale).toEqual([])
  })
})
