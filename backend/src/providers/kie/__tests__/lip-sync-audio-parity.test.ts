// @test-watches backend/src/providers/kie/__tests__/fixtures/lip-sync-audio/*.mp3
/**
 * OmniHuman 2.0 on REAL files through the REAL ffmpeg (decided 2026-11-12):
 * the SAMPLES the price check counts (`checkLipSyncInputs`, the route's and the
 * workflow run's rule) are exactly the samples the worker decodes and sends as
 * MP3 (`prepareRateLipSyncAudio`) — for honest files in every common shape,
 * for files that change sample rate or channel layout mid-stream, and for
 * files built to understate their length. A file the decoder cannot read to
 * its end (a chained Ogg whose next link changes its rate or channels) is
 * refused by both instead.
 *
 * Why mid-stream changes: at each one ffmpeg rebuilds its filter graph and
 * what a resampler held is dropped, so a measure at one rate and an encode at
 * another kept different numbers of samples (~2 ms a change) and an honest
 * file measured just under a whole second was refused by the worker. Both now
 * read one decode into one PCM shape, so the counts are equal, not close —
 * and each such file is held to the length its pieces play, so a decode that
 * stopped part-way cannot pass as equal.
 *
 * The two crafted fixtures came from a review of this lane: a few 320 kb/s MP3
 * frames up front and a long low-bitrate tail, with no Xing header, so the
 * length the container declares (size ÷ the first frame's bitrate) is a
 * fraction of what the file plays. Priced on the declaration, the 21.6 s file
 * held 4 s and the 290 s file 31 s. Both are copied here as they were made.
 *
 * Stood in: the download (a copy of the local file), the image probe and the
 * upload. Real: the decode, the MP3 encode and its measure. Runs where ffmpeg
 * with libmp3lame is on PATH (Backend Tests install the production-pinned
 * build).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest"
import { execFileSync } from "node:child_process"
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const world = vi.hoisted(() => ({
  /** What each URL serves: a local file. */
  files: new Map<string, string>(),
  uploads: 0,
}))

vi.mock("../../../lib/image-source-probe.js", () => ({
  probeImageSource: async () => ({ size: { width: 1024, height: 1536 }, sizeBytes: 2_000_000 }),
}))
vi.mock("../../video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../video/ffmpeg-utils.js")>()),
  downloadFile: async (url: string, dest: string) => {
    const source = world.files.get(url)
    if (!source) throw new Error(`Failed to download: ${url} (404)`)
    await copyFile(source, dest)
  },
}))
vi.mock("../../../lib/job-scratch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/job-scratch.js")>()),
  uploadJobScratchFile: async (_path: string, name: string, ext: string) => {
    world.uploads++
    return `https://cdn.test/scratch/${name}.${ext}`
  },
}))

import { LIP_SYNC_AUDIO_RATES } from "@nodaro/shared/credits"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { LIP_SYNC_INPUT_RULES, audioReadStoppedMessage, checkLipSyncInputs } from "../../../lib/lip-sync-inputs.js"
import { DECODED_AUDIO_RATE_HZ } from "../../video/decoded-audio-length.js"
import { damageCluster, restateFlac } from "../../video/__tests__/fixtures/media-edits.js"
import { probeMediaFormatAndDuration } from "../../video/ffmpeg-utils.js"
import { LIP_SYNC_PAD_MARGIN_SEC, prepareRateLipSyncAudio, type PreparedLipSyncAudio } from "../lip-sync-audio.js"

const rate = LIP_SYNC_AUDIO_RATES["omnihuman-2-0"]!
const rule = LIP_SYNC_INPUT_RULES["omnihuman-2-0"]!
const IMAGE = "https://cdn.test/face.png"
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/lip-sync-audio/${name}`, import.meta.url))

const encoders = (() => {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"] }).toString()
  } catch {
    return ""
  }
})()
const hasFfmpeg = encoders.includes("libmp3lame")
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args], { stdio: "ignore" })

/** Real decodes and encodes: a slow CI host takes a few times longer than a laptop (the 290 s file: ~5 s here). */
const REAL_MEDIA_TIMEOUT_MS = 60_000

/** Serve `path` at a URL of its own. */
function serve(path: string): string {
  const url = `https://caller.test/${world.files.size}/${path.split("/").pop()}`
  world.files.set(url, path)
  return url
}

