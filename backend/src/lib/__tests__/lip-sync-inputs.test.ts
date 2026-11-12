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

import { LIP_SYNC_AUDIO_DOWNLOAD_LIMITS, audioReadStoppedMessage, checkLipSyncInputs, stampLipSyncInputs } from "../lip-sync-inputs.js"
import { AudioReadStoppedError } from "../../providers/video/decoded-audio-length.js"
import { LIP_SYNC_MEASURE_SLOT_WAIT_MS, lipSyncMeasureSlots } from "../lip-sync-download-slots.js"

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

  it("every other lip-sync model is never probed", async () => {
    for (const provider of ["omnihuman-1-5", "kling-avatar", "infinitalk", "volcengine-lipsync", undefined]) {
      expect(await check({ provider }), String(provider)).toBeUndefined()
    }
    expect(state.imageCalls + state.downloads.length).toBe(0)
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
    const kling = { provider: "kling-avatar", audioUrl: AUDIO, imageUrl: IMAGE, audioDurationSec: 4, lipSyncBilledSeconds: 1 }
    expect(await stampLipSyncInputs("lip-sync", kling)).toBeUndefined()
    expect(kling).toEqual({ provider: "kling-avatar", audioUrl: AUDIO, imageUrl: IMAGE, audioDurationSec: 4 })
    const other = { provider: "omnihuman-2-0", lipSyncBilledSeconds: 1 }
    expect(await stampLipSyncInputs("image-to-video", other)).toBeUndefined()
    expect(other).toEqual({ provider: "omnihuman-2-0", lipSyncBilledSeconds: 1 })
    expect(state.imageCalls + state.downloads.length).toBe(0)
  })
})
