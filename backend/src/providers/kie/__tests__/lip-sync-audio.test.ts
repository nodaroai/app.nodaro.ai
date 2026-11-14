/**
 * OmniHuman 2.0's audio: PRICE AND SEND THE SAME BYTES (decided 2026-11-11).
 *
 * The run was held on a measurement of the caller's URL, and a URL can answer
 * a second fetch with a different file. So the provider downloads the audio
 * once under a hard cap on the bytes it actually reads, measures THOSE bytes
 * by decoding them (the measure the hold used), refuses a file that bills more
 * than the hold (deterministic: failed and refunded now, nothing sent
 * upstream), ALWAYS encodes it to MP3 (padding to 4 s), measures the encode
 * and refuses one that plays longer than the hold, and sends only OUR stored
 * encode. An honest file runs, billed as reserved.
 *
 * The download is the real `downloadFile` over a stood-in `safeFetch` (so the
 * byte cap is the real one); the decoded-length measure, ffmpeg, the upload
 * and KIE are stood in (decoded-audio-length.test.ts runs the real measure, and
 * lip-sync-audio-parity.test.ts the real chain on real files).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { writeFile } from "node:fs/promises"

const state = vi.hoisted(() => ({
  /** What the caller's server answers, fetch after fetch, by URL. */
  served: new Map<string, Array<{ bytes: number; declared?: number }>>(),
  /** What the decoded-length measure reads of each local file, in order: seconds, "over" (past the cap), undefined (decoded nothing) or an error. */
  measures: [] as Array<number | "over" | undefined | Error>,
  measureCaps: [] as number[],
  measureFormats: [] as Array<readonly string[] | undefined>,
  ffmpegArgs: [] as string[][],
  uploaded: [] as Array<{ name: string; ext: string; type: string }>,
  kieInputs: [] as Array<Record<string, unknown>>,
  /** The size of the file ffmpeg writes (a conversion or a padding). */
  convertedBytes: 50_000,
}))

vi.mock("../../../lib/safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/safe-fetch.js")>()),
  safeFetch: async (url: string) => {
    const next = state.served.get(url)?.shift()
    if (!next) return new Response(null, { status: 404 })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let left = next.bytes
        while (left > 0) {
          const n = Math.min(left, 1 << 20)
          controller.enqueue(new Uint8Array(n))
          left -= n
        }
        controller.close()
      },
    })
    return new Response(body, { status: 200, headers: { "content-length": String(next.declared ?? next.bytes) } })
  },
}))
vi.mock("../../video/decoded-audio-length.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../video/decoded-audio-length.js")>()
  /** The source's decode and the encode's measure read the same queue, in that order. */
  const next = (opts: { capSec: number; formats?: readonly string[] }) => {
    state.measureCaps.push(opts.capSec)
    state.measureFormats.push(opts.formats)
    const value = state.measures.shift()
    if (value instanceof Error) throw value
    if (value === "over") return { overCap: true as const }
    if (value === undefined) return undefined
    return { overCap: false as const, samples: Math.round(value * real.DECODED_AUDIO_RATE_HZ), seconds: value }
  }
  return {
    ...real,
    decodeAudioToPcm: async (_path: string, _pcm: string, opts: { capSec: number; formats?: readonly string[] }) => next(opts),
    measureDecodedAudio: async (_path: string, opts: { capSec: number; formats?: readonly string[] }) => next(opts),
  }
})
vi.mock("../../video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../video/ffmpeg-utils.js")>()),
  runFfmpeg: async (args: string[]) => {
    state.ffmpegArgs.push(args)
    await writeFile(args[args.length - 1]!, Buffer.alloc(state.convertedBytes))
  },
}))
vi.mock("../../../lib/job-scratch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/job-scratch.js")>()),
  uploadJobScratchFile: async (_path: string, name: string, ext: string, type: string) => {
    state.uploaded.push({ name, ext, type })
    return `https://cdn.test/scratch/${name}.${ext}`
  },
}))
vi.mock("../client.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runKieTask: async (_model: string, input: Record<string, unknown>) => {
    state.kieInputs.push(input)
    return { resultJson: { resultUrls: ["https://kie.test/out.mp4"] }, taskId: "t1", providerMs: 1 }
  },
}))

