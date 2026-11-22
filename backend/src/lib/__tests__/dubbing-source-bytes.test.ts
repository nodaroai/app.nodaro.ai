import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  fetchMediaFromUrl: vi.fn(async (_url: string, _max: number) => Buffer.from("the-file")),
  classifyMediaSource: vi.fn(async (url: string, slot: "video" | "audio") => ({ url, slot, hasVideo: slot === "video", hasAudio: true, probed: true })),
  measureDecodedAudio: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  cleanupWorkDir: vi.fn(async () => undefined),
}))

vi.mock("node:fs/promises", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs/promises")>()), writeFile: m.writeFile }))
vi.mock("../../providers/elevenlabs/client.js", () => ({ fetchMediaFromUrl: m.fetchMediaFromUrl }))
vi.mock("../../providers/video/media-source.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/video/media-source.js")>()),
  classifyMediaSource: m.classifyMediaSource,
}))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn(async () => "/tmp/dub-source"),
  cleanupWorkDir: m.cleanupWorkDir,
}))
vi.mock("../../providers/video/decoded-audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/video/decoded-audio-length.js")>()),
  measureDecodedAudio: m.measureDecodedAudio,
}))

import {
  DUBBING_LONGER_THAN_PRICED_MESSAGE,
  DUBBING_OVER_CAP_MESSAGE,
  DUBBING_SOUND_UNREADABLE_MESSAGE,
  assertServiceSpanWithinHold,
  decodedDubbingExceedsHold,
  dubbingHeldSeconds,
  dubbingSpanExceedsHold,
  dubbingWindowFitsHold,
  prepareDubbingUpload,
} from "../dubbing-source-bytes.js"
import { AudioReadStoppedError } from "../../providers/video/decoded-audio-length.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"

const played = (seconds: number) => ({ overCap: false as const, samples: Math.round(seconds * 44_100), seconds })

beforeEach(() => {
  vi.clearAllMocks()
  m.measureDecodedAudio.mockResolvedValue(played(60))
})

describe("what a dub's hold covers", () => {
  it("the whole minutes of its measured span, a hair past a minute forgiven; the 30-minute ceiling when unmeasured", () => {
    expect(dubbingHeldSeconds({ probedDurationSec: 59.98 })).toBe(60)
    expect(dubbingHeldSeconds({ probedDurationSec: 60.03 })).toBe(60)
    expect(dubbingHeldSeconds({ probedDurationSec: 61 })).toBe(120)
    expect(dubbingHeldSeconds({})).toBe(1800)
  })

  it("a span may run up to the held minutes plus one second", () => {
    const held = { probedDurationSec: 58 }
    expect(dubbingSpanExceedsHold(60.9, held)).toBe(false)
    expect(dubbingSpanExceedsHold(61.2, held)).toBe(true)
    expect(dubbingSpanExceedsHold(1800, held)).toBe(true)
  })

  it("a window on both ends that fits the hold bounds the dub, however long the file", () => {
    const held = { probedDurationSec: 30, startTime: 10, endTime: 40 }
    expect(dubbingWindowFitsHold(held)).toBe(true)
    expect(dubbingSpanExceedsHold(1800, held)).toBe(false)
    expect(decodedDubbingExceedsHold({ overCap: true }, held)).toBe(false)
  })

  it("a window wider than the hold (the file measured shorter than it) does not bound it", () => {
    const held = { probedDurationSec: 50, startTime: 0, endTime: 600 }
    expect(dubbingWindowFitsHold(held)).toBe(false)
    expect(dubbingSpanExceedsHold(50, held)).toBe(false)
    expect(dubbingSpanExceedsHold(600, held)).toBe(true)
  })

  it("only one end set: the whole file is the span, as the route prices it", () => {
    expect(dubbingSpanExceedsHold(90, { probedDurationSec: 60, startTime: 45 })).toBe(true)
    expect(dubbingSpanExceedsHold(90, { probedDurationSec: 60, endTime: 30 })).toBe(true)
  })

  it("decoded sound past the decode's cap runs past the hold", () => {
    expect(decodedDubbingExceedsHold({ overCap: true }, { probedDurationSec: 60 })).toBe(true)
    expect(decodedDubbingExceedsHold(played(59.5), { probedDurationSec: 60 })).toBe(false)
  })
})