/** What the price check holds for the file at `url`. */
async function hold(url: string) {
  return checkLipSyncInputs({ provider: "omnihuman-2-0", audioUrl: url, imageUrl: IMAGE })
}

/** The sample frames the price check counted (its seconds are those samples ÷ the decoded rate). */
const heldSamples = (audioSec: number) => Math.round(audioSec * DECODED_AUDIO_RATE_HZ)

/** The padded minimum, in sample frames: what a clip under 4 s is sent as. */
const PADDED_SAMPLES = Math.round((rate.minSeconds + LIP_SYNC_PAD_MARGIN_SEC) * DECODED_AUDIO_RATE_HZ)

/**
 * Price the file at `url`, run the worker on the same bytes, and hold the two
 * to each other EXACTLY: the worker decodes the samples the price counted,
 * bills the seconds the price held, and sends an MP3 of exactly those samples
 * (or of the padded minimum, for a clip under it).
 */
async function priceThenRun(url: string): Promise<{ billedSeconds: number; prepared: PreparedLipSyncAudio }> {
  const held = await hold(url)
  expect(held).toMatchObject({ ok: true })
  if (!held?.ok) throw new Error("not held")
  const prepared = await prepareRateLipSyncAudio(url, rate, rule, "OmniHuman 2.0", held.billedSeconds)
  expect(prepared.measuredSamples).toBe(heldSamples(held.audioSec))
  expect(prepared.measuredSec).toBe(held.audioSec)
  expect(prepared.billedSeconds).toBe(held.billedSeconds)
  expect(prepared.sentSamples).toBe(prepared.padded ? PADDED_SAMPLES : prepared.measuredSamples)
  expect(world.uploads).toBe(1)
  return { billedSeconds: held.billedSeconds, prepared }
}

/** Join files byte for byte (header-less MP3 frames, ADTS frames, Ogg links). */
async function joinBytes(out: string, parts: string[]): Promise<string> {
  await writeFile(out, Buffer.concat(await Promise.all(parts.map((p) => readFile(p)))))
  return out
}

