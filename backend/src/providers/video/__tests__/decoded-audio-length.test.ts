// @test-reads-none reads only the audio files it makes with ffmpeg in a temp dir
/**
 * The audio a per-second-rate lip-sync model is priced on and sent (decided
 * 2026-11-12): its first audio track decoded into one PCM shape (44.1 kHz
 * stereo s16le) and counted in sample frames — never what its container
 * declares, never its timestamps — from a local file in one of the containers
 * the lane takes, and nothing else; a file the decoder cannot read to its end
 * is refused. The argv is pinned here; the real ffmpeg runs where it is on
 * PATH (Backend Tests install the production-pinned build).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AudioReadStoppedError,
  CALLER_AUDIO_FORMATS,
  damagePosition,
  decodeAudioToPcm,
  decodedAudioArgs,
  decodedPcmInputArgs,
  gapFillFilter,
  isAudioReadStopped,
  isStoppedLaunch,
  measureDecodedAudio,
  reportsDamage,
} from "../decoded-audio-length.js"
import { probeMediaFormatAndDuration } from "../ffmpeg-utils.js"
import { aliasReferenceMov } from "./fixtures/alias-reference-mov.js"

const FORMATS = "mp3,wav,w64,aiff,caf,au,mov,aac,ac3,eac3,amr,ogg,flac,matroska,asf,mpegts,avi,mpeg,flv,dts,wv,ape,tta,mpc,mpc8,loas"
const WHITELIST = ["-protocol_whitelist", "file", "-format_whitelist", FORMATS]

describe("the pieces", () => {
  it("decodes the first audio track of a local file in a container the lane takes to 44.1 kHz stereo s16le, gaps filled, stopped one sample frame past the cap", () => {
    expect(decodedAudioArgs("in", "in.pcm", 300)).toEqual([
      "-nostdin", "-v", "error", ...WHITELIST, "-i", "in", "-map", "0:a:0", "-vn", "-af", gapFillFilter(300),
      "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", "-f", "s16le", "-fs", String((300 * 44_100 + 1) * 4), "-y", "in.pcm",
    ])
    // Our own files are read as the one container we wrote.
    expect(decodedAudioArgs("ours.mp3", "ours.pcm", 301, ["mp3"]).slice(3, 7)).toEqual(["-protocol_whitelist", "file", "-format_whitelist", "mp3"])
  })

  it("gaps are filled after the conversion: timestamps never step back, one gap is at most the cap and a second, jumps of 0.1 s or more become silence", () => {
    expect(gapFillFilter(300)).toBe(
      "aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo," +
        "asetpts='st(1,if(ld(2),min(max(PTS,ld(0)),ld(0)+13274100/(SR*TB)),PTS));st(0,ld(1)+NB_SAMPLES/(SR*TB));st(2,1);ld(1)'," +
        "aresample=async=1:min_hard_comp=0.1",
    )
  })

  it("damage counts only as the DEMUXER reports it: the Ogg demuxer's CRC line, Matroska's structure errors once the file is open", () => {
    expect(reportsDamage("[in#0/ogg @ 0x7a] CRC mismatch!")).toBe(true)
    expect(reportsDamage("[in#0 @ 0x7a] CRC mismatch!")).toBe(true) // the Ogg demuxer reading the last pages as the file opens
    expect(reportsDamage("[ape @ 0x7a] CRC mismatch!")).toBe(false) // a decoder's own check (Monkey's Audio)
    expect(reportsDamage("[aist#0:0/ape @ 0x7a] [dec:ape @ 0x7b] CRC mismatch!")).toBe(false)
    expect(reportsDamage("[in#0/matroska,webm @ 0x7a] Element at 0x25610 ending at 0x26b69 exceeds containing master element ending at 0x2574f")).toBe(true)
    expect(reportsDamage("[in#0/matroska,webm @ 0x7a] 0x00 at pos 148900 (0x245a4) invalid as first byte of an EBML number")).toBe(true)
    expect(reportsDamage("[in#0 @ 0x7a] Length 8 indicated by an EBML number's first byte 0x01 at pos 365 (0x16d) exceeds max length 4.")).toBe(false)
  })

  it("a Matroska damage line names the byte it found (decimal \"at pos\", or hex \"Element at\")", () => {
    expect(damagePosition("[in#0/matroska,webm @ 0x7a] 0x00 at pos 148900 (0x245a4) invalid as first byte of an EBML number")).toBe(148_900)
    expect(damagePosition("[in#0/matroska,webm @ 0x7a] Length 5 indicated by an EBML number's first byte 0x02 at pos 43746 (0xaae2) exceeds max length 4.")).toBe(43_746)
    expect(damagePosition("[in#0/matroska,webm @ 0x7a] Element at 0x25610 ending at 0x26b69 exceeds containing master element ending at 0x2574f")).toBe(0x25610)
    expect(damagePosition("[in#0/ogg @ 0x7a] CRC mismatch!")).toBeUndefined()
  })

  it("the containers a caller's audio may come in", () => {
    expect(CALLER_AUDIO_FORMATS.join(",")).toBe(FORMATS)
  })

  it("the decoded PCM is read back as exactly that PCM, a local file only", () => {
    expect(decodedPcmInputArgs()).toEqual(["-protocol_whitelist", "file", "-format_whitelist", "s16le", "-f", "s16le", "-ar", "44100", "-ac", "2"])
  })

  it("a stopped launch is told apart from ffmpeg refusing the file, and from a read that stopped part-way", () => {
    expect(isStoppedLaunch(Object.assign(new Error("ffmpeg failed: killed"), { killed: true }))).toBe(true)
    expect(isStoppedLaunch(new Error("ffmpeg failed: Invalid data found when processing input"))).toBe(false)
    expect(isStoppedLaunch(undefined)).toBe(false)
    const stopped = new AudioReadStoppedError("Error during demuxing: Invalid data found when processing input")
    expect(isAudioReadStopped(stopped)).toBe(true)
    expect(isStoppedLaunch(stopped)).toBe(false)
    expect(isAudioReadStopped(new Error("ffmpeg failed: Invalid data found when processing input"))).toBe(false)
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

/** Real encodes and decodes: room for a slow CI host. */
const REAL_MEDIA_TIMEOUT_MS = 30_000

