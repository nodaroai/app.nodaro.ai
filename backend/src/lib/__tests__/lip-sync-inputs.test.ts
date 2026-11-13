/**
 * OmniHuman 2.0's inputs, measured and checked before anything is held
 * (decided 2026-11-11) — the rule the lip-sync route's preHandler and the
 * workflow run's stamp share. The audio is always downloaded and its DECODED
 * length counted (decided 2026-11-12); the download, the decoded-length
 * measure and the image probe are stood in for here (decoded-audio-length.test.ts
 * and lip-sync-audio-parity.test.ts run the real measure on real files).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  image: {} as { size?: { width: number; height: number }; sizeBytes?: number },
  imageCalls: 0,
  /** Every download: its URL and options. */
  downloads: [] as Array<{ url: string; opts: unknown }>,
  /** The download: bytes written; "over-cap" = past the byte cap on the stream; "slow" = stopped under the minimum rate; undefined = it fails. */
  downloaded: { bytes: 400_000 } as undefined | "over-cap" | "slow" | { bytes: number },
  /** When set, every download waits for this before it finishes (a slow host). */
  gate: undefined as Promise<void> | undefined,
  /** What the decoded-length measure reads: seconds, "over" (past the cap), undefined (nothing decoded) or an error. */
  decoded: 10 as number | "over" | undefined | Error,
  measureCaps: [] as number[],
}))

vi.mock("../image-source-probe.js", () => ({
  probeImageSource: async () => {
    state.imageCalls++
    return state.image
  },
}))
vi.mock("../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()),
  downloadFile: async (url: string, path: string, opts: unknown) => {
    state.downloads.push({ url, opts })
    if (state.gate) await state.gate
    const d = state.downloaded
    if (d === undefined) throw new Error("Failed to download: (test)")
    if (d === "over-cap") throw new Error("Download exceeds 95 MB: (test)")
    if (d === "slow") throw new Error("Download timeout: too slow — 0 bytes in the last 10 s, under the 262144 minimum: (test)")
    // A sparse file of that size: what the size check reads, without the disk.
    const { truncate, writeFile } = await import("node:fs/promises")
    await writeFile(path, "")
    await truncate(path, d.bytes)
  },
}))
vi.mock("../../providers/video/decoded-audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/video/decoded-audio-length.js")>()),
  measureDecodedAudio: async (_path: string, opts: { capSec: number }) => {
    state.measureCaps.push(opts.capSec)
    const d = state.decoded
    if (d instanceof Error) throw d
    if (d === "over") return { overCap: true }
    if (d === undefined) return undefined
    return { overCap: false, samples: Math.round(d * 44_100), seconds: d }
  },
}))

import {
  LIP_SYNC_AUDIO_DOWNLOAD_LIMITS,
  audioReadStoppedMessage,
  checkLipSyncInputs,
  lipSyncAudioPricingOf,
  lipSyncBucketReserveId,
  stampLipSyncInputs,
} from "../lip-sync-inputs.js"
import { getLipSyncMaxAudioSeconds, isPerSecondLipSyncProvider, pickLipSyncBucket } from "@nodaro/shared/credits"
import { LIP_SYNC_PROVIDERS } from "@nodaro/shared/models"
import { AudioReadStoppedError } from "../../providers/video/decoded-audio-length.js"
import { LIP_SYNC_MEASURE_SLOT_WAIT_MS, LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS, lipSyncMeasureSlots } from "../lip-sync-download-slots.js"

const OK_IMAGE = { size: { width: 1024, height: 1536 }, sizeBytes: 2_000_000 }
const AUDIO = "https://cdn.test/a.mp3"
const IMAGE = "https://cdn.test/i.png"
const check = (over: Record<string, unknown> = {}) =>
  checkLipSyncInputs({ provider: "omnihuman-2-0", audioUrl: AUDIO, imageUrl: IMAGE, ...over })

beforeEach(() => {
  state.image = OK_IMAGE
  state.imageCalls = 0
  state.downloads = []
  state.downloaded = { bytes: 400_000 }
  state.gate = undefined
  state.decoded = 10
  state.measureCaps = []
})

