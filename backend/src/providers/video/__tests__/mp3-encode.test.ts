import { describe, expect, it, vi } from "vitest"
import {
  assertFramedMp3Encode,
  ffmpegTimeMicros,
  isFramedMp3Encode,
  isMp3Encode,
  MP3_DEFAULT_EXTENSIONS,
  MP3_DEFAULT_MUXERS,
  MP3_FRAME_FILTER,
  MP3_FRAME_SAMPLES,
  mp3ChainTail,
  mp3EncodeArgs,
  mp3GraphEncodeArgs,
  writesMp3ByDefault,
} from "../mp3-encode.js"
import { ffmpegArgv } from "../ffmpeg-process.js"
import { extractAudioArgs } from "../extract-audio.js"
import { trimAudioArgs } from "../trim-audio.js"
import { combineAudioArgs } from "../combine-audio.js"
import { splitAudioPartArgs } from "../split-media.js"
import { mixAudioArgs } from "../mix-audio.js"
import { buildAudioFxArgs } from "../audio-fx.js"
import { adjustVolumeArgs } from "../adjust-volume.js"
import { buildPitchTempoArgs } from "../pitch-tempo.js"
import { lipSyncAudioEncodeArgs } from "../../kie/lip-sync-audio.js"
import { lipSyncAudioTrimArgs } from "../../kie/video.js"
import { speechMp3Args } from "../../audio/speech-mp3.js"
import { dubbingAudioArgs } from "../../elevenlabs/dubbing-project.js"
import { mediaProcessArgs } from "../../../routes/media-process.js"

/** ffmpeg's own `aformat` for libmp3lame, as the pinned build prints it (mp3-encode-output.test.ts holds the constants to it). */
const FORMAT_OUT = "aformat=sample_fmts=s32p|fltp|s16p:sample_rates=44100|48000|32000|22050|24000|16000|11025|12000|8000:channel_layouts=mono|stereo"

describe("the MP3 chain's end", () => {
  it("is ffmpeg's own format for the encoder, then 1152-sample frames, the last one unpadded", () => {
    expect(MP3_FRAME_SAMPLES).toBe(1152)
    expect(MP3_FRAME_FILTER).toBe("asetnsamples=n=1152:p=0")
    expect(mp3ChainTail()).toBe(`${FORMAT_OUT},asetnsamples=n=1152:p=0`)
  })

  it("names the one rate an -ar asks for, as ffmpeg's format does", () => {
    expect(mp3ChainTail({ sampleRate: 44100 })).toBe(
      "aformat=sample_fmts=s32p|fltp|s16p:sample_rates=44100:channel_layouts=mono|stereo,asetnsamples=n=1152:p=0",
    )
  })

  it("places a cut where ffmpeg places an output -ss/-t/-to: after the format, before the frame size", () => {
    expect(mp3ChainTail({ cut: { start: 1.37, end: 2.5 } })).toBe(`${FORMAT_OUT},atrim=start=1.370000:duration=1.130000,asetnsamples=n=1152:p=0`)
    expect(mp3ChainTail({ cut: { duration: 299.5 } })).toBe(`${FORMAT_OUT},atrim=duration=299.500000,asetnsamples=n=1152:p=0`)
    expect(mp3ChainTail({ cut: { start: 0 } })).toBe(`${FORMAT_OUT},atrim=start=0.000000,asetnsamples=n=1152:p=0`)
    expect(mp3ChainTail({ cut: { end: 2.501 } })).toBe(`${FORMAT_OUT},atrim=duration=2.501000,asetnsamples=n=1152:p=0`)
    expect(mp3ChainTail({ cut: {} })).toBe(mp3ChainTail())
  })

  it("does ffmpeg's -to arithmetic in whole microseconds, so a float difference cannot move the end", () => {
    // 2.13 − 0.37 is 1.7599999999999998 in floating point; ffmpeg subtracts the microseconds it read.
    expect(mp3ChainTail({ cut: { start: 0.37, end: 2.13 } })).toContain("atrim=start=0.370000:duration=1.760000,")
  })

  it("refuses what ffmpeg refuses: an end not after the start; and a cut or an encoder asked two ways", () => {
    expect(() => mp3ChainTail({ cut: { start: 2, end: 2 } })).toThrow(/not after its start/)
    expect(() => mp3ChainTail({ cut: { start: 3, end: 2 } })).toThrow(/not after its start/)
    expect(() => mp3ChainTail({ cut: { duration: 1, end: 2 } })).toThrow(/not both/)
    expect(() => mp3EncodeArgs({ bitrate: "192k", quality: 2 })).toThrow(/not both/)
    expect(() => mp3ChainTail({ sampleRate: 44100.5 })).toThrow(RangeError)
  })
})