describe("prepareDubbingUpload", () => {
  it("fetches the link once under the byte cap and hands back those bytes, the mode from the file's own streams", async () => {
    const prepared = await prepareDubbingUpload("https://example.com/talk.mp4", "video", { probedDurationSec: 60 })
    expect(m.fetchMediaFromUrl).toHaveBeenCalledTimes(1)
    expect(m.fetchMediaFromUrl).toHaveBeenCalledWith("https://example.com/talk.mp4", 500 * 1024 * 1024)
    expect(prepared).toEqual({ bytes: Buffer.from("the-file"), videoMode: true, mime: "video/mp4", ext: "mp4" })
    // The file measured and classified is the local copy, never the link.
    expect(m.classifyMediaSource.mock.calls[0]?.[0]).not.toMatch(/^https?:/)
    expect(m.measureDecodedAudio.mock.calls[0]?.[0]).not.toMatch(/^https?:/)
    expect(m.measureDecodedAudio).toHaveBeenCalledWith(expect.any(String), { capSec: 61 })
    expect(m.cleanupWorkDir).toHaveBeenCalled()
  })

  it("a video file in the audio slot is sent as a video file and dubbed as audio", async () => {
    m.classifyMediaSource.mockResolvedValueOnce({ url: "/tmp/x", slot: "audio", hasVideo: true, hasAudio: true, probed: true })
    const prepared = await prepareDubbingUpload("https://example.com/talk.mp4", "audio", { probedDurationSec: 60 })
    expect(prepared).toMatchObject({ videoMode: false, mime: "video/mp4", ext: "mp4" })
  })

  it("refuses, before anything is sent, a file whose sound plays past the minutes held", async () => {
    m.measureDecodedAudio.mockResolvedValueOnce({ overCap: true })
    const err = await prepareDubbingUpload("https://example.com/talk.mp4", "video", { probedDurationSec: 60 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(DUBBING_LONGER_THAN_PRICED_MESSAGE)
    expect(m.cleanupWorkDir).toHaveBeenCalled()
  })

  it("a run held at the 30-minute ceiling is decoded up to the cap and refused past it", async () => {
    m.measureDecodedAudio.mockResolvedValueOnce({ overCap: true })
    const err = await prepareDubbingUpload("https://example.com/talk.mp4", "audio", {}).catch((e: unknown) => e)
    expect(m.measureDecodedAudio).toHaveBeenCalledWith(expect.any(String), { capSec: 1801 })
    expect((err as Error).message).toBe(DUBBING_OVER_CAP_MESSAGE)
  })

  it("a measured run whose file has no sound the decoder reads is refused; one held at the ceiling is sent", async () => {
    m.measureDecodedAudio.mockRejectedValueOnce(new Error("Stream map '0:a:0' matches no streams"))
    const err = await prepareDubbingUpload("https://example.com/talk.mp4", "video", { probedDurationSec: 60 }).catch((e: unknown) => e)
    expect((err as Error).message).toBe(DUBBING_SOUND_UNREADABLE_MESSAGE)

    m.measureDecodedAudio.mockResolvedValueOnce(undefined)
    await expect(prepareDubbingUpload("https://example.com/talk.mp4", "video", {})).resolves.toMatchObject({ videoMode: true })
  })

  it("the service's own reading is held to the hold: a measured span past it, or a ceiling run past 30 minutes, is refused", () => {
    expect(() => assertServiceSpanWithinHold(60.9, { probedDurationSec: 60 })).not.toThrow()
    expect(() => assertServiceSpanWithinHold(61.5, { probedDurationSec: 60 })).toThrow(DUBBING_LONGER_THAN_PRICED_MESSAGE)
    // A window fixes the span, whatever the file's length.
    expect(() => assertServiceSpanWithinHold(3600, { probedDurationSec: 60, startTime: 0, endTime: 60 })).not.toThrow()
    expect(() => assertServiceSpanWithinHold(1800.04, {})).not.toThrow()
    expect(() => assertServiceSpanWithinHold(1900, {})).toThrow(/the maximum is 30 minutes/)
    try {
      assertServiceSpanWithinHold(1900, {})
    } catch (err) {
      expect(isDeterministicJobError(err)).toBe(true)
    }
  })

  it("a file the decoder could not read to its end has no length to trust: a measured dub is refused, never sent", async () => {
    m.measureDecodedAudio.mockRejectedValueOnce(new AudioReadStoppedError("decoded 40 s of the 58 s the mp4 file states"))
    const err = await prepareDubbingUpload("https://example.com/talk.mp4", "video", { probedDurationSec: 60 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(DUBBING_SOUND_UNREADABLE_MESSAGE)
  })

  it("a dub held at the 30-minute ceiling whose decode stopped part-way is sent: the service's reading is held to the ceiling at delivery", async () => {
    m.measureDecodedAudio.mockRejectedValueOnce(new AudioReadStoppedError("decoded 40 s of the 58 s the mp4 file states"))
    await expect(prepareDubbingUpload("https://example.com/talk.mp4", "video", {})).resolves.toMatchObject({ videoMode: true })
  })

  it("a decode our side stopped (its time limit) is not the file's fault: it is thrown as it is, to be tried again", async () => {
    const stopped = Object.assign(new Error("killed"), { killed: true })
    m.measureDecodedAudio.mockRejectedValueOnce(stopped)
    const err = await prepareDubbingUpload("https://example.com/talk.mp4", "video", { probedDurationSec: 60 }).catch((e: unknown) => e)
    expect(err).toBe(stopped)
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("a window that fits the hold needs no decode", async () => {
    await prepareDubbingUpload("https://example.com/talk.mp4", "video", { probedDurationSec: 30, startTime: 0, endTime: 30 })
    expect(m.measureDecodedAudio).not.toHaveBeenCalled()
  })
})
