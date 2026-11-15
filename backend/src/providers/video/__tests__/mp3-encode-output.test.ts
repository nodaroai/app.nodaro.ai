// @test-watches backend/src/providers/video/__characterization__/golden/ffmpeg-n8.1.2.json
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  LIBMP3LAME_CHANNEL_LAYOUTS,
  LIBMP3LAME_SAMPLE_FORMATS,
  LIBMP3LAME_SAMPLE_RATES,
  MP3_DEFAULT_EXTENSIONS,
  MP3_DEFAULT_MUXERS,
  MP3_FRAME_FILTER,
  isFramedMp3Encode,
} from "../mp3-encode.js"
import { runFfmpeg } from "../ffmpeg-utils.js"
import { loadGolden } from "../__characterization__/golden.js"
import { extractAudioArgs } from "../extract-audio.js"
import { trimAudioArgs } from "../trim-audio.js"
import { mixAudioArgs } from "../mix-audio.js"
import { adjustVolumeArgs } from "../adjust-volume.js"
import { buildAudioFxArgs, writeReverbIr } from "../audio-fx.js"
import { buildPitchTempoArgs, buildRubberbandFilter } from "../pitch-tempo.js"
import { splitAudioPartArgs } from "../split-media.js"
import { combineAudioArgs } from "../combine-audio.js"
import { lipSyncAudioEncodeArgs } from "../../kie/lip-sync-audio.js"
import { dubbingAudioArgs } from "../../elevenlabs/dubbing-project.js"
import { beatGridTrimArgs } from "../../../ee/pipelines/services/pipeline-extract-beat-grid.js"
import { lipSyncAudioTrimArgs } from "../../kie/video.js"
import { speechMp3Args } from "../../audio/speech-mp3.js"
import { mediaProcessArgs } from "../../../routes/media-process.js"

/**
 * The MP3 helper against a real ffmpeg with libmp3lame (Backend Tests install
 * the production-pinned build; a machine without one skips, and says so).
 *
 * ffmpeg's encoder queue passes a cut frame on whenever it is aligned to the
 * CPU's widest SIMD register: 16 bytes on arm64 (and on an x86 without AVX),
 * 32 with AVX2, 64 with AVX-512. The MP3 padding failure happens only at 16.
 * On an x86 runner these flags clear the wider sets, so every encode here meets
 * that case on any machine; arm64 is at 16 already.
 */
const NARROW = process.arch === "x64" ? ["-cpuflags", "-avx512-avx512icl-avx2-avx-fma3-fma4-xop-avxslow"] : []

const encoders = (() => {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return ""
  }
})()
const hasMp3 = encoders.includes("libmp3lame")
if (!hasMp3) console.warn("[mp3-encode-output] skipped: no ffmpeg with libmp3lame on PATH")
/** Pitch & Tempo needs ffmpeg's rubberband filter (the pinned build has it; a Homebrew ffmpeg does not). */
const hasRubberband = hasMp3 && /\brubberband\b/.test(execFileSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))

/** The first line's version token of the ffmpeg on PATH ("n8.1.2-21-…"). */
function ffmpegVersion(): string {
  const out = execFileSync("ffmpeg", ["-hide_banner", "-version"], { encoding: "utf8" })
  return /ffmpeg version (\S+)/.exec(out)?.[1] ?? ""
}

/** ffmpeg run directly — past the launcher, which refuses an MP3 encode the helper did not build. */
function ffmpegDirect(args: readonly string[]): { ok: boolean; stderr: string } {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", ...args], { encoding: "utf8" })
  return { ok: r.status === 0, stderr: r.stderr }
}

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

/** The sample frames a file decodes to (mono 16-bit PCM counted; an MP3's encoder delay and padding removed by its LAME header). */
function decodedSamples(path: string): number {
  return execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "pipe:1"], { maxBuffer: 64 * 1024 * 1024 }).length / 2
}

let dir: string
let m4a: string
let mp3: string
let wav24: string
let wav48: string
let avi: string
let wav44: string
let flac: string
let pcmS16: string
let pcmF32: string
let concatList: string
let irPath: string