import { LIP_SYNC_AUDIO_RATES } from "@nodaro/shared/credits"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { LIP_SYNC_INPUT_RULES, audioReadStoppedMessage, lipSyncAudioPricingOf } from "../../../lib/lip-sync-inputs.js"
import { AudioReadStoppedError } from "../../video/decoded-audio-length.js"
import {
  LIP_SYNC_ENCODE_TOLERANCE_SEC,
  LIP_SYNC_PAD_MARGIN_SEC,
  LIP_SYNC_TRIM_MARGIN_SEC,
  lipSyncAudioEncodeArgs,
  prepareLipSyncAudio,
  prepareRateLipSyncAudio,
} from "../lip-sync-audio.js"
import { KieVideoProvider, lipSyncKieCostUsd } from "../video.js"
import { KIE_LIP_SYNC_MODELS } from "../models.js"

const rate = LIP_SYNC_AUDIO_RATES["omnihuman-2-0"]!
const rule = LIP_SYNC_INPUT_RULES["omnihuman-2-0"]!
const URL_ = "https://caller.example/voice"
const serve = (...files: Array<{ bytes: number; declared?: number }>) => state.served.set(URL_, files)
const prepare = (held: number | undefined) => prepareRateLipSyncAudio(URL_, rate, rule, "OmniHuman 2.0", held)

beforeEach(() => {
  state.served.clear()
  state.measures = []
  state.measureCaps = []
  state.measureFormats = []
  state.ffmpegArgs = []
  state.uploaded = []
  state.kieInputs = []
  state.convertedBytes = 50_000
})

describe("an honest file runs, billed as reserved, and the model gets OUR encode", () => {
  it("an MP3 of 10.04 s (held 11): encoded to OUR MP3 from the PCM its decode counted, never the caller's URL", async () => {
    serve({ bytes: 400_000 })
    state.measures = [10.04, 10.04]
    expect(await prepare(11)).toEqual({
      url: "https://cdn.test/scratch/lip-sync-prepared.mp3",
      measuredSec: 10.04,
      measuredSamples: 442_764,
      billedSeconds: 11,
      sentSec: 10.04,
      sentSamples: 442_764,
      padded: false,
      trimmed: false,
    })
    expect(state.ffmpegArgs).toHaveLength(1)
    // The encode reads the decoded PCM — never the caller's file again.
    const encode = state.ffmpegArgs[0]!
    expect(encode[encode.indexOf("-i") + 1]).toMatch(/decoded\.pcm$/)
    expect(encode).toEqual(expect.arrayContaining(["-f", "s16le", "-c:a", "libmp3lame"]))
    expect(encode).not.toContain("-af")
    expect(state.uploaded).toEqual([{ name: "lip-sync-prepared", ext: "mp3", type: "audio/mpeg" }])
    // The source is decoded up to the rate's maximum, as any container the lane takes; the encode
    // is measured just past it, as the MP3 it is.
    expect(state.measureCaps).toEqual([300, 301])
    expect(state.measureFormats).toEqual([undefined, ["mp3"]])
  })

  it("a WAV is sent as OUR MP3 too — every file is encoded", async () => {
    serve({ bytes: 3_000_000 })
    state.measures = [17, 17]
    expect((await prepare(17)).url).toBe("https://cdn.test/scratch/lip-sync-prepared.mp3")
    expect(state.uploaded).toEqual([{ name: "lip-sync-prepared", ext: "mp3", type: "audio/mpeg" }])
  })

  it("3.2 s is padded past 4 s and billed 4 s — the padded encode's length never bills", async () => {
    serve({ bytes: 100_000 })
    state.measures = [3.2, 4 + LIP_SYNC_PAD_MARGIN_SEC]
    expect(await prepare(4)).toMatchObject({ padded: true, measuredSec: 3.2, billedSeconds: 4, sentSec: 4 })
    expect(state.ffmpegArgs[0]).toEqual(expect.arrayContaining(["-af", `apad=whole_dur=${4 + LIP_SYNC_PAD_MARGIN_SEC}`]))
  })

  it("a 40 MB WAV (over the model's 15 MB as given) is encoded to an MP3 under 15 MB, runs, and is billed as held", async () => {
    serve({ bytes: 40_000_000 })
    state.measures = [226.7, 226.7]
    state.convertedBytes = 5_440_000
    expect(await prepare(227)).toMatchObject({ padded: false, billedSeconds: 227, url: "https://cdn.test/scratch/lip-sync-prepared.mp3" })
  })

  it("a file that bills fewer seconds than held runs (the hold stays the charge)", async () => {
    serve({ bytes: 400_000 })
    state.measures = [9.5, 9.5]
    expect(await prepare(11)).toMatchObject({ billedSeconds: 10 })
  })

  it("an encode a hair past its source — the measure's own rounding, within the tolerance — runs", async () => {
    serve({ bytes: 400_000 })
    state.measures = [10.9995, 11 + LIP_SYNC_ENCODE_TOLERANCE_SEC]
    expect(await prepare(11)).toMatchObject({ billedSeconds: 11, sentSec: 11 + LIP_SYNC_ENCODE_TOLERANCE_SEC })
  })

  it("through the provider: KIE is sent our stored encode, and the cost is 14 KIE credits × the seconds", async () => {
    serve({ bytes: 400_000 })
    state.measures = [10.04, 10.04]
    const out = await new KieVideoProvider().lipSync("https://cdn.test/face.png", URL_, "hi", "omnihuman-2-0", undefined, 10.04, undefined, { billedSeconds: 11 })
    expect(state.kieInputs).toEqual([{ image_urls: ["https://cdn.test/face.png"], audio_url: "https://cdn.test/scratch/lip-sync-prepared.mp3", prompt: "hi", enable_watermark: false }])
    expect(out.cost).toBe(lipSyncKieCostUsd(14, 11))
  })
})

