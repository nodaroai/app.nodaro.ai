import { beforeEach, describe, expect, it, vi } from "vitest"

// `extractAudioTrack`'s download options, and `classifyMediaSource`'s time
// limit: what each forwards, and that a caller passing neither gets exactly
// the call it got before they existed.
const m = vi.hoisted(() => ({
  download: vi.fn(),
  hasAudio: vi.fn(),
  ffmpeg: vi.fn(),
  streams: vi.fn(),
}))

vi.mock("../ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ffmpeg-utils.js")>()),
  downloadFile: m.download,
  hasAudioStream: m.hasAudio,
  runFfmpeg: m.ffmpeg,
  probeMediaStreams: m.streams,
  createWorkDir: vi.fn(async () => "/tmp/vc"),
  cleanupWorkDir: vi.fn(async () => undefined),
}))

import { extractAudioTrack } from "../extract-audio-track.js"
import { classifyMediaSource } from "../media-source.js"
import { BIG_MEDIA_DOWNLOAD_LIMITS } from "../ffmpeg-utils.js"

beforeEach(() => {
  vi.clearAllMocks()
  m.download.mockResolvedValue(undefined)
  m.hasAudio.mockResolvedValue(true)
  m.ffmpeg.mockResolvedValue(undefined)
  m.streams.mockResolvedValue({ hasVideo: true, hasAudio: true })
})

describe("extractAudioTrack download options", () => {
  it("without options: the very download call every existing caller made (no options argument at all)", async () => {
    await extractAudioTrack("https://cdn.example.com/v.mp4")
    expect(m.download.mock.calls).toEqual([["https://cdn.example.com/v.mp4", "/tmp/vc/input.mp4"]])
  })

  it("with options: the download runs under the given limits and byte cap", async () => {
    await extractAudioTrack("https://cdn.example.com/v.mp4", { download: { limits: BIG_MEDIA_DOWNLOAD_LIMITS, maxBytes: 1234 } })
    expect(m.download.mock.calls).toEqual([["https://cdn.example.com/v.mp4", "/tmp/vc/input.mp4", { limits: BIG_MEDIA_DOWNLOAD_LIMITS, maxBytes: 1234 }]])
  })

  it("a refusal from the download passes on as it is (the caller decides what it means)", async () => {
    const cap = new Error("Download exceeds 1 MB: https://cdn.example.com/v.mp4")
    m.download.mockRejectedValue(cap)
    await expect(extractAudioTrack("https://cdn.example.com/v.mp4", { download: { maxBytes: 1 } })).rejects.toBe(cap)
  })
})

describe("classifyMediaSource time limit", () => {
  it("without one, probes exactly as before", async () => {
    await classifyMediaSource("https://cdn.example.com/v.mp4", "audio")
    expect(m.streams.mock.calls).toEqual([["https://cdn.example.com/v.mp4"]])
  })

  it("with one, the probe runs under it; a probe that fails still fails open on the slot's word", async () => {
    m.streams.mockRejectedValue(new Error("ffprobe failed: timed out"))
    const source = await classifyMediaSource("https://cdn.example.com/v.mp4", "audio", { timeoutMs: 5_000 })
    expect(m.streams.mock.calls).toEqual([["https://cdn.example.com/v.mp4", { timeoutMs: 5_000 }]])
    expect(source).toMatchObject({ hasVideo: false, hasAudio: true, probed: false })
  })
})