/** A tone with noise, `seconds` long: deterministic (aevalsrc's random() is seeded). */
function make(path: string, rate: number, channels: number, seconds: number, codec: string[]): void {
  const exprs = Array.from({ length: channels }, (_, i) => `0.35*sin(2*PI*${220 * (i + 2)}*t)+0.12*(random(${i})-0.5)`).join("|")
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=${exprs}:s=${rate}:d=${seconds + 1}`, "-af", `atrim=end=${seconds}`, ...codec, path])
}

beforeAll(() => {
  if (!hasMp3) return
  dir = realpathSync(mkdtempSync(join(tmpdir(), "mp3-encode-output-")))
  m4a = join(dir, "tone.m4a")
  mp3 = join(dir, "tone.mp3")
  wav24 = join(dir, "speech-24k.wav")
  wav48 = join(dir, "tone-48k.wav")
  make(m4a, 44100, 2, 5.01, ["-c:a", "aac", "-b:a", "128k"])
  make(mp3, 44100, 2, 5, ["-c:a", "libmp3lame", "-b:a", "128k"])
  make(wav24, 24000, 1, 3.7, ["-c:a", "pcm_s16le"])
  make(wav48, 48000, 2, 4.3, ["-c:a", "pcm_f32le"])
  // A video in a container whose default audio is MP3: a picture and an MP3 track.
  avi = join(dir, "clip.avi")
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=3.07", "-i", mp3, "-map", "0:v", "-map", "1:a", "-t", "3.07", "-c:v", "mpeg4", "-q:v", "5", "-c:a", "copy", avi])
  wav44 = join(dir, "tone-44k.wav")
  make(wav44, 44100, 2, 4.71, ["-c:a", "pcm_s16le"])
  flac = join(dir, "dub.flac")
  make(flac, 48000, 2, 3.3, ["-c:a", "flac", "-sample_fmt", "s32"])
  // The decoded PCM the lip-sync lane encodes (s16le 44.1 kHz stereo), and the f32 PCM split-media cuts parts from.
  pcmS16 = join(dir, "decoded.pcm")
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", m4a, "-f", "s16le", "-ar", "44100", "-ac", "2", pcmS16])
  pcmF32 = join(dir, "audio.pcm")
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wav48, "-c:a", "pcm_f32le", "-ar", "48000", "-ch_layout", "stereo", "-f", "f32le", pcmF32])
  // Combine Audio's concat of its per-segment 44.1 kHz stereo WAVs.
  const seg0 = join(dir, "seg_0.wav")
  const seg1 = join(dir, "seg_1.wav")
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp3, "-ss", "0.31", "-to", "1.77", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", seg0])
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wav48, "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", seg1])
  concatList = join(dir, "list.txt")
  writeFileSync(concatList, `file '${seg0}'\nfile '${seg1}'`)
})

beforeAll(async () => {
  if (!hasMp3) return
  irPath = join(dir, "reverb-ir.f32")
  await writeReverbIr("room", irPath)
})

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!hasMp3)("the MP3 chain mirrors ffmpeg's own format for libmp3lame", () => {
  /** The values ffmpeg sets on its `format_out` aformat for an MP3 encode. */
  function formatOut(extra: readonly string[]): Record<string, string> {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-v", "debug", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "0.05", ...extra, "-c:a", "libmp3lame", "-f", "null", "-"], { encoding: "utf8" })
    const values: Record<string, string> = {}
    for (const m of r.stderr.matchAll(/\[format_out_[^\]]*\] Setting '(\w+)' to value '([^']*)'/g)) values[m[1]!] = m[2]!
    return values
  }

  it("the muxers whose default audio is MP3, and the extensions ffmpeg picks them by, are the pinned ffmpeg's own", async (ctx) => {
    const list = spawnSync("ffmpeg", ["-hide_banner", "-muxers"], { encoding: "utf8" }).stdout
    const names = list.split("\n").slice(list.split("\n").findIndex((l) => l.trim() === "---") + 1)
      .map((l) => /^\s*[A-Za-z.]+\s+(\S+)/.exec(l)?.[1]).filter((n): n is string => !!n).flatMap((n) => n.split(","))
    const muxers: string[] = []
    const extensions: string[] = []
    for (const m of [...new Set(names)]) {
      const help = spawnSync("ffmpeg", ["-hide_banner", "-h", `muxer=${m}`], { encoding: "utf8" }).stdout
      if (!/Default audio codec: (?:mp3|libmp3lame)\./.test(help)) continue
      muxers.push(m)
      extensions.push(...(/Common extensions: ([^.]+)\./.exec(help)?.[1]?.split(",") ?? []))
    }
    muxers.sort()
    extensions.sort()
    const pinned = ffmpegVersion() === (await loadGolden()).ffmpegVersion
    // Another build may differ (`nut` defaults to MP3 on one without libvorbis); the pinned one is what production runs.
    if (!pinned && (JSON.stringify(muxers) !== JSON.stringify([...MP3_DEFAULT_MUXERS]) || JSON.stringify(extensions) !== JSON.stringify([...MP3_DEFAULT_EXTENSIONS]))) return ctx.skip()
    expect(muxers).toEqual([...MP3_DEFAULT_MUXERS])
    expect(extensions).toEqual([...MP3_DEFAULT_EXTENSIONS])
  }, 120_000)

  it("the encoder's sample formats, rates and layouts, in ffmpeg's order (or the one -ar names)", async (ctx) => {
    const own = formatOut([])
    const expected = {
      sample_fmts: LIBMP3LAME_SAMPLE_FORMATS.join("|"),
      sample_rates: LIBMP3LAME_SAMPLE_RATES.join("|"),
      channel_layouts: LIBMP3LAME_CHANNEL_LAYOUTS.join("|"),
    }
    const pinned = ffmpegVersion() === (await loadGolden()).ffmpegVersion
    if (!pinned && JSON.stringify(own) !== JSON.stringify(expected)) {
      // Another build may list them differently; the pinned one is the one production runs.
      ctx.skip()
    }
    expect(own).toEqual(expected)
    expect(formatOut(["-ar", "44100"]).sample_rates).toBe("44100")
  })
})

describe.skipIf(!hasMp3)("a cut lands ahead of the encoder's frame size, at a 16-byte alignment", () => {
  // 1 s into a 44.1 kHz stereo AAC. Cut after 1152-sample frames, the first one left is 828 samples
  // (44 100 = 38 · 1152 + 324): every later frame is cut 324 samples in, 4 short of an 8-sample group.

  it("the helper's cut encodes to the end, sample-exact", async () => {
    const out = join(dir, "helper.mp3")
    const args = trimAudioArgs(m4a, out, "mp3", 1)
    expect(isFramedMp3Encode(args)).toBe(true)
    await runFfmpeg([...NARROW, ...args])
    // From 1 s (sample 44 100) to the decoded end, as the same cut written as WAV.
    const ref = join(dir, "ref.wav")
    expect(ffmpegDirect(["-y", "-i", m4a, "-ss", "1", "-vn", "-c:a", "pcm_s16le", ref]).ok).toBe(true)
    expect(decodedSamples(out)).toBe(decodedSamples(ref))
  }, 60_000)

  it("the same cut left on the output after the frame size fails there (pinned build) — why the helper owns the cut", async (ctx) => {
    // ffmpeg places an output -ss after the -af chain: its trim re-cuts the 1152-sample frames, and the
    // encode fails on its last one. Another ffmpeg decodes this AAC to other frames and may not meet it.
    if (ffmpegVersion() !== (await loadGolden()).ffmpegVersion) return ctx.skip()
    const naive = ffmpegDirect([...NARROW, "-y", "-i", m4a, "-ss", "1", "-vn", "-af", MP3_FRAME_FILTER, "-c:a", "libmp3lame", join(dir, "naive.mp3")])
    expect(naive.ok).toBe(false)
    expect(naive.stderr).toContain("inadequate AVFrame plane padding")
  }, 60_000)
})

/**
 * Every MP3 that encoded before encodes to the same bytes: the encoder gets the
 * same samples in the same frames. Today's argv (run past the launcher) against
 * the helper's, at a 16-byte alignment and at this machine's own.
 */
describe.skipIf(!hasMp3)("byte-identical to the argv each site built before", () => {
  const fc = "[0:a]volume=1[a0];[1:a]volume=0.8[a1];[a0][a1]amix=inputs=2:duration=longest[aout]"
  const rubberband = buildRubberbandFilter({ semitones: 0, tempo: 0.8, preserveFormants: true })
  /** The reverb preset's MP3 argv before this change: its WAV lane's, with no codec named (an .mp3 output's default). */
  const reverbBefore = () => {
    const wav = buildAudioFxArgs({ audioUrl: "x", preset: "room", mix: 35, format: "wav" }, { inputPath: wav48, outputPath: "", irPath }, 0.05)
    return wav.slice(0, wav.indexOf("-c:a"))
  }
  const lipPcmIn = () => ["-nostdin", "-v", "error", "-protocol_whitelist", "file", "-format_whitelist", "s16le", "-f", "s16le", "-ar", "44100", "-ac", "2", "-i", pcmS16]
  const pcmPart = (start: number, length: number) => ["-y", "-nostats", "-loglevel", "error", "-f", "f32le", "-ar", "48000", "-ch_layout", "stereo", "-skip_initial_bytes", String(start * 2 * 4), "-i", pcmF32]
  // Mixes stay at one sample rate: a mix of tracks at different rates already varies run to run today.
  const cases: Array<[string, () => { before: string[]; after: string[] }, boolean?]> = [
    ["extract audio", () => ({ before: ["-y", "-i", m4a, "-vn", "-acodec", "libmp3lame", "-q:a", "2"], after: extractAudioArgs(m4a, "") })],
    ["trim audio, start and end", () => ({ before: ["-y", "-i", m4a, "-ss", "1.37", "-to", "2.5", "-vn", "-acodec", "libmp3lame"], after: trimAudioArgs(m4a, "", "mp3", 1.37, 2.5) })],
    ["trim audio, start only", () => ({ before: ["-y", "-i", mp3, "-ss", "1", "-vn", "-acodec", "libmp3lame"], after: trimAudioArgs(mp3, "", "mp3", 1) })],
    ["lip-sync audio trim", () => ({ before: ["-i", m4a, "-t", "2.5", "-c:a", "libmp3lame", "-b:a", "192k", "-y"], after: lipSyncAudioTrimArgs(m4a, "", 2.5) })],
    ["speech WAV to MP3", () => ({ before: ["-y", "-i", wav24, "-vn", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k"], after: speechMp3Args(wav24, "", "128k") })],
    ["media process cut", () => ({ before: ["-y", "-ss", "0.37", "-i", m4a, "-t", String(2.5 - 0.37), "-c:a", "libmp3lame"], after: mediaProcessArgs({ inputPath: m4a, outputPath: "", outputExt: "mp3", type: "audio", trim: { startTime: 0.37, endTime: 2.5 } }) })],
    ["mix audio", () => ({ before: ["-y", "-i", mp3, "-i", wav44, "-filter_complex", fc, "-map", "[aout]"], after: mixAudioArgs(["-i", mp3, "-i", wav44], fc, "") })],
    ["audio fx", () => ({ before: ["-y", "-i", wav48, "-af", "highpass=f=300,lowpass=f=3400,equalizer=f=1500:t=q:w=1.2:g=4"], after: buildAudioFxArgs({ audioUrl: "x", preset: "telephone" }, { inputPath: wav48, outputPath: "" }) })],
    // The picture is stream-copied; the AVI muxer's default audio encoder (libmp3lame) is now named and framed.
    ["adjust volume, an AVI video", () => ({ before: ["-y", "-i", avi, "-c:v", "copy", "-af", "volume=0.8,afade=t=in:d=0.5"], after: adjustVolumeArgs(avi, "x.avi", true, ["volume=0.8", "afade=t=in:d=0.5"]) })],
    // loudnorm runs at 192 kHz inside: the resample back to the encoder's rate comes before the MP3 chain's end.
    ["adjust volume, an MP3 with loudnorm and a fade", () => ({ before: ["-y", "-i", mp3, "-af", "volume=1,loudnorm,afade=t=out:d=1"], after: adjustVolumeArgs(mp3, "x.mp3", false, ["volume=1", "loudnorm", "afade=t=out:d=1"]) })],
    ["audio fx, reverb (a -filter_complex graph)", () => ({ before: reverbBefore(), after: buildAudioFxArgs({ audioUrl: "x", preset: "room", mix: 35 }, { inputPath: wav48, outputPath: "", irPath }, 0.05) })],
    ["pitch & tempo, tempo 0.8 (as today, post-#3110)", () => ({ before: ["-y", "-i", wav44, "-vn", "-af", `${rubberband},asetnsamples=n=1152:p=0`, "-c:a", "libmp3lame", "-b:a", "192k"], after: buildPitchTempoArgs({ inputPath: wav44, outputPath: "", lane: "audio", filter: rubberband }) }), hasRubberband],
    ["split media, an odd-length MP3 part", () => ({ before: [...pcmPart(48007, 96003), "-af", "apad=whole_len=96003,atrim=end_sample=96003", "-c:a", "libmp3lame"], after: splitAudioPartArgs(pcmF32, { sampleRate: 48000, channels: 2, layoutArgs: ["-ch_layout", "stereo"] }, 48007, 96003, "mp3", "") })],
    ["combine audio", () => ({ before: ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c:a", "libmp3lame", "-q:a", "2"], after: combineAudioArgs(concatList, "") })],
    ["beat grid, trim and fade", () => ({ before: ["-y", "-i", mp3, "-t", "3", "-af", "afade=t=out:st=2.200:d=0.8,silencedetect=noise=-30dB:d=0.05", "-c:a", "libmp3lame", "-b:a", "192k"], after: beatGridTrimArgs(mp3, "", 3, 0.8) })],
    ["dubbing project audio (FLAC)", () => ({ before: ["-y", "-i", flac, "-vn", "-c:a", "libmp3lame", "-b:a", "192k"], after: dubbingAudioArgs(flac, "") })],
    ["lip-sync prepared audio, padded", () => ({ before: [...lipPcmIn(), "-af", "apad=whole_dur=6", "-c:a", "libmp3lame", "-b:a", "192k", "-y"], after: lipSyncAudioEncodeArgs(pcmS16, "", 6) })],
    ["lip-sync prepared audio, cut", () => ({ before: [...lipPcmIn(), "-t", "2.5", "-c:a", "libmp3lame", "-b:a", "192k", "-y"], after: lipSyncAudioEncodeArgs(pcmS16, "", undefined, 2.5) })],
  ]

  for (const [name, build, when = true] of cases) {
    it.skipIf(!when)(name, async () => {
      const { before, after } = build()
      // The helper's argv ends with its placeholder output path: an empty one is an MP3, else its extension is the container.
      const ext = /\.(\w+)$/.exec(after[after.length - 1] ?? "")?.[1] ?? "mp3"
      for (const align of [NARROW, []] as const) {
        const a = join(dir, `${name.replace(/\W+/g, "-")}-before.${ext}`)
        const b = join(dir, `${name.replace(/\W+/g, "-")}-after.${ext}`)
        const ran = ffmpegDirect([...align, ...before, a])
        expect(ran.ok, ran.stderr).toBe(true)
        // Swap the file in for the placeholder.
        await runFfmpeg([...align, ...after.slice(0, -1), b])
        expect(sha(b), `${name}${align.length ? " (16-byte alignment)" : ""}`).toBe(sha(a))
      }
    }, 60_000)
  }
})