describe("a file that is not the one priced is refused — deterministic, nothing sent upstream", () => {
  it("a server that answers the run's fetch with a longer file (priced at 4 s, now 300 s): refused before any encode", async () => {
    serve({ bytes: 5_000_000 })
    state.measures = [300]
    const err = await prepare(4).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toMatch(/the audio changed between the price check and the run/)
    expect(state.uploaded).toEqual([])
    expect(state.ffmpegArgs).toEqual([])
  })

  it("…and through the provider, KIE is never called", async () => {
    serve({ bytes: 5_000_000 })
    state.measures = [120]
    const err = await new KieVideoProvider().lipSync("https://cdn.test/face.png", URL_, "hi", "omnihuman-2-0", undefined, 3.2, undefined, { billedSeconds: 4 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(state.kieInputs).toEqual([])
  })

  it("past 300 s, whatever was held — measured, or stopped at the cap", async () => {
    serve({ bytes: 5_000_000 }, { bytes: 5_000_000 })
    state.measures = [300.5, "over"]
    expect(isDeterministicJobError(await prepare(300).catch((e: unknown) => e))).toBe(true)
    const err = await prepare(300).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toMatch(/over 300 seconds/)
    expect(state.ffmpegArgs).toEqual([])
  })

  it("an encode that plays longer than the hold (past the tolerance) is never sent", async () => {
    serve({ bytes: 400_000 })
    state.measures = [10.9, 11.2]
    const err = await prepare(11).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toMatch(/longer than the 11 seconds this run was priced for/)
    expect(state.uploaded).toEqual([])
  })

  it("a padded encode past 4 s (and the tolerance) is never sent", async () => {
    serve({ bytes: 100_000 })
    state.measures = [3.2, 4.2]
    expect(isDeterministicJobError(await prepare(4).catch((e: unknown) => e))).toBe(true)
    expect(state.uploaded).toEqual([])
  })

  it("a source over 100 MB that declares a small size: refused on the bytes read", async () => {
    serve({ bytes: 101_000_000, declared: 1_000 })
    const err = await prepare(10).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toMatch(/under 100 MB/)
    expect(state.uploaded).toEqual([])
  })

  it("a source that encodes to 15 MB or more is refused before the upstream call (deterministic: refunded)", async () => {
    serve({ bytes: 60_000_000 })
    state.measures = [290, 290]
    state.convertedBytes = 15_000_000
    const err = await new KieVideoProvider().lipSync("https://cdn.test/face.png", URL_, "hi", "omnihuman-2-0", undefined, 290, undefined, { billedSeconds: 290 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toMatch(/too long or too large to send/)
    expect(state.uploaded).toEqual([])
    expect(state.kieInputs).toEqual([])
  })

  it("a run never priced from its audio (no held seconds) is refused before any download", async () => {
    serve({ bytes: 400_000 })
    expect(isDeterministicJobError(await prepare(undefined).catch((e: unknown) => e))).toBe(true)
    expect(state.served.get(URL_)).toHaveLength(1)
  })

  it("an audio that decodes to nothing, or that ffmpeg refuses, is refused (deterministic)", async () => {
    serve({ bytes: 400_000 }, { bytes: 400_000 })
    state.measures = [undefined, new Error("ffmpeg failed: Invalid data found when processing input")]
    expect(isDeterministicJobError(await prepare(10).catch((e: unknown) => e))).toBe(true)
    expect(isDeterministicJobError(await prepare(10).catch((e: unknown) => e))).toBe(true)
  })

  it("an audio the decoder stopped reading part-way is refused with the price check's sentence (deterministic: refunded, not retried), nothing encoded or sent", async () => {
    serve({ bytes: 400_000 })
    state.measures = [new AudioReadStoppedError("[in#0/ogg] Error during demuxing: Not yet implemented in FFmpeg, patches welcome")]
    const err = await new KieVideoProvider().lipSync("https://cdn.test/face.png", URL_, "hi", "omnihuman-2-0", undefined, 10, undefined, { billedSeconds: 10 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toContain(`${audioReadStoppedMessage("OmniHuman 2.0")} Nothing is charged.`)
    expect(String(err)).toMatch(/Re-export the audio as one complete, continuous file/)
    expect(state.ffmpegArgs).toEqual([])
    expect(state.uploaded).toEqual([])
    expect(state.kieInputs).toEqual([])
  })

  it("a measure that was STOPPED (its time limit) is not the file's fault: thrown as it is, not deterministic", async () => {
    serve({ bytes: 400_000 })
    const stopped = Object.assign(new Error("ffmpeg failed: killed"), { killed: true, timedOut: true })
    state.measures = [stopped]
    const err = await prepare(10).catch((e: unknown) => e)
    expect(err).toBe(stopped)
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("a padded encode that still measures under 4 s is never sent (a retryable failure, not deterministic)", async () => {
    serve({ bytes: 100_000 })
    state.measures = [2, 3.99]
    const err = await prepare(4).catch((e: unknown) => e)
    expect(String(err)).toMatch(/padding the audio to 4 seconds failed/)
    expect(isDeterministicJobError(err)).toBe(false)
    expect(state.uploaded).toEqual([])
  })
})

describe("the pieces", () => {
  it("the encode command: MP3 of the decoded PCM (read as that PCM, a local file only), the padding or the cut only when asked", () => {
    const pcmIn = ["-protocol_whitelist", "file", "-format_whitelist", "s16le", "-f", "s16le", "-ar", "44100", "-ac", "2", "-i", "in.pcm"]
    expect(lipSyncAudioEncodeArgs("in.pcm", "out.mp3", undefined)).toEqual([
      "-nostdin", "-v", "error", ...pcmIn, "-c:a", "libmp3lame", "-b:a", "192k", "-y", "out.mp3",
    ])
    expect(lipSyncAudioEncodeArgs("in.pcm", "out.mp3", 4.1)).toEqual([
      "-nostdin", "-v", "error", ...pcmIn, "-af", "apad=whole_dur=4.1", "-c:a", "libmp3lame", "-b:a", "192k", "-y", "out.mp3",
    ])
    expect(lipSyncAudioEncodeArgs("in.pcm", "out.mp3", undefined, 299.5)).toEqual([
      "-nostdin", "-v", "error", ...pcmIn, "-t", "299.5", "-c:a", "libmp3lame", "-b:a", "192k", "-y", "out.mp3",
    ])
  })

  it("provider cost is KIE's 14 per second × the billed seconds, not 1.5's rate or the flat anchor", () => {
    expect(KIE_LIP_SYNC_MODELS["omnihuman-2-0"]!.kieCreditsPerAudioSecond).toBe(14)
    expect(lipSyncKieCostUsd(14, 4)).toBe(0.28)
    expect(lipSyncKieCostUsd(14, 11)).toBe(0.77)
    expect(lipSyncKieCostUsd(14, 300)).toBe(21)
  })
})

/**
 * A model priced by a length BUCKET (decided 2026-11-13: Kling AI Avatar,
 * OmniHuman 1.5, the dubbing models) takes the same path: its held seconds are
 * its bucket, a file that now falls in a bigger bucket is refused, audio past
 * its maximum is cut under it (the trim the KIE lane always made) and priced at
 * it — never padded, never refused for its length — and every lane is sent OUR
 * MP3 of exactly the samples counted.
 */
describe("a bucketed model's audio — the same path", () => {
  const bucket = (provider: string, held: number | undefined) =>
    prepareLipSyncAudio(URL_, lipSyncAudioPricingOf(provider)!, provider, held)

  it.each([
    ["kling-avatar", 42, 60],
    ["omnihuman-1-5", 15, 15],
    ["heygen-lipsync-precision", 3.2, 15],
    ["sync-lipsync-v3", 119.9, 120],
    ["volcengine-lipsync", 200, 300],
  ] as const)("%s: %s s held at %s s is sent as OUR MP3 of exactly the samples counted — never padded, never cut", async (provider, sec, held) => {
    serve({ bytes: 400_000 })
    state.measures = [sec, sec]
    const prepared = await bucket(provider, held)
    expect(prepared).toMatchObject({ url: "https://cdn.test/scratch/lip-sync-prepared.mp3", measuredSec: sec, billedSeconds: held, sentSec: sec, padded: false, trimmed: false })
    const encode = state.ffmpegArgs[0]!
    expect(encode).not.toContain("-af")
    expect(encode).not.toContain("-t")
    expect(state.measureFormats).toEqual([undefined, ["mp3"]])
  })

  it.each([
    ["kling-avatar", 300],
    ["kling-avatar-pro", 300],
    ["omnihuman-1-5", 60],
    ["lipsync-2-pro", 300],
  ] as const)("%s: audio past its %s s maximum is cut under it and held at its top bucket — not refused", async (provider, max) => {
    serve({ bytes: 9_000_000 }, { bytes: 9_000_000 })
    // Stopped at the cap, and a length just past the trim (between it and the maximum).
    for (const source of ["over", max - 0.2] as const) {
      state.ffmpegArgs = []
      state.measures = [source, max - LIP_SYNC_TRIM_MARGIN_SEC]
      const prepared = await bucket(provider, max)
      expect(prepared).toMatchObject({ billedSeconds: max, trimmed: true, padded: false, sentSec: max - LIP_SYNC_TRIM_MARGIN_SEC })
      const encode = state.ffmpegArgs[0]!
      expect(encode[encode.indexOf("-t") + 1]).toBe(String(max - LIP_SYNC_TRIM_MARGIN_SEC))
    }
    expect(state.measureCaps).toEqual([max, max + 1, max, max + 1])
  })

  it("audio 18.7 ms past the 15 s bucket (an exact 15 s AAC file on the pinned ffmpeg) is held at 15 s and sent cut to exactly 15 s", async () => {
    serve({ bytes: 400_000 })
    state.measures = [15.0187, 15]
    expect(await bucket("kling-avatar", 15)).toMatchObject({ measuredSec: 15.0187, billedSeconds: 15, trimmed: true, sentSec: 15 })
    const encode = state.ffmpegArgs[0]!
    expect(encode[encode.indexOf("-t") + 1]).toBe("15")
    // Past the 50 ms edge it is the next bucket, sent whole.
    serve({ bytes: 400_000 })
    state.ffmpegArgs = []
    state.measures = [15.06, 15.06]
    expect(await bucket("kling-avatar", 30)).toMatchObject({ billedSeconds: 30, trimmed: false, sentSec: 15.06 })
    expect(state.ffmpegArgs[0]).not.toContain("-t")
  })

  it("a server that answers the run's fetch with a longer file (held at the 15 s bucket, now 42 s) is refused before any encode — nothing sent, refunded", async () => {
    serve({ bytes: 400_000 })
    state.measures = [42]
    const err = await bucket("kling-avatar", 15).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toMatch(/the audio changed between the price check and the run — it is now 42 seconds, and the run was priced for 15 seconds/)
    expect(state.ffmpegArgs).toEqual([])
    expect(state.uploaded).toEqual([])
  })

  it("…and past the maximum when the run was held for less: refused", async () => {
    serve({ bytes: 9_000_000 })
    state.measures = ["over"]
    const err = await bucket("kling-avatar", 60).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toMatch(/it is now over 300 seconds/)
  })

  it("a shorter file than was held runs, at no more than was held", async () => {
    serve({ bytes: 400_000 })
    state.measures = [9, 9]
    expect(await bucket("kling-avatar", 60)).toMatchObject({ billedSeconds: 15, sentSec: 9 })
  })

  it("damaged or cut-short audio is refused with the price check's sentence, deterministic, nothing sent", async () => {
    serve({ bytes: 400_000 })
    state.measures = [new AudioReadStoppedError("the file reports damage: [in#0/ogg @ 0x1] CRC mismatch!")]
    const err = await bucket("kling-avatar", 15).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toContain(`${audioReadStoppedMessage("kling-avatar")} Nothing is charged.`)
    expect(state.uploaded).toEqual([])
  })

  it("a source of 100 MB or more is refused on the bytes read", async () => {
    serve({ bytes: 101_000_000, declared: 1_000 })
    const err = await bucket("sync-lipsync-v3", 300).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toMatch(/under 100 MB/)
  })

  it("has no cap on the MP3's size beyond its length (a rate model's 15 MB is its own)", async () => {
    serve({ bytes: 60_000_000 })
    state.measures = [290, 290]
    state.convertedBytes = 15_000_000
    expect(await bucket("kling-avatar", 300)).toMatchObject({ billedSeconds: 300 })
  })

  it("the KIE lanes send a prepared copy as it is: no second download, no trim", async () => {
    await new KieVideoProvider().lipSync("https://cdn.test/face.png", "https://cdn.test/scratch/lip-sync-prepared.mp3", "hi", "kling-avatar", undefined, 42, undefined, { billedSeconds: 60, audioPrepared: true })
    expect(state.kieInputs).toHaveLength(1)
    expect(state.kieInputs[0]!.audio_url).toBe("https://cdn.test/scratch/lip-sync-prepared.mp3")
    await new KieVideoProvider().lipSyncVideo("https://cdn.test/face.mp4", "https://cdn.test/scratch/lip-sync-prepared.mp3", { mode: "lite", audioPrepared: true }, "volcengine-lipsync", 42)
    expect(state.kieInputs[1]).toMatchObject({ audio_url: "https://cdn.test/scratch/lip-sync-prepared.mp3", mode: "lite" })
    expect(state.kieInputs[1]).not.toHaveProperty("audioPrepared")
    expect(state.ffmpegArgs).toEqual([])
  })
})