describe.skipIf(!hasFfmpeg)("measureDecodedAudio (real ffmpeg)", () => {
  let dir = ""
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decoded-audio-length-"))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("counts the sample frames a WAV holds, exactly", async () => {
    const wav = join(dir, "tone.wav")
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "12.5", "-ac", "2", wav)
    expect(await measureDecodedAudio(wav, { capSec: 300 })).toEqual({ overCap: false, samples: 551_250, seconds: 12.5 })
  }, REAL_MEDIA_TIMEOUT_MS)

  it("decodeAudioToPcm keeps the PCM it counted (4 bytes a sample frame); measureDecodedAudio leaves none behind", async () => {
    const wav = join(dir, "keep.wav")
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=48000", "-t", "3", "-ac", "1", wav)
    const pcm = join(dir, "keep.pcm")
    expect(await decodeAudioToPcm(wav, pcm, { capSec: 300 })).toEqual({ overCap: false, samples: 132_300, seconds: 3 })
    expect((await stat(pcm)).size).toBe(132_300 * 4)
    await measureDecodedAudio(wav, { capSec: 300 })
    await expect(readFile(`${wav}.decoded.pcm`)).rejects.toThrow()
  }, REAL_MEDIA_TIMEOUT_MS)

  it("a sample-rate change mid-stream does not restart the count (60 s at 22.05 kHz, then 1 s at 44.1 kHz, plays 61 s)", async () => {
    const a = join(dir, "a.mp3")
    const b = join(dir, "b.mp3")
    ffmpeg("-f", "lavfi", "-i", "sine=f=300:r=22050", "-t", "60", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "32k", "-write_xing", "0", "-id3v2_version", "0", a)
    ffmpeg("-f", "lavfi", "-i", "sine=f=300:r=44100", "-t", "1", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", "-write_xing", "0", "-id3v2_version", "0", b)
    const joined = join(dir, "joined.mp3")
    await writeFile(joined, Buffer.concat([await readFile(a), await readFile(b)]))
    const length = await measureDecodedAudio(joined, { capSec: 300 })
    expect(length?.overCap).toBe(false)
    // Encoder priming/padding of two header-less files: within a few MP3 frames of 61 s.
    expect(length && !length.overCap ? length.seconds : 0).toBeGreaterThan(61)
    expect(length && !length.overCap ? length.seconds : 0).toBeLessThan(61.2)
  }, REAL_MEDIA_TIMEOUT_MS)

  it("stops at the cap: a file that plays past it is overCap, with no length", async () => {
    const wav = join(dir, "long.wav")
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=8000", "-t", "60", "-ac", "1", wav)
    expect(await measureDecodedAudio(wav, { capSec: 10 })).toEqual({ overCap: true })
    // Exactly at the cap is not over it.
    expect(await measureDecodedAudio(wav, { capSec: 60 })).toEqual({ overCap: false, samples: 2_646_000, seconds: 60 })
  }, REAL_MEDIA_TIMEOUT_MS)

  it("a file the decoder cannot read, or with no audio track, rejects (the caller decides) and leaves no PCM", async () => {
    const junk = join(dir, "junk.mp3")
    await writeFile(junk, "not audio at all")
    await expect(measureDecodedAudio(junk, { capSec: 300 })).rejects.toThrow()
    const video = join(dir, "video-only.mp4")
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:r=10", "-t", "1", "-c:v", "mpeg4", video)
    const err = await measureDecodedAudio(video, { capSec: 300 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isStoppedLaunch(err)).toBe(false)
    await expect(readFile(`${video}.decoded.pcm`)).rejects.toThrow()
  }, REAL_MEDIA_TIMEOUT_MS)

  describe("read to its end, or refused", () => {
    /** Two Ogg files joined byte for byte: a chained Ogg, each a link of its own. */
    const chain = async (name: string, first: string[], second: string[]): Promise<string> => {
      const a = join(dir, `${name}-1.ogg`)
      const b = join(dir, `${name}-2.ogg`)
      ffmpeg("-f", "lavfi", "-i", "sine=f=300:r=48000", "-t", "5", ...first, a)
      ffmpeg("-f", "lavfi", "-i", "sine=f=500:r=48000", "-t", "5", ...second, b)
      const out = join(dir, `${name}.ogg`)
      await writeFile(out, Buffer.concat([await readFile(a), await readFile(b)]))
      return out
    }
    const vorbis = (channels: number, rate: number) => ["-ac", String(channels), "-ar", String(rate), "-strict", "experimental", "-c:a", "vorbis"]

    it("a chained Ogg whose second link changes its sample rate stops after the first link: refused, never counted as 5 s", async () => {
      const f = await chain("rate-change", vorbis(2, 44_100), vorbis(2, 22_050))
      const err = await measureDecodedAudio(f, { capSec: 300 }).catch((e: unknown) => e)
      expect(isAudioReadStopped(err)).toBe(true)
      expect(String(err)).toMatch(/Error during demuxing/)
      await expect(readFile(`${f}.decoded.pcm`)).rejects.toThrow()
    }, REAL_MEDIA_TIMEOUT_MS)

    it.skipIf(!encoders?.includes("libopus"))("a chained Ogg/Opus whose second link changes its channels (mono, then stereo): refused", async () => {
      const f = await chain("channel-change", ["-ac", "1", "-c:a", "libopus"], ["-ac", "2", "-c:a", "libopus"])
      expect(isAudioReadStopped(await measureDecodedAudio(f, { capSec: 300 }).catch((e: unknown) => e))).toBe(true)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a chained Ogg whose links match is read through: both links counted", async () => {
      const f = await chain("same-shape", vorbis(2, 44_100), vorbis(2, 44_100))
      const length = await measureDecodedAudio(f, { capSec: 300 })
      expect(length && !length.overCap ? length.seconds : 0).toBeGreaterThan(9.99)
      expect(length && !length.overCap ? length.seconds : 0).toBeLessThan(10.1)
    }, REAL_MEDIA_TIMEOUT_MS)

    /** Honest files ffmpeg reads to the end past a harmless error — each one `-xerror` would refuse. */
    const harmless: Array<[string, string, (f: string) => Promise<void>, number]> = [
      ["an MP3 with one damaged frame mid-file (the decoder skips it)", "damaged.mp3", async (f) => {
        ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "10", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", f)
        const bytes = await readFile(f)
        bytes.fill(0x55, bytes.length >> 1, (bytes.length >> 1) + 300)
        await writeFile(f, bytes)
      }, 9.9],
      ["an MPEG-TS with one 188-byte packet missing", "dropped.ts", async (f) => {
        ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=48000", "-t", "10", "-ac", "2", "-c:a", "mp2", "-f", "mpegts", f)
        const bytes = await readFile(f)
        const at = Math.floor(bytes.length / 188 / 2) * 188
        await writeFile(f, Buffer.concat([bytes.subarray(0, at), bytes.subarray(at + 188)]))
      }, 9.8],
      ["a WAV written as a stream (its sizes say 0xFFFFFFFF)", "stream.wav", async (f) => {
        ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=48000", "-t", "10", "-ac", "2", "-c:a", "pcm_s16le", f)
        const bytes = await readFile(f)
        bytes.writeUInt32LE(0xffff_ffff, 4)
        bytes.writeUInt32LE(0xffff_ffff, bytes.indexOf("data") + 4)
        await writeFile(f, bytes)
      }, 9.99],
      ["an MP3 with 4 KB of junk bytes in front of it", "junk-first.mp3", async (f) => {
        ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "10", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "0", f)
        const junk = Buffer.alloc(4096)
        for (let i = 0; i < junk.length; i++) junk[i] = (i * 7919 + 13) & 0xff
        await writeFile(f, Buffer.concat([junk, await readFile(f)]))
      }, 9.99],
    ]
    it.each(harmless)("%s still measures to its end", async (_label, name, make, atLeast) => {
      const f = join(dir, `harmless-${name}`)
      await make(f)
      const length = await measureDecodedAudio(f, { capSec: 300 })
      expect(length && !length.overCap ? length.seconds : 0).toBeGreaterThan(atLeast)
      expect(length && !length.overCap ? length.seconds : 99).toBeLessThan(10.1)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a file cut off part-way: an MP3 (which states no exact length) is read to where it ends and priced on what it holds; a WavPack (which states 10 s) is refused", async () => {
      const mp3 = join(dir, "cut.mp3")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "10", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", mp3)
      const mp3Bytes = await readFile(mp3)
      await writeFile(mp3, mp3Bytes.subarray(0, Math.floor(mp3Bytes.length * 0.6)))
      const length = await measureDecodedAudio(mp3, { capSec: 300 })
      expect(length && !length.overCap ? length.seconds : 0).toBeCloseTo(6, 0)

      const wv = join(dir, "cut.wv")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "10", "-ac", "2", "-c:a", "wavpack", wv)
      const wvBytes = await readFile(wv)
      // Cut inside a block's body (64 bytes past a 32-byte block header), where its demuxer also logs an error.
      const block = wvBytes.lastIndexOf("wvpk", Math.floor(wvBytes.length * 0.6))
      expect(block).toBeGreaterThan(0)
      await writeFile(wv, wvBytes.subarray(0, block + 32 + 64))
      expect(isAudioReadStopped(await measureDecodedAudio(wv, { capSec: 300 }).catch((e: unknown) => e))).toBe(true)
    }, REAL_MEDIA_TIMEOUT_MS)
  })

  it("an M4A with its index at the end is measured the same as its declaration says (an honest file)", async () => {
    const m4a = join(dir, "moov-end.m4a")
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "10.04", "-ac", "1", "-c:a", "aac", m4a)
    const length = await measureDecodedAudio(m4a, { capSec: 300 })
    const declared = (await probeMediaFormatAndDuration(m4a)).durationSec ?? 0
    expect(length && !length.overCap ? length.seconds : 0).toBeCloseTo(declared, 1)
    expect(length && !length.overCap ? Math.ceil(length.seconds) : 0).toBe(11)
  }, REAL_MEDIA_TIMEOUT_MS)

  describe("only a local file, only the containers the lane takes", () => {
    /** A 5 s MP3 a playlist or script below points at, by a local path. */
    let seg = ""
    beforeAll(() => {
      seg = join(dir, "seg.mp3")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "5", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", seg)
    })

    /** Whether ffmpeg, with no whitelist, decodes `path` (and so reads what it points at). */
    const decodesWithoutWhitelist = (path: string): boolean => {
      try {
        execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", path, "-map", "0:a:0", "-f", "null", "-"], { stdio: "ignore" })
        return true
      } catch {
        return false
      }
    }

    it("an HLS playlist pointing at a local file is refused (without the whitelist, ffmpeg reads that file)", async () => {
      const m3u8 = join(dir, "list.m3u8")
      await writeFile(m3u8, `#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:5,\n${seg}\n#EXT-X-ENDLIST\n`)
      expect(decodesWithoutWhitelist(m3u8)).toBe(true)
      await expect(measureDecodedAudio(m3u8, { capSec: 300 })).rejects.toThrow(/not on whitelist/i)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("an ffconcat script pointing at a local file is refused (without the whitelist, ffmpeg reads that file)", async () => {
      const script = join(dir, "list.ffconcat")
      // A name beside the script (the concat demuxer's default refuses an absolute path, not this).
      await writeFile(script, "ffconcat version 1.0\nfile seg.mp3\n")
      expect(decodesWithoutWhitelist(script)).toBe(true)
      await expect(measureDecodedAudio(script, { capSec: 300 })).rejects.toThrow(/not on whitelist/i)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a DASH manifest pointing at a local file is refused", async () => {
      const mpd = join(dir, "list.mpd")
      await writeFile(
        mpd,
        `<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT5S" minBufferTime="PT2S" ` +
          `profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"><Period><AdaptationSet mimeType="audio/mpeg"><Representation id="a" bandwidth="128000">` +
          `<BaseURL>${seg}</BaseURL></Representation></AdaptationSet></Period></MPD>\n`,
      )
      // A build without the DASH demuxer cannot read it at all; one with it is stopped by the whitelist.
      await expect(measureDecodedAudio(mpd, { capSec: 300 })).rejects.toThrow()
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a MOV that names a file beside it for its samples (an alias data reference) reads nothing: refused", async () => {
      // The layout the alias names: <root>/job/input (the downloaded file) and <root>/secret/ext.m4a.
      const root = join(dir, "dref")
      await mkdir(join(root, "job"), { recursive: true })
      await mkdir(join(root, "secret"), { recursive: true })
      const ext = join(root, "secret", "ext.m4a")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "20", "-ac", "2", "-c:a", "aac", "-movflags", "+faststart", ext)
      const mov = join(root, "job", "input")
      await writeFile(mov, aliasReferenceMov(await readFile(ext), "Vol:x:secret:ext.m4a", 2, 2))
      // The file does name ext.m4a: with ffmpeg's enable_drefs on, its 20 s are read from there.
      const followed = join(root, "followed.pcm")
      execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-enable_drefs", "1", "-i", mov, "-map", "0:a:0", "-ac", "2", "-ar", "44100", "-f", "s16le", followed], { stdio: "ignore" })
      expect((await stat(followed)).size / 4 / 44_100).toBeCloseTo(20, 1)
      // The lane leaves enable_drefs at its default (off): nothing is read, so the run is refused —
      // nothing decoded (undefined) and a rejection are both "could not decode".
      expect(await measureDecodedAudio(mov, { capSec: 300 }).catch(() => undefined)).toBeUndefined()
    }, REAL_MEDIA_TIMEOUT_MS)

    it("-enable_drefs cannot be passed to every input: any container but MOV fails on it", async () => {
      expect(() =>
        execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-format_whitelist", "mp3", "-enable_drefs", "0", "-i", seg, "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] }),
      ).toThrow(/enable_drefs not found/)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("our own MP3, read as MP3 only: a WAV given in its place is refused", async () => {
      const wav = join(dir, "not-ours.wav")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "2", "-ac", "2", wav)
      await expect(measureDecodedAudio(wav, { capSec: 300, formats: ["mp3"] })).rejects.toThrow(/not on whitelist/i)
      expect(await measureDecodedAudio(seg, { capSec: 300, formats: ["mp3"] })).toMatchObject({ overCap: false })
    }, REAL_MEDIA_TIMEOUT_MS)

    const honest: Array<[string, string, string[]]> = [
      ["MP3", "a.mp3", ["-c:a", "libmp3lame", "-b:a", "128k"]],
      ["WAV", "a.wav", ["-c:a", "pcm_s16le"]],
      ["M4A", "a.m4a", ["-c:a", "aac"]],
      ["ADTS AAC", "a.aac", ["-c:a", "aac", "-f", "adts"]],
      ["FLAC", "a.flac", ["-c:a", "flac"]],
      ["Ogg FLAC", "flac.ogg", ["-c:a", "flac"]],
      ["MKA", "a.mka", ["-c:a", "flac"]],
      ["Wave64", "a.w64", ["-c:a", "pcm_s16le"]],
      ["AIFF", "a.aiff", ["-c:a", "pcm_s16be"]],
      ["CAF", "a.caf", ["-c:a", "pcm_s16le"]],
      ["Sun AU", "a.au", ["-c:a", "pcm_s16be"]],
      ["AC-3", "a.ac3", ["-c:a", "ac3"]],
      ["E-AC-3", "a.eac3", ["-c:a", "eac3"]],
      ["WMA", "a.wma", ["-c:a", "wmav2"]],
      ["MPEG-TS", "a.ts", ["-c:a", "mp2"]],
      ["AVI", "a.avi", ["-c:a", "pcm_s16le"]],
      ["MP2", "a.mp2", ["-c:a", "mp2"]],
      ["RF64 WAV", "rf64.wav", ["-c:a", "pcm_s16le", "-rf64", "always"]],
      ["MPEG-PS (MPG)", "a.mpg", ["-c:a", "mp2", "-f", "mpeg"]],
      ["MPEG-PS (VOB)", "a.vob", ["-c:a", "ac3", "-f", "vob"]],
      ["FLV", "a.flv", ["-c:a", "aac", "-f", "flv"]],
      ["raw DTS", "a.dts", ["-strict", "-2", "-c:a", "dca", "-f", "dts"]],
      ["WavPack", "a.wv", ["-c:a", "wavpack", "-f", "wv"]],
      ["TTA", "a.tta", ["-c:a", "tta", "-f", "tta"]],
      ["LOAS/LATM AAC", "a.latm", ["-c:a", "aac", "-f", "latm"]],
    ]
    if (encoders?.includes("libopus")) {
      honest.push(["Ogg/Opus", "opus.ogg", ["-c:a", "libopus"]], ["WebM/Opus", "a.webm", ["-c:a", "libopus"]])
    }
    if (encoders?.includes("libopencore_amrnb")) {
      honest.push(["AMR", "a.amr", ["-ar", "8000", "-ac", "1", "-c:a", "libopencore_amrnb"]])
    }
    it.each(honest)("an honest %s still measures", async (_label, name, codec) => {
      const f = join(dir, `honest-${name}`)
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=48000", "-t", "6.5", "-ac", "2", ...codec, f)
      const length = await measureDecodedAudio(f, { capSec: 300 })
      expect(length && !length.overCap ? length.seconds : 0).toBeCloseTo(6.5, 1)
    }, REAL_MEDIA_TIMEOUT_MS)
  })
})