describe("checkLipSyncInputs — OmniHuman 2.0", () => {
  it.each([
    [3.2, 4],
    [10, 10],
    [10.04, 11],
    [15, 15],
    [60, 60],
    [300, 300],
  ])("audio that decodes to %s s is accepted and billed %s s", async (sec, billed) => {
    state.decoded = sec
    expect(await check()).toEqual({ ok: true, audioSec: sec, billedSeconds: billed })
  })

  it("the audio is always downloaded — under the source cap, at the minimum rate — and decoded up to the rate's maximum", async () => {
    expect(await check()).toMatchObject({ ok: true })
    expect(state.downloads).toEqual([{ url: AUDIO, opts: { limits: LIP_SYNC_AUDIO_DOWNLOAD_LIMITS, maxBytes: 99_999_999 } }])
    expect(LIP_SYNC_AUDIO_DOWNLOAD_LIMITS).toMatchObject({ responseMs: 15_000, windowMs: 10_000, minBytesPerWindow: 262_144, floorBytesPerSec: 262_144, maxMs: 120_000, maxBytes: 100_000_000 })
    expect(state.measureCaps).toEqual([300])
  })

  it("past 300 s is refused before anything is held — measured, or stopped at the cap (no length to quote)", async () => {
    state.decoded = 300.5
    expect(await check()).toMatchObject({ ok: false, code: "audio_too_long", message: expect.stringMatching(/this audio is 300.5 seconds/) })
    state.decoded = "over"
    expect(await check()).toMatchObject({ ok: false, code: "audio_too_long", message: expect.stringMatching(/this audio is longer/) })
  })

  it("a source of 100 MB or more is refused: past the cap on the stream, or a file that reached the disk at the cap anyway", async () => {
    state.downloaded = "over-cap"
    expect(await check()).toMatchObject({ ok: false, code: "audio_too_large", message: expect.stringMatching(/under 100 MB/) })
    // A fetch of our own bucket can fall back to a read the stream cap does not cover.
    state.downloaded = { bytes: 100_000_000 }
    expect(await check()).toMatchObject({ ok: false, code: "audio_too_large" })
  })

  it("a 40 MB WAV is accepted: the model's 15 MB is held after conversion, by the provider", async () => {
    state.downloaded = { bytes: 40_000_000 }
    state.decoded = 226.7
    expect(await check()).toEqual({ ok: true, audioSec: 226.7, billedSeconds: 227 })
  })

  it("a link that stalls or trickles, one that fails, and audio that decodes to nothing (or that ffmpeg refuses) are refused", async () => {
    state.downloaded = "slow"
    expect(await check()).toMatchObject({ ok: false, code: "audio_unreadable", message: expect.stringMatching(/too slowly/) })
    state.downloaded = undefined
    expect(await check()).toMatchObject({ ok: false, code: "audio_unreadable", message: expect.stringMatching(/could not download the audio/) })
    state.downloaded = { bytes: 1_000 }
    state.decoded = undefined
    expect(await check()).toMatchObject({ ok: false, code: "audio_unreadable", message: expect.stringMatching(/could not decode the audio/) })
    state.decoded = new Error("ffmpeg failed: Stream map '0:a:0' matches no streams")
    expect(await check()).toMatchObject({ ok: false, code: "audio_unreadable", message: expect.stringMatching(/could not decode the audio/) })
  })

  it("audio the decoder stopped reading part-way is refused before anything is held, with a sentence that says to re-export it as one file", async () => {
    state.decoded = new AudioReadStoppedError("[in#0/ogg] Error during demuxing: Not yet implemented in FFmpeg, patches welcome")
    expect(await check()).toEqual({ ok: false, code: "audio_unreadable", message: audioReadStoppedMessage("OmniHuman 2.0") })
    expect(audioReadStoppedMessage("OmniHuman 2.0")).toMatch(/^OmniHuman 2\.0 could not read the audio to its end: .* Re-export the audio as one complete, continuous file\.$/)
    // The workflow run refuses it the same way.
    const payload: Record<string, unknown> = { provider: "omnihuman-2-0", audioUrl: AUDIO, imageUrl: IMAGE }
    expect(await stampLipSyncInputs("lip-sync", payload)).toEqual({ code: "audio_unreadable", message: audioReadStoppedMessage("OmniHuman 2.0") })
    expect(payload).not.toHaveProperty("lipSyncBilledSeconds")
  })

  it.each([
    ["a file: link", { audioUrl: "file:///etc/passwd" }],
    ["localhost", { audioUrl: "http://localhost:8080/a.mp3" }],
    ["a private address", { audioUrl: "http://10.0.0.7/a.mp3" }],
    ["a non-http image", { imageUrl: "ftp://cdn.test/i.png" }],
    ["not a URL", { imageUrl: "i.png" }],
  ])("%s is refused before anything is fetched", async (_label, over) => {
    expect(await check(over)).toMatchObject({ ok: false, code: "validation_error" })
    expect(state.downloads).toEqual([])
    expect(state.imageCalls).toBe(0)
  })

  it("the third download at once for one user waits, then is refused as busy (a 429 at the route), before anything is held", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      state.decoded = 12
      let open!: () => void
      state.gate = new Promise<void>((resolve) => { open = resolve })
      const first = check({ userId: "u1" })
      const second = check({ userId: "u1" })
      await vi.advanceTimersByTimeAsync(0)
      expect(lipSyncMeasureSlots.held("u1")).toBe(2)
      const third = check({ userId: "u1" })
      // Another user is not held up by u1's two.
      const otherUser = check({ userId: "u2" })
      await vi.advanceTimersByTimeAsync(LIP_SYNC_MEASURE_SLOT_WAIT_MS)
      expect(await third).toMatchObject({ ok: false, code: "lip_sync_audio_busy", message: expect.stringMatching(/try again in a moment/) })
      open()
      expect(await first).toMatchObject({ ok: true, billedSeconds: 12 })
      expect(await second).toMatchObject({ ok: true, billedSeconds: 12 })
      expect(await otherUser).toMatchObject({ ok: true })
      expect(lipSyncMeasureSlots.held()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("a workflow or app run waits up to two minutes for a slot, past a request's 30 s (decided 2026-11-13)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      state.decoded = 12
      let open!: () => void
      state.gate = new Promise<void>((resolve) => { open = resolve })
      const first = check({ provider: "kling-avatar", userId: "u1" })
      const second = check({ provider: "kling-avatar", userId: "u1" })
      await vi.advanceTimersByTimeAsync(0)
      const payload: Record<string, unknown> = { provider: "kling-avatar", audioUrl: AUDIO }
      const run = stampLipSyncInputs("lip-sync", payload, "u1")
      const request = check({ provider: "kling-avatar", userId: "u1" })
      await vi.advanceTimersByTimeAsync(LIP_SYNC_MEASURE_SLOT_WAIT_MS)
      // The request gave up at 30 s; the run still waits.
      expect(await request).toMatchObject({ ok: false, code: "lip_sync_audio_busy" })
      await vi.advanceTimersByTimeAsync(LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS - LIP_SYNC_MEASURE_SLOT_WAIT_MS - 1_000)
      open()
      await Promise.all([first, second])
      expect(await run).toBeUndefined()
      expect(payload).toMatchObject({ audioDurationSec: 12, lipSyncBilledSeconds: 15 })
      expect(LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS).toBe(120_000)
      expect(lipSyncMeasureSlots.held()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("a waiting download takes the slot a finished one frees", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      let open!: () => void
      state.gate = new Promise<void>((resolve) => { open = resolve })
      const first = check({ userId: "u1" })
      const second = check({ userId: "u1" })
      await vi.advanceTimersByTimeAsync(0)
      const third = check({ userId: "u1" })
      await vi.advanceTimersByTimeAsync(1_000)
      open()
      await Promise.all([first, second])
      expect(await third).toMatchObject({ ok: true })
      expect(lipSyncMeasureSlots.held()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ["a successful measurement", () => {}, true],
    ["a refusal (past the byte cap)", () => { state.downloaded = "over-cap" }, false],
    ["a measurement that throws", () => { state.decoded = new Error("ffmpeg failed: (test)") }, false],
    ["a download that fails", () => { state.downloaded = undefined }, false],
    ["a download that is too slow", () => { state.downloaded = "slow" }, false],
  ])("the slot is released after %s", async (_label, arrange, ok) => {
    arrange()
    expect(await check({ userId: "u1" })).toMatchObject({ ok })
    expect(lipSyncMeasureSlots.held("u1")).toBe(0)
    expect(lipSyncMeasureSlots.held()).toBe(0)
  })

  it.each([
    ["250 px wide", { width: 250, height: 400 }],
    ["over 6,000 px", { width: 6001, height: 4000 }],
    ["wider than 2.5 : 1", { width: 2600, height: 1000 }],
    ["taller than 1 : 2.5", { width: 400, height: 1001 }],
  ])("an image %s is refused", async (_label, size) => {
    state.image = { size, sizeBytes: 1_000_000 }
    expect(await check()).toMatchObject({ ok: false, code: "image_out_of_bounds" })
  })

  it("the bounds themselves are accepted (300 px, 6,000 px, 0.4 and 2.5)", async () => {
    for (const size of [{ width: 300, height: 750 }, { width: 6000, height: 2400 }, { width: 300, height: 300 }]) {
      state.image = { size, sizeBytes: 1_000_000 }
      expect(await check(), JSON.stringify(size)).toMatchObject({ ok: true })
    }
  })

  it("an image of 30 MB or more, or one whose size or bytes cannot be read, is refused", async () => {
    state.image = { ...OK_IMAGE, sizeBytes: 30_000_000 }
    expect(await check()).toMatchObject({ ok: false, code: "image_too_large" })
    state.image = { sizeBytes: 1_000 }
    expect(await check()).toMatchObject({ ok: false, code: "image_unreadable" })
    state.image = { size: { width: 1000, height: 1000 } }
    expect(await check()).toMatchObject({ ok: false, code: "image_unreadable" })
  })

  it("no image (a video-only request) is refused", async () => {
    expect(await check({ imageUrl: undefined, videoUrl: "https://cdn.test/v.mp4" })).toMatchObject({ ok: false, code: "lip_sync_image_required" })
  })

  it("a model whose price reads no length is never probed", async () => {
    for (const provider of ["infinitalk", "seedance-2", "seedance-2-5", "minimax-h3", "latentsync", undefined]) {
      expect(await check({ provider }), String(provider)).toBeUndefined()
    }
    expect(state.imageCalls + state.downloads.length).toBe(0)
  })
})

/**
 * The models priced by a length BUCKET (decided 2026-11-13): the same
 * measure, its audio only, the bucket of the measured length — never a length
 * the request or the node carried.
 */
describe("checkLipSyncInputs — the bucketed models", () => {
  const BUCKETED = ["kling-avatar", "kling-avatar-pro", "omnihuman-1-5", "heygen-lipsync-precision", "lipsync-2-pro", "sync-lipsync-v3", "volcengine-lipsync"]

  it("is every model priced by a length bucket, and no other", () => {
    expect(LIP_SYNC_PROVIDERS.filter((p) => lipSyncAudioPricingOf(p)?.kind === "bucket")).toEqual(BUCKETED)
    expect(LIP_SYNC_PROVIDERS.filter((p) => lipSyncAudioPricingOf(p)?.kind === "rate")).toEqual(["omnihuman-2-0"])
    for (const p of LIP_SYNC_PROVIDERS) expect(lipSyncAudioPricingOf(p)?.kind === "bucket", p).toBe(isPerSecondLipSyncProvider(p))
  })

  it.each(BUCKETED)("%s: the measured length's bucket, decoded under the model's maximum — the face input never probed", async (provider) => {
    const max = getLipSyncMaxAudioSeconds(provider)
    for (const [sec, bucket] of [[3.2, 15], [15, 15], [15.06, 30], [42, 60]] as const) {
      if (sec > max) continue
      state.decoded = sec
      expect(await check({ provider, imageUrl: undefined }), `${provider} @ ${sec}`).toEqual({ ok: true, audioSec: sec, billedSeconds: bucket })
    }
    expect(state.measureCaps.every((c) => c === max)).toBe(true)
    expect(state.imageCalls).toBe(0)
  })

  it.each(BUCKETED)("%s: audio past its maximum is priced at the maximum's bucket, not refused (it is trimmed to it, as before)", async (provider) => {
    const max = getLipSyncMaxAudioSeconds(provider)
    state.decoded = "over"
    expect(await check({ provider })).toEqual({ ok: true, audioSec: max, billedSeconds: pickLipSyncBucket(max) })
    state.decoded = max + 0.5
    expect(await check({ provider })).toEqual({ ok: true, audioSec: max, billedSeconds: pickLipSyncBucket(max) })
  })

  it.each([
    ["damaged or cut short", () => { state.decoded = new AudioReadStoppedError("decoded 4.000 s of the 12.000 s the flac file states") }, "audio_unreadable"],
    ["not audio", () => { state.decoded = new Error("Invalid data found when processing input") }, "audio_unreadable"],
    ["nothing decodes", () => { state.decoded = undefined }, "audio_unreadable"],
    ["unreachable", () => { state.downloaded = undefined }, "audio_unreadable"],
    ["100 MB or more", () => { state.downloaded = "over-cap" }, "audio_too_large"],
  ] as const)("Kling AI Avatar audio that is %s is refused with the rate model's own words", async (_label, arrange, code) => {
    arrange()
    const kling = await check({ provider: "kling-avatar" })
    expect(kling).toMatchObject({ ok: false, code })
    // The same refusal OmniHuman 2.0 gives the same file, but for the model's name.
    const omni = await check()
    expect((kling as { message: string }).message.replace("Kling Avatar Standard", "X")).toBe((omni as { message: string }).message.replace("OmniHuman 2.0", "X"))
  })

  it.each(["kling-avatar", "omnihuman-2-0"])("%s: a decode stopped by its own time limit is OUR failure — a retryable refusal, never \"could not decode\"", async (provider) => {
    state.decoded = Object.assign(new Error("Command failed: ffmpeg"), { killed: true, signal: "SIGKILL" })
    const checked = await check({ provider })
    expect(checked).toMatchObject({ ok: false, code: "lip_sync_audio_measure_stopped" })
    expect((checked as { message: string }).message).toMatch(/try again/)
    expect((checked as { message: string }).message).not.toMatch(/decode|re-export/i)
  })

  it("audio at most 50 ms past a bucket's length is held in that bucket (decoders disagree at a file's end); past that, the next", async () => {
    for (const [sec, bucket] of [
      [15.0187, 15], [15.05, 15], [15.051, 30], [30.04, 30], [60.03, 60], [120.049, 120], [120.06, 300], [300.03, 300],
    ] as const) {
      state.decoded = sec
      expect(await check({ provider: "kling-avatar" }), String(sec)).toMatchObject({ ok: true, billedSeconds: bucket })
    }
    state.decoded = 30.03
    expect(await check({ provider: "omnihuman-1-5" })).toMatchObject({ ok: true, billedSeconds: 30 })
    // OmniHuman 2.0 keeps its whole-second rounding, without this edge.
    state.decoded = 10.04
    expect(await check()).toMatchObject({ ok: true, billedSeconds: 11 })
  })

  it("a link to a private host is refused before anything is fetched", async () => {
    expect(await check({ provider: "kling-avatar", audioUrl: "http://127.0.0.1/a.mp3" })).toMatchObject({ ok: false, code: "validation_error" })
    expect(await check({ provider: "kling-avatar", audioUrl: undefined })).toMatchObject({ ok: false, code: "audio_unreadable" })
    expect(state.downloads).toEqual([])
  })
})

describe("stampLipSyncInputs — the workflow run's twin", () => {
  it("stamps the length it measured over whatever the node carried, and the billed seconds (over any it carried)", async () => {
    state.decoded = 10.04
    const payload: Record<string, unknown> = { provider: "omnihuman-2-0", audioUrl: AUDIO, imageUrl: IMAGE, audioDurationSec: 4, lipSyncBilledSeconds: 1 }
    expect(await stampLipSyncInputs("lip-sync", payload)).toBeUndefined()
    expect(payload).toMatchObject({ audioDurationSec: 10.04, lipSyncBilledSeconds: 11 })
  })

  it("returns the route's refusal, and leaves no held seconds a payload carried", async () => {
    state.decoded = 301
    const payload: Record<string, unknown> = { provider: "omnihuman-2-0", audioUrl: AUDIO, imageUrl: IMAGE, lipSyncBilledSeconds: 4 }
    expect(await stampLipSyncInputs("lip-sync", payload)).toMatchObject({ code: "audio_too_long" })
    expect(payload).not.toHaveProperty("lipSyncBilledSeconds")
  })

  it("leaves every other job and model unprobed — and drops held seconds a lip-sync payload of any model carried", async () => {
    const infinitalk = { provider: "infinitalk", audioUrl: AUDIO, imageUrl: IMAGE, audioDurationSec: 4, lipSyncBilledSeconds: 1 }
    expect(await stampLipSyncInputs("lip-sync", infinitalk)).toBeUndefined()
    expect(infinitalk).toEqual({ provider: "infinitalk", audioUrl: AUDIO, imageUrl: IMAGE, audioDurationSec: 4 })
    const other = { provider: "omnihuman-2-0", lipSyncBilledSeconds: 1 }
    expect(await stampLipSyncInputs("image-to-video", other)).toBeUndefined()
    expect(other).toEqual({ provider: "omnihuman-2-0", lipSyncBilledSeconds: 1 })
    expect(state.imageCalls + state.downloads.length).toBe(0)
  })

  it("a bucketed model: stamps the length it measured over the node's (a shorter one is ignored) and the bucket it holds, which is the row it reserves", async () => {
    state.decoded = 42
    const kling: Record<string, unknown> = { provider: "kling-avatar", audioUrl: AUDIO, imageUrl: IMAGE, audioDurationSec: 4, lipSyncBilledSeconds: 15 }
    expect(await stampLipSyncInputs("lip-sync", kling)).toBeUndefined()
    expect(kling).toMatchObject({ audioDurationSec: 42, lipSyncBilledSeconds: 60 })
    expect(lipSyncBucketReserveId("lip-sync", kling)).toBe("kling-avatar:60s")
    expect(state.imageCalls).toBe(0)
  })

  it("a bucketed model's refusal leaves no held seconds, and an unstamped bucketed run is never reserved on a guess", async () => {
    state.decoded = new AudioReadStoppedError("the file reports damage")
    const kling: Record<string, unknown> = { provider: "kling-avatar", audioUrl: AUDIO, lipSyncBilledSeconds: 15 }
    expect(await stampLipSyncInputs("lip-sync", kling)).toMatchObject({ code: "audio_unreadable", message: audioReadStoppedMessage("Kling Avatar Standard") })
    expect(kling).not.toHaveProperty("lipSyncBilledSeconds")
    expect(() => lipSyncBucketReserveId("lip-sync", kling)).toThrow(/without its measured audio/)
    // Every other job and model: no row of its own here.
    expect(lipSyncBucketReserveId("lip-sync", { provider: "omnihuman-2-0", lipSyncBilledSeconds: 11 })).toBeUndefined()
    expect(lipSyncBucketReserveId("lip-sync", { provider: "infinitalk" })).toBeUndefined()
    expect(lipSyncBucketReserveId("video-sfx", { provider: "kling-avatar" })).toBeUndefined()
  })
})