describe("ffmpegTimeMicros reads a time as ffmpeg reads String(seconds)", () => {
  it.each([
    [1.37, 1_370_000],
    [299.5, 299_500_000],
    [15, 15_000_000],
    [0, 0],
    [2.1300000000000003, 2_130_000],
    [1.0000226757, 1_000_022],
    [-0.5, -500_000],
  ])("%s s → %s µs (six fractional digits, the rest ignored)", (seconds, micros) => {
    expect(ffmpegTimeMicros(seconds)).toBe(micros)
  })

  it("refuses a value ffmpeg would not read (an exponent, not finite)", () => {
    expect(() => ffmpegTimeMicros(5e-7)).toThrow(RangeError)
    expect(() => ffmpegTimeMicros(Number.NaN)).toThrow(RangeError)
    expect(() => ffmpegTimeMicros(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe("mp3EncodeArgs / mp3GraphEncodeArgs", () => {
  it("an -af chain: the caller's filters, the chain's end, then libmp3lame and its rate", () => {
    expect(mp3EncodeArgs({ filters: ["volume=0.5", "afade=t=in:d=1"], bitrate: "192k" })).toEqual([
      "-af", `volume=0.5,afade=t=in:d=1,${mp3ChainTail()}`, "-c:a", "libmp3lame", "-b:a", "192k",
    ])
    expect(mp3EncodeArgs({ quality: 2 })).toEqual(["-af", mp3ChainTail(), "-c:a", "libmp3lame", "-q:a", "2"])
    expect(mp3EncodeArgs({ sampleRate: 44100, bitrate: "128k" })).toEqual([
      "-af", mp3ChainTail({ sampleRate: 44100 }), "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k",
    ])
    expect(mp3EncodeArgs()).toEqual(["-af", mp3ChainTail(), "-c:a", "libmp3lame"])
  })

  it("a graph: the chain's end goes on the chain the output label ends", () => {
    expect(mp3GraphEncodeArgs("[0:a]volume=1[a0];[1:a]volume=1[a1];[a0][a1]amix=inputs=2[aout]", "[aout]")).toEqual([
      "-filter_complex", `[0:a]volume=1[a0];[1:a]volume=1[a1];[a0][a1]amix=inputs=2,${mp3ChainTail()}[aout]`,
      "-map", "[aout]", "-c:a", "libmp3lame",
    ])
    expect(() => mp3GraphEncodeArgs("[0:a]volume=1[x];[x]anull[y]", "[aout]")).toThrow(/must end with its output label/)
  })
})

describe("the check every ffmpeg launch passes", () => {
  it("sees an MP3 encode however it is asked for", () => {
    expect(isMp3Encode(["-i", "a.wav", "-c:a", "libmp3lame", "out.bin"])).toBe(true)
    expect(isMp3Encode(["-i", "a.wav", "-acodec", "mp3", "out.bin"])).toBe(true)
    // No codec named: ffmpeg encodes an .mp3 (or -f mp3) output with libmp3lame.
    expect(isMp3Encode(["-y", "-i", "a.wav", "-af", "volume=2", "output.mp3"])).toBe(true)
    expect(isMp3Encode(["-y", "-i", "a.wav", "-af", "volume=2", "OUT.MP3"])).toBe(true)
    expect(isMp3Encode(["-i", "a.wav", "-f", "mp3", "pipe:1"])).toBe(true)
  })

  it("does not take a stream copy, another codec, an MP3 input or a muted output for an MP3 encode", () => {
    expect(isMp3Encode(["-i", "tone.mp3", "-i", "art.png", "-map", "0", "-map", "1", "-c", "copy", "cover.mp3"])).toBe(false)
    expect(isMp3Encode(["-i", "a.mp3", "-c:a", "aac", "out.m4a"])).toBe(false)
    expect(isMp3Encode(["-f", "mp3", "-i", "pipe:0", "-c:a", "pcm_s16le", "out.wav"])).toBe(false)
    expect(isMp3Encode(["-i", "a.mp3", "-vn", "-c:a", "pcm_s16le", "out.wav"])).toBe(false)
    expect(isMp3Encode(["-i", "v.mp4", "-an", "-c:v", "copy", "x.mp3"])).toBe(false)
  })

  it("passes only an encode whose chain ends with the MP3 chain's end, nothing cut after it", () => {
    expect(isFramedMp3Encode(["-y", "-i", "a.wav", ...mp3EncodeArgs({ cut: { start: 1, end: 2 } }), "o.mp3"])).toBe(true)
    expect(isFramedMp3Encode(["-y", "-i", "a.wav", "-i", "b.wav", ...mp3GraphEncodeArgs("[0:a][1:a]amix=inputs=2[aout]", "[aout]"), "o.mp3"])).toBe(true)
    // The encoder named directly, or the frame size before an output cut: refused.
    expect(isFramedMp3Encode(["-y", "-i", "a.wav", "-c:a", "libmp3lame", "o.mp3"])).toBe(false)
    expect(isFramedMp3Encode(["-y", "-i", "a.wav", "-af", `volume=1,${MP3_FRAME_FILTER}`, "-c:a", "libmp3lame", "o.mp3"])).toBe(false)
    expect(isFramedMp3Encode(["-y", "-i", "a.wav", "-ss", "1", ...mp3EncodeArgs(), "o.mp3"])).toBe(false)
    expect(isFramedMp3Encode(["-y", "-i", "a.wav", ...mp3EncodeArgs(), "-t", "3", "o.mp3"])).toBe(false)
    expect(isFramedMp3Encode(["-y", "-i", "a.wav", ...mp3EncodeArgs(), "-shortest", "o.mp3"])).toBe(false)
    // An input-side seek is before the chain: allowed.
    expect(isFramedMp3Encode(["-y", "-ss", "1", "-i", "a.wav", ...mp3EncodeArgs(), "o.mp3"])).toBe(true)
    // The framed chain must be the one the map names, and end the graph.
    expect(isFramedMp3Encode(["-i", "a.wav", "-filter_complex", `[0:a]${mp3ChainTail()}[x];[x]volume=2[aout]`, "-map", "[aout]", "-c:a", "libmp3lame", "o.mp3"])).toBe(false)
  })

  it("sees an MP3 encode by a container's default: no audio codec named in a muxer whose default audio is MP3", () => {
    // The muxers the pinned ffmpeg encodes MP3 into by default (mp3-encode-output.test.ts holds the list to it).
    expect([...MP3_DEFAULT_MUXERS]).toEqual(["avi", "avm2", "flv", "mp3", "swf"])
    expect([...MP3_DEFAULT_EXTENSIONS]).toEqual(["avi", "flv", "mp3", "swf"])
    for (const out of ["output.avi", "output.FLV", "clip.swf"]) {
      expect(isMp3Encode(["-y", "-i", "input.avi", "-c:v", "copy", "-af", "volume=1", out]), out).toBe(true)
      expect(writesMp3ByDefault(`/w/${out}`), out).toBe(true)
    }
    expect(isMp3Encode(["-i", "in.wav", "-f", "avi", "pipe:1"])).toBe(true)
    expect(isMp3Encode(["-i", "in.wav", "-f", "avm2", "out.bin"])).toBe(true)
    // An audio codec named, the audio dropped, or a container whose default is another codec: not an MP3 encode.
    expect(isMp3Encode(["-i", "in.avi", "-c:v", "copy", "-c:a", "pcm_s16le", "output.avi"])).toBe(false)
    expect(isMp3Encode(["-i", "in.avi", "-c:v", "copy", "-an", "output.avi"])).toBe(false)
    expect(isMp3Encode(["-i", "in.avi", "-c", "copy", "output.avi"])).toBe(false)
    for (const out of ["output.mp4", "output.mov", "output.mkv", "output.webm", "output.nut", "output.wav", "output.m4a"]) {
      expect(isMp3Encode(["-i", "in.wav", "-af", "volume=1", out]), out).toBe(false)
      expect(writesMp3ByDefault(`/w/${out}`), out).toBe(false)
    }
  })

  it("reads each output's own options, as ffmpeg does: options before an -i are that input's", () => {
    // A decoder chosen on an input is not an encode; the WAV output is.
    expect(isMp3Encode(["-c:a", "mp3", "-i", "in.mp3", "-f", "wav", "out.wav"])).toBe(false)
    // An input-side codec does not hide an output's implicit MP3 encode.
    expect(isMp3Encode(["-c:a", "libopus", "-i", "x.webm", "-vn", "out.mp3"])).toBe(true)
    // No output: a probe of an MP3, not an encode.
    expect(isMp3Encode(["-i", "song.mp3"])).toBe(false)
    expect(isMp3Encode(["-hide_banner", "-i", "song.mp3", "-f", "null", "-"])).toBe(false)
  })

  it("reads past global options and their values first, a value that starts with a dash included (-cpuflags)", () => {
    const narrow = ["-cpuflags", "-avx512-avx512icl-avx2-avx-fma3-fma4-xop-avxslow"]
    for (const prefix of [["-cpuflags", "-avx512f", "-threads", "2"], narrow, ["-hide_banner", "-nostdin", "-v", "error", "-y", "-filter_threads", "2", ...narrow]]) {
      const framed = [...prefix, "-i", "in.wav", ...mp3EncodeArgs({ cut: { start: 1 } }), "out.mp3"]
      expect(isMp3Encode(framed), prefix.join(" ")).toBe(true)
      expect(isFramedMp3Encode(framed), prefix.join(" ")).toBe(true)
      expect(() => ffmpegArgv(framed)).not.toThrow()
      const graph = [...prefix, "-i", "a.wav", "-i", "b.wav", ...mp3GraphEncodeArgs("[0:a][1:a]amix=inputs=2[aout]", "[aout]"), "out.mp3"]
      expect(isFramedMp3Encode(graph), prefix.join(" ")).toBe(true)
      const unframed = [...prefix, "-i", "in.wav", "-ss", "1", "-c:a", "libmp3lame", "out.mp3"]
      expect(isMp3Encode(unframed), prefix.join(" ")).toBe(true)
      expect(isFramedMp3Encode(unframed), prefix.join(" ")).toBe(false)
      expect(() => ffmpegArgv(unframed)).toThrow(/codec=libmp3lame chain=none tail=no cut=-ss/)
    }
  })

  it("sees the encoder named with a stream specifier", () => {
    expect(isMp3Encode(["-i", "a.wav", "-c:a:0", "mp3", "out.mka"])).toBe(true)
    expect(isMp3Encode(["-i", "a.wav", "-codec:a:0", "libmp3lame", "out.mka"])).toBe(true)
    expect(isMp3Encode(["-i", "a.wav", "-acodec:0", "mp3", "out.mka"])).toBe(true)
    expect(isMp3Encode(["-i", "a.wav", "-c:v", "mp3", "out.mka"])).toBe(false)
  })

  it("judges every MP3 output of a launch with several", () => {
    const framed = [...mp3EncodeArgs(), "a.mp3"]
    expect(isFramedMp3Encode(["-y", "-i", "in.wav", ...framed, ...mp3EncodeArgs({ quality: 2 }), "b.mp3"])).toBe(true)
    // The second output is an MP3 too, encoded outside the helper.
    expect(isMp3Encode(["-y", "-i", "in.wav", ...framed, "-c:a", "libmp3lame", "b.mp3"])).toBe(true)
    expect(isFramedMp3Encode(["-y", "-i", "in.wav", ...framed, "-c:a", "libmp3lame", "b.mp3"])).toBe(false)
    expect(isFramedMp3Encode(["-y", "-i", "in.wav", ...framed, "b.mp3"])).toBe(false)
    // A WAV beside a framed MP3 does not matter.
    expect(isFramedMp3Encode(["-y", "-i", "in.wav", ...framed, "-c:a", "pcm_s16le", "b.wav"])).toBe(true)
    // A graph with two MP3 outputs: each mapped chain must end with the MP3 chain's end.
    const graph = `[0:a]asplit=2[x][y];[x]volume=1,${mp3ChainTail()}[a];[y]volume=2,${mp3ChainTail()}[b]`
    expect(isFramedMp3Encode(["-i", "in.wav", "-filter_complex", graph, "-map", "[a]", "-c:a", "libmp3lame", "a.mp3", "-map", "[b]", "-c:a", "libmp3lame", "b.mp3"])).toBe(true)
    const half = `[0:a]asplit=2[x][y];[x]volume=1,${mp3ChainTail()}[a];[y]volume=2[b]`
    expect(isFramedMp3Encode(["-i", "in.wav", "-filter_complex", half, "-map", "[a]", "-c:a", "libmp3lame", "a.mp3", "-map", "[b]", "-c:a", "libmp3lame", "b.mp3"])).toBe(false)
  })

  it("takes -filter:a (the long spelling of -af) as unframed: the helper writes -af", () => {
    expect(isFramedMp3Encode(["-i", "a.wav", "-filter:a", mp3ChainTail(), "-c:a", "libmp3lame", "o.mp3"])).toBe(false)
  })

  it("throws under test for an MP3 encode built any other way, at the launcher itself", () => {
    expect(() => assertFramedMp3Encode(["-y", "-i", "a.wav", "out.mp3"])).toThrow(/mp3EncodeArgs/)
    expect(() => ffmpegArgv(["-y", "-i", "a.wav", "-c:a", "libmp3lame", "out.mp3"])).toThrow(/mp3EncodeArgs/)
    expect(() => ffmpegArgv(["-y", "-i", "a.wav", ...mp3EncodeArgs(), "out.mp3"])).not.toThrow()
    expect(() => ffmpegArgv(["-y", "-i", "a.wav", "-c:a", "aac", "out.m4a"])).not.toThrow()
  })
})

/**
 * Every MP3 encode site, CPU-independent: each builds its argv through the
 * helper, so the chain ends with the encoder's frame size and no cut sits on
 * the output. Before this change every one of them failed this check (the
 * encoder named directly, `-t`/`-ss`/`-to` on the output, or an `.mp3` output
 * with no codec).
 */
describe("every MP3 encode site builds its argv through the helper", () => {
  const pcm = { sampleRate: 48000, channels: 2, layoutArgs: ["-ch_layout", "stereo"] }
  const sites: Array<[string, string[]]> = [
    ["extract audio (and the voice changer's extract)", extractAudioArgs("/w/in.mp4", "/w/audio.mp3")],
    ["trim audio, no cut", trimAudioArgs("/w/in.mp4", "/w/output.mp3", "mp3")],
    ["trim audio, start and end", trimAudioArgs("/w/in.mp4", "/w/output.mp3", "mp3", 1.37, 2.5)],
    ["trim audio, end only", trimAudioArgs("/w/in.mp4", "/w/output.mp3", "mp3", undefined, 2.5)],
    ["combine audio", combineAudioArgs("/w/list.txt", "/w/output.mp3")],
    ["split media, an MP3 part", splitAudioPartArgs("/w/audio.pcm", pcm, 96000, 240000, "mp3", "/w/audio-part-00001.mp3")],
    ["mix audio", mixAudioArgs(["-i", "/w/a.mp3", "-i", "/w/b.wav"], "[0:a]volume=1[a0];[1:a]volume=1[a1];[a0][a1]amix=inputs=2:duration=longest[aout]", "/w/output.mp3")],
    ["audio fx, a chain preset", buildAudioFxArgs({ audioUrl: "x", preset: "telephone" }, { inputPath: "/w/in.mp3", outputPath: "/w/output.mp3" })],
    ["audio fx, reverb", buildAudioFxArgs({ audioUrl: "x", preset: "room" }, { inputPath: "/w/in.mp3", outputPath: "/w/output.mp3", irPath: "/w/ir.f32" })],
    ["adjust volume, an MP3", adjustVolumeArgs("/w/input.mp3", "/w/output.mp3", false, ["volume=0.8", "afade=t=in:d=1"])],
    ["adjust volume, an MP3 on the video lane", adjustVolumeArgs("/w/input.mp3", "/w/output.mp3", true, ["volume=0.8"])],
    ["adjust volume, an AVI (its default audio is MP3)", adjustVolumeArgs("/w/input.avi", "/w/output.avi", true, ["volume=0.8", "loudnorm"])],
    ["adjust volume, an FLV (its default audio is MP3)", adjustVolumeArgs("/w/input.flv", "/w/output.flv", true, ["volume=0.8"])],
    ["pitch & tempo, audio lane", buildPitchTempoArgs({ inputPath: "/w/in.wav", outputPath: "/w/output.mp3", lane: "audio", filter: "rubberband=pitch=1:tempo=0.8:formant=preserved:pitchq=quality" })],
    ["lip-sync prepared audio", lipSyncAudioEncodeArgs("/w/decoded.pcm", "/w/prepared.mp3", undefined)],
    ["lip-sync prepared audio, padded", lipSyncAudioEncodeArgs("/w/decoded.pcm", "/w/prepared.mp3", 4)],
    ["lip-sync prepared audio, cut", lipSyncAudioEncodeArgs("/w/decoded.pcm", "/w/prepared.mp3", undefined, 299.5)],
    ["lip-sync audio trim (KIE)", lipSyncAudioTrimArgs("/w/input.wav", "/w/trimmed.mp3", 15)],
    ["speech WAV to MP3", speechMp3Args("/w/speech.wav", "/w/speech.mp3", "192k")],
    ["dubbing project audio", dubbingAudioArgs("/w/dub.flac", "/w/dub.mp3")],
    ["media process, an MP3 cut", mediaProcessArgs({ inputPath: "/w/input.mp3", outputPath: "/w/output.mp3", outputExt: "mp3", type: "audio", trim: { startTime: 0.37, endTime: 2.5 } })],
    ["media process, an MP3", mediaProcessArgs({ inputPath: "/w/input.wav", outputPath: "/w/output.mp3", outputExt: "mp3", type: "audio" })],
  ]

  it.each(sites)("%s", (_name, args) => {
    expect(isMp3Encode(args)).toBe(true)
    expect(isFramedMp3Encode(args)).toBe(true)
    expect(() => ffmpegArgv(args)).not.toThrow()
  })

  it("the non-MP3 lanes beside them are unchanged (no MP3 chain end)", () => {
    for (const args of [
      trimAudioArgs("/w/in.mp4", "/w/output.wav", "wav", 1, 2),
      trimAudioArgs("/w/in.mp4", "/w/output.aac", "aac"),
      splitAudioPartArgs("/w/audio.pcm", pcm, 0, 1024, "aac", "/w/part.m4a"),
      buildAudioFxArgs({ audioUrl: "x", preset: "echo", format: "wav" }, { inputPath: "/w/in.mp3", outputPath: "/w/out.wav" }),
      adjustVolumeArgs("/w/input.wav", "/w/output.wav", false, ["volume=0.8"]),
      adjustVolumeArgs("/w/input.mp4", "/w/output.mp4", true, ["volume=0.8"]),
      adjustVolumeArgs("/w/input.mov", "/w/output.mov", true, ["volume=0.8"]),
      mediaProcessArgs({ inputPath: "/w/input.mp3", outputPath: "/w/output.wav", outputExt: "wav", type: "audio", trim: { startTime: 1, endTime: 2 } }),
    ]) {
      expect(isMp3Encode(args)).toBe(false)
      expect(args.join(" ")).not.toContain(MP3_FRAME_FILTER)
    }
    // The video lane keeps its picture by stream copy, MP3 container or not.
    expect(adjustVolumeArgs("/w/input.avi", "/w/output.avi", true, ["volume=0.8"])).toEqual(["-y", "-i", "/w/input.avi", "-c:v", "copy", ...mp3EncodeArgs({ filters: ["volume=0.8"] }), "/w/output.avi"])
    expect(adjustVolumeArgs("/w/input.mp4", "/w/output.mp4", true, ["volume=0.8"])).toEqual(["-y", "-i", "/w/input.mp4", "-c:v", "copy", "-af", "volume=0.8", "/w/output.mp4"])
    expect(trimAudioArgs("/w/in.mp4", "/w/output.wav", "wav", 1, 2)).toEqual(["-y", "-i", "/w/in.mp4", "-ss", "1", "-to", "2", "-vn", "-acodec", "pcm_s16le", "/w/output.wav"])
    expect(mediaProcessArgs({ inputPath: "/w/i.mp3", outputPath: "/w/o.wav", outputExt: "wav", type: "audio", trim: { startTime: 1, endTime: 2.5 } })).toEqual([
      "-y", "-ss", "1", "-i", "/w/i.mp3", "-t", "1.5", "-c:a", "pcm_s16le", "/w/o.wav",
    ])
  })
})

describe("the production warning", () => {
  it("logs an unframed encode's shape and call site once per process — never its argv", () => {
    const saved = process.env.VITEST
    delete process.env.VITEST
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const signed = "https://bucket.example/in.wav?X-Amz-Signature=deadbeef"
      const args = ["-y", "-i", signed, "-t", "3", "-c:a", "libmp3lame", "/w/job-1234/out.mp3"]
      for (let i = 0; i < 3; i++) assertFramedMp3Encode(args)
      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0]![0])
      expect(line).toContain("codec=libmp3lame chain=none tail=no cut=-t")
      expect(line).toMatch(/ at providers\/video\/__tests__\/mp3-encode\.test\.ts:\d+/)
      for (const leak of ["X-Amz", "deadbeef", "bucket.example", "in.wav", "job-1234", "out.mp3"]) expect(line).not.toContain(leak)
      // Another shape is logged on its own; framed and non-MP3 launches never.
      for (let i = 0; i < 2; i++) assertFramedMp3Encode(["-y", "-i", "/w/in.avi", "-c:v", "copy", "-af", "volume=2", "/w/out.avi"])
      assertFramedMp3Encode(["-y", "-i", "/w/in.wav", ...mp3EncodeArgs(), "/w/out.mp3"])
      assertFramedMp3Encode(["-y", "-i", "/w/in.wav", "-c:a", "aac", "/w/out.m4a"])
      expect(warn).toHaveBeenCalledTimes(2)
      expect(String(warn.mock.calls[1]![0])).toContain("codec=implicit:avi chain=af tail=no cut=none")
    } finally {
      process.env.VITEST = saved
      warn.mockRestore()
    }
  })

  it("under test the throw names the shape and the argv, to find the launch", () => {
    expect(() => assertFramedMp3Encode(["-y", "-i", "a.wav", "-ss", "1", ...mp3EncodeArgs(), "o.mp3"])).toThrow(/codec=libmp3lame chain=af tail=yes cut=-ss.*ffmpeg -y -i a\.wav/)
  })
})