describe.skipIf(!hasFfmpeg)("the hold equals what the encode bills — real files, real ffmpeg", () => {
  let dir = ""
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lip-sync-parity-"))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  beforeEach(() => {
    world.uploads = 0
  })

  const honest: Array<[string, () => string, number]> = [
    ["a CBR MP3 (10.04 s)", () => {
      const f = join(dir, "cbr.mp3")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "10.04", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", f)
      return f
    }, 11],
    ["a VBR MP3 with no Xing header (its declared length is a guess)", () => {
      const f = join(dir, "vbr-no-header.mp3")
      ffmpeg("-f", "lavfi", "-i", "anoisesrc=r=44100:a=0.3:d=9.6", "-f", "lavfi", "-i", "sine=f=220:r=44100:d=9.6", "-filter_complex", "amix=inputs=2:duration=shortest", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "4", "-write_xing", "0", f)
      return f
    }, 10],
    ["an M4A with its index at the end", () => {
      const f = join(dir, "moov-end.m4a")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "17.3", "-ac", "2", "-c:a", "aac", f)
      return f
    }, 18],
    ["a WAV", () => {
      const f = join(dir, "tone.wav")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=48000", "-t", "22", "-ac", "2", f)
      return f
    }, 22],
    ["a 96 kHz WAV (resampled for MP3)", () => {
      const f = join(dir, "hi-rate.wav")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=96000", "-t", "12.3456", "-ac", "2", f)
      return f
    }, 13],
    ["a FLAC", () => {
      const f = join(dir, "tone.flac")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "5.5", "-ac", "1", "-c:a", "flac", f)
      return f
    }, 6],
  ]
  if (encoders.includes("libopus")) {
    honest.push(["an Ogg/Opus", () => {
      const f = join(dir, "voice.ogg")
      ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=48000", "-t", "13.37", "-ac", "2", "-c:a", "libopus", f)
      return f
    }, 14])
  }

  it.each(honest)("%s: the samples the route's hold counted are exactly the samples sent", async (_label, make, expected) => {
    const { billedSeconds, prepared } = await priceThenRun(serve(make()))
    expect(billedSeconds).toBe(expected)
    expect(prepared.padded).toBe(false)
  }, REAL_MEDIA_TIMEOUT_MS)

  it("3.2 s of WAV is held as 4 s and sent padded to exactly 4 s", async () => {
    const f = join(dir, "short.wav")
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:r=44100", "-t", "3.2", "-ac", "1", f)
    const url = serve(f)
    expect(await hold(url)).toEqual({ ok: true, audioSec: 3.2, billedSeconds: 4 })
    const { prepared } = await priceThenRun(url)
    expect(prepared).toMatchObject({ padded: true, billedSeconds: 4, sentSamples: PADDED_SAMPLES })
  }, REAL_MEDIA_TIMEOUT_MS)

  describe("files that change sample rate or channel layout mid-stream", () => {
    /** One header-less MP3 piece (no Xing, no ID3): joined, its frames simply follow each other. */
    const mp3Piece = (name: string, sampleRate: number, channels: number, seconds: number, bitrate: string) => {
      const f = join(dir, name)
      ffmpeg("-f", "lavfi", "-i", `sine=f=300:r=${sampleRate}`, "-t", String(seconds), "-ac", String(channels),
        "-c:a", "libmp3lame", "-b:a", bitrate, "-write_xing", "0", "-id3v2_version", "0", f)
      return f
    }
    const adtsPiece = (name: string, sampleRate: number, seconds: number) => {
      const f = join(dir, name)
      ffmpeg("-f", "lavfi", "-i", `sine=f=300:r=${sampleRate}`, "-t", String(seconds), "-ac", "1", "-c:a", "aac", "-b:a", "64k", "-f", "adts", f)
      return f
    }

    /** An Ogg/Opus piece of its own (one link, when joined). */
    const opusPiece = (name: string, channels: number, seconds: number) => {
      const f = join(dir, name)
      ffmpeg("-f", "lavfi", "-i", "sine=f=300:r=48000", "-t", String(seconds), "-ac", String(channels), "-c:a", "libopus", f)
      return f
    }

    /**
     * Each file and the length it must decode to: at least the pieces' own
     * seconds (anything less is a decode cut short), at most those plus each
     * piece's encoder delay and frame padding (an MP3 or AAC piece without a
     * header that says how much to trim keeps them: up to ~0.1 s at 22 kHz and
     * up, ~0.25 s at 11 kHz).
     */
    const changing: Array<[string, () => Promise<string>, [min: number, max: number]]> = [
      ["MP3, 44.1 kHz then 22.05 kHz", () =>
        joinBytes(join(dir, "c-44-22.mp3"), [mp3Piece("p44.mp3", 44100, 1, 5, "128k"), mp3Piece("p22.mp3", 22050, 1, 4.9993, "64k")]), [9.995, 10.2]],
      ["MP3, 48 kHz then 32 kHz", () =>
        joinBytes(join(dir, "c-48-32.mp3"), [mp3Piece("p48.mp3", 48000, 1, 5, "128k"), mp3Piece("p32.mp3", 32000, 1, 4.9993, "64k")]), [9.995, 10.2]],
      ["MP3, mono then stereo at the same rate", () =>
        joinBytes(join(dir, "c-mono-stereo.mp3"), [mp3Piece("pm.mp3", 44100, 1, 5, "128k"), mp3Piece("ps.mp3", 44100, 2, 4.9993, "128k")]), [9.995, 10.2]],
      // Here the old encode (resampled to 11.025 kHz) kept a few ms MORE than the decoder produced.
      ["MP3, 11.025 kHz mono then 48 kHz stereo", () =>
        joinBytes(join(dir, "c-11-48.mp3"), [mp3Piece("p11.mp3", 11025, 1, 5, "32k"), mp3Piece("p48s.mp3", 48000, 2, 4.9993, "128k")]), [9.995, 10.4]],
      ["ADTS AAC, 48 kHz then 24 kHz", () =>
        joinBytes(join(dir, "c-adts.aac"), [adtsPiece("a48.aac", 48000, 5), adtsPiece("a24.aac", 24000, 4.9993)]), [9.995, 10.2]],
      ["20 changes: 1 s clips alternating 44.1 kHz and 22.05 kHz", async () => {
        const hi = mp3Piece("h1.mp3", 44100, 1, 1, "128k")
        const lo = mp3Piece("l1.mp3", 22050, 1, 1, "64k")
        return joinBytes(join(dir, "c-20.mp3"), Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? hi : lo)))
      }, [20.995, 23.1]],
    ]
    if (encoders.includes("libopus")) {
      // A chained Ogg whose links match (stereo, then stereo): ffmpeg reads through the join.
      changing.push(["chained Ogg/Opus, stereo then stereo", async () =>
        joinBytes(join(dir, "c-chain.ogg"), [opusPiece("o1.ogg", 2, 5), opusPiece("o2.ogg", 2, 4.9993)]), [9.994, 10.05]])
    }

    it.each(changing)("%s: decoded to its end, and the samples the hold counted are exactly the samples sent", async (_label, make, [min, max]) => {
      const { prepared } = await priceThenRun(serve(await make()))
      expect(prepared.padded).toBe(false)
      expect(prepared.measuredSec).toBeGreaterThanOrEqual(min)
      expect(prepared.measuredSec).toBeLessThanOrEqual(max)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a clip under 4 s that changes rate (1.5 s at 44.1 kHz, then 1.2 s at 22.05 kHz) is held as 4 s and sent padded to exactly 4 s — padded once", async () => {
      const f = await joinBytes(join(dir, "c-short.mp3"), [mp3Piece("s44.mp3", 44100, 1, 1.5, "128k"), mp3Piece("s22.mp3", 22050, 1, 1.2, "64k")])
      const { billedSeconds, prepared } = await priceThenRun(serve(f))
      expect(billedSeconds).toBe(4)
      expect(prepared).toMatchObject({ padded: true, sentSamples: PADDED_SAMPLES })
      expect(prepared.measuredSec).toBeGreaterThanOrEqual(2.695)
      expect(prepared.measuredSec).toBeLessThanOrEqual(2.9)
    }, REAL_MEDIA_TIMEOUT_MS)

    /**
     * A chained Ogg whose next link changes its sample rate or channels: ffmpeg's
     * Ogg demuxer stops at the join ("… change is not supported") and still exits
     * 0, so the decode held only the first link. Refused (decided 2026-11-12):
     * by the price check before anything is held, and by the worker —
     * deterministic (refunded, not retried), nothing sent.
     */
    const cutShort: Array<[string, () => Promise<string>]> = [
      ["Ogg/Vorbis, 44.1 kHz then 22.05 kHz", async () => {
        const vorbis = (name: string, sampleRate: number) => {
          const f = join(dir, name)
          ffmpeg("-f", "lavfi", "-i", `sine=f=300:r=${sampleRate}`, "-t", "5", "-ac", "2", "-strict", "experimental", "-c:a", "vorbis", f)
          return f
        }
        return joinBytes(join(dir, "x-rate.ogg"), [vorbis("v44.ogg", 44100), vorbis("v22.ogg", 22050)])
      }],
    ]
    if (encoders.includes("libopus")) {
      cutShort.push(["Ogg/Opus, mono then stereo (a channel change)", () =>
        joinBytes(join(dir, "x-channels.ogg"), [opusPiece("om.ogg", 1, 5), opusPiece("os.ogg", 2, 5)])])
    }

    it.each(cutShort)("a chained %s is refused — never priced or sent as its first link alone", async (_label, make) => {
      const url = serve(await make())
      expect(await hold(url)).toEqual({ ok: false, code: "audio_unreadable", message: audioReadStoppedMessage("OmniHuman 2.0") })
      // A run held anyway (say, on the first link's 5 s) is refused by the worker.
      const err = await prepareRateLipSyncAudio(url, rate, rule, "OmniHuman 2.0", 10).catch((e: unknown) => e)
      expect(isDeterministicJobError(err)).toBe(true)
      expect(String(err)).toMatch(/Re-export the audio as one complete, continuous file/)
      expect(world.uploads).toBe(0)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("an MKA with a damaged cluster, which decodes 8 of the 10 s it states with no error logged, is refused by the price check and by the worker", async () => {
      const whole = join(dir, "whole.mka")
      ffmpeg("-f", "lavfi", "-i", "sine=f=300:r=44100:d=10", "-ac", "2", "-c:a", "flac", "-cluster_time_limit", "2000", whole)
      const f = join(dir, "damaged.mka")
      await writeFile(f, damageCluster(await readFile(whole), 1))
      const url = serve(f)
      expect(await hold(url)).toEqual({ ok: false, code: "audio_unreadable", message: audioReadStoppedMessage("OmniHuman 2.0") })
      expect(isDeterministicJobError(await prepareRateLipSyncAudio(url, rate, rule, "OmniHuman 2.0", 10).catch((e: unknown) => e))).toBe(true)
      expect(world.uploads).toBe(0)
    }, REAL_MEDIA_TIMEOUT_MS)

    /**
     * Not caught (decided 2026-11-12, a known residual): an MP3 followed by ADTS
     * AAC. The decoder, not the demuxer, stops at the join, and neither format
     * states an exact length — so the run is priced on the MP3 half that decodes,
     * and exactly that half is sent.
     */
    it("an MP3 followed by ADTS AAC (a residual the checks do not catch): priced on the half that decodes, and exactly that half is sent", async () => {
      const mp3 = mp3Piece("r-mp3.mp3", 44100, 2, 10, "128k")
      const aac = adtsPiece("r-aac.aac", 44100, 10)
      const { billedSeconds, prepared } = await priceThenRun(serve(await joinBytes(join(dir, "mp3-then-adts.mp3"), [mp3, aac])))
      expect(prepared.measuredSec).toBeLessThan(11)
      expect(billedSeconds).toBe(Math.ceil(prepared.measuredSec))
    }, REAL_MEDIA_TIMEOUT_MS)
  })

  describe("gaps in the timeline play as silence (decided 2026-11-12)", () => {
    /** A 20 s FLAC-in-Matroska, stream-copied with its timestamps rewritten (`setts`). */
    const retimed = (name: string, ts: string) => {
      const src = join(dir, `${name}.src.mka`)
      ffmpeg("-f", "lavfi", "-i", "sine=f=220:r=48000:d=20", "-c:a", "flac", src)
      const f = join(dir, name)
      ffmpeg("-i", src, "-c:a", "copy", "-bsf:a", `setts=ts=${ts}`, f)
      return f
    }

    it("a 2 s jump at 5 s is held as 22 s, silence included, and exactly those samples are sent", async () => {
      const { billedSeconds, prepared } = await priceThenRun(serve(retimed("gap2.mka", "if(gt(PTS*TB\\,5)\\,PTS+2/TB\\,PTS)")))
      expect(billedSeconds).toBe(22)
      expect(prepared.measuredSec).toBeCloseTo(22, 1)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a 3-hour jump in a Matroska file fills to past the cap: refused as too long by the price check", async () => {
      expect(await hold(serve(retimed("huge.mka", "if(gt(PTS*TB\\,5)\\,PTS+3*3600/TB\\,PTS)")))).toMatchObject({ ok: false, code: "audio_too_long" })
    }, REAL_MEDIA_TIMEOUT_MS)
  })

  describe("a stated length can only refuse its own file, never cheapen it", () => {
    /** A 10 s FLAC whose STREAMINFO states `factor` × its samples. */
    const restatedFlac = async (name: string, factor: number) => {
      const f = join(dir, name)
      ffmpeg("-f", "lavfi", "-i", "sine=f=300:r=44100:d=10", "-c:a", "flac", f)
      await writeFile(f, restateFlac(await readFile(f), factor))
      return f
    }

    it("a FLAC stating 5 s that plays 10 s is held 10 s, and the 10 s are sent", async () => {
      const { billedSeconds, prepared } = await priceThenRun(serve(await restatedFlac("states-5.flac", 0.5)))
      expect(billedSeconds).toBe(10)
      expect(prepared.measuredSamples).toBe(441_000)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("a FLAC stating 20 s that plays 10 s is refused — nothing held, nothing sent", async () => {
      const url = serve(await restatedFlac("states-20.flac", 2))
      expect(await hold(url)).toEqual({ ok: false, code: "audio_unreadable", message: audioReadStoppedMessage("OmniHuman 2.0") })
      expect(isDeterministicJobError(await prepareRateLipSyncAudio(url, rate, rule, "OmniHuman 2.0", 10).catch((e: unknown) => e))).toBe(true)
      expect(world.uploads).toBe(0)
    }, REAL_MEDIA_TIMEOUT_MS)
  })

  describe("files built to understate their length", () => {
    it("declares 3.5 s, plays 21.6 s: held 22 s (its declaration would have held 4), and exactly what was counted is sent", async () => {
      const path = fixture("declares-3.5s-plays-21.6s.mp3")
      expect((await probeMediaFormatAndDuration(path)).durationSec).toBeLessThan(4)
      const url = serve(path)
      const held = await hold(url)
      expect(held).toMatchObject({ ok: true, billedSeconds: 22 })
      // Within an MP3 frame of the count on the build this was written on (21.551 s).
      expect(held?.ok ? held.audioSec : 0).toBeCloseTo(21.55, 1)
      expect((await priceThenRun(url)).billedSeconds).toBe(22)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("…and a run held on its declaration (4 s) is refused by the worker — deterministic, nothing sent", async () => {
      const url = serve(fixture("declares-3.5s-plays-21.6s.mp3"))
      const err = await prepareRateLipSyncAudio(url, rate, rule, "OmniHuman 2.0", 4).catch((e: unknown) => e)
      expect(isDeterministicJobError(err)).toBe(true)
      expect(world.uploads).toBe(0)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("declares 31 s, plays 290 s: held 291 s (rounded up), and exactly what was counted is sent", async () => {
      const path = fixture("declares-31s-plays-290s.mp3")
      expect((await probeMediaFormatAndDuration(path)).durationSec).toBeLessThan(32)
      const url = serve(path)
      const held = await hold(url)
      expect(held).toMatchObject({ ok: true, billedSeconds: 291 })
      expect(held?.ok ? held.audioSec : 0).toBeCloseTo(290.04, 1)
      expect((await priceThenRun(url)).billedSeconds).toBe(291)
      // A run held on its declaration (32 s) never reaches the model.
      expect(isDeterministicJobError(await prepareRateLipSyncAudio(url, rate, rule, "OmniHuman 2.0", 32).catch((e: unknown) => e))).toBe(true)
    }, REAL_MEDIA_TIMEOUT_MS)

    it("the two joined declare 34 s and play 311 s: refused as past 300 s by the price check and by the worker", async () => {
      const joined = join(dir, "joined.mp3")
      await writeFile(joined, Buffer.concat([await readFile(fixture("declares-31s-plays-290s.mp3")), await readFile(fixture("declares-3.5s-plays-21.6s.mp3"))]))
      expect((await probeMediaFormatAndDuration(joined)).durationSec).toBeLessThan(40)
      const url = serve(joined)
      expect(await hold(url)).toMatchObject({ ok: false, code: "audio_too_long" })
      const err = await prepareRateLipSyncAudio(url, rate, rule, "OmniHuman 2.0", 300).catch((e: unknown) => e)
      expect(isDeterministicJobError(err)).toBe(true)
      expect(world.uploads).toBe(0)
    }, REAL_MEDIA_TIMEOUT_MS)
  })
})
