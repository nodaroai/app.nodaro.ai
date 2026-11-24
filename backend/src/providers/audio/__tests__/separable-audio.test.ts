import { beforeEach, describe, expect, it, vi } from "vitest"

// The side-effectful steps are stood in for: the stream probe
// (`probeMediaStreams`), the format probe, the download + extraction, the
// work-dir cleanup and the scratch store. `classifyMediaSource` stays REAL, so
// these tests prove what the probe's answer decides, the fail-open rule and
// that the time limit reaches the probe; every error class stays real too.
const m = vi.hoisted(() => ({
  streams: vi.fn(),
  formatProbe: vi.fn(),
  extract: vi.fn(),
  cleanup: vi.fn(),
  upload: vi.fn(),
}))

vi.mock("../../video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../video/ffmpeg-utils.js")>()),
  probeMediaStreams: m.streams,
  probeMediaFormatAndDuration: m.formatProbe,
  cleanupWorkDir: m.cleanup,
}))
vi.mock("../../video/extract-audio-track.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../video/extract-audio-track.js")>()),
  extractAudioTrack: m.extract,
}))
vi.mock("../../../lib/job-scratch.js", () => ({ uploadJobScratchFile: m.upload }))

import { NoAudioTrackError } from "../../video/extract-audio-track.js"
import { BIG_MEDIA_DOWNLOAD_LIMITS } from "../../video/ffmpeg-utils.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import {
  isImageFormat,
  NoAudioToSeparateError,
  NotSeparableMediaError,
  SEPARABLE_AUDIO_PROBE_TIMEOUT_MS,
  SEPARABLE_VIDEO_MAX_BYTES,
  toSeparableAudio,
  VideoTooLargeToSeparateError,
} from "../separable-audio.js"

/** What `probeMediaStreams` reads from a file holding these streams (cover art is no picture: it reads as audio only). */
function listing(streams: ReadonlyArray<"audio" | "video" | "cover">): { hasVideo: boolean; hasAudio: boolean } {
  return { hasVideo: streams.includes("video"), hasAudio: streams.includes("audio") }
}

const AUDIO = "audio" as const
const VIDEO = "video" as const
const COVER = "cover" as const

const URL_IN = "https://cdn.example.com/media/clip.mp4"
const SCRATCH = "https://cdn.example.com/tmp/provider-input/job-1/separate-audio-1.mp3"

/** The refusal `downloadFile` throws past its byte cap (its own wording). */
const capRefusal = () => new Error(`Download exceeds 500 MB: ${URL_IN}`)

beforeEach(() => {
  vi.clearAllMocks()
  m.formatProbe.mockResolvedValue({ formatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"] })
  m.extract.mockResolvedValue({ audioPath: "/tmp/w/audio.mp3", workDir: "/tmp/w" })
  m.cleanup.mockResolvedValue(undefined)
  m.upload.mockResolvedValue(SCRATCH)
})

describe("toSeparableAudio — the probe", () => {
  it("the separation's time limit reaches the stream probe through classifyMediaSource", async () => {
    m.streams.mockResolvedValue(listing([AUDIO]))
    await toSeparableAudio(URL_IN, "job-1")
    expect(m.streams).toHaveBeenCalledTimes(1)
    expect(m.streams).toHaveBeenCalledWith(URL_IN, { timeoutMs: SEPARABLE_AUDIO_PROBE_TIMEOUT_MS })
  })

  it("a probe that cannot run leaves the link as it came, as before this step existed", async () => {
    m.streams.mockRejectedValue(Object.assign(new Error("ffprobe failed: timed out"), { timedOut: true }))
    expect(await toSeparableAudio(URL_IN, "job-1")).toBe(URL_IN)
    expect(m.extract).not.toHaveBeenCalled()
    expect(m.upload).not.toHaveBeenCalled()
  })
})

describe("toSeparableAudio — audio passes through", () => {
  it.each([
    ["an audio file", [AUDIO], "https://cdn.example.com/a.mp3"],
    ["an MP3 with album art", [AUDIO, COVER], "https://cdn.example.com/song.mp3"],
    ["audio in an MP4 container (named like a video)", [AUDIO], "https://cdn.example.com/voice.mp4"],
    ["a WAV with an unusual name", [AUDIO], "https://cdn.example.com/take?id=7"],
  ])("%s goes through untouched: same link, nothing downloaded, encoded or stored", async (_label, streams, url) => {
    m.streams.mockResolvedValue(listing(streams))
    expect(await toSeparableAudio(url, "job-1")).toBe(url)
    expect(m.extract).not.toHaveBeenCalled()
    expect(m.upload).not.toHaveBeenCalled()
    expect(m.cleanup).not.toHaveBeenCalled()
  })
})

describe("toSeparableAudio — a video", () => {
  it("whatever its name, is split by its sound: downloaded under the big-media limits and the byte cap, stored in the job's scratch folder", async () => {
    m.streams.mockResolvedValue(listing([VIDEO, AUDIO]))
    const named = "https://cdn.example.com/looks-like-audio.mp3"
    expect(await toSeparableAudio(named, "job-1")).toBe(SCRATCH)
    expect(m.extract).toHaveBeenCalledWith(named, { download: { limits: BIG_MEDIA_DOWNLOAD_LIMITS, maxBytes: SEPARABLE_VIDEO_MAX_BYTES } })
    expect(m.upload).toHaveBeenCalledWith("/tmp/w/audio.mp3", "separate-audio", "mp3", "audio/mpeg", "job-1")
    expect(m.cleanup).toHaveBeenCalledWith("/tmp/w")
  })

  it("the byte cap is 500 MB", () => {
    expect(SEPARABLE_VIDEO_MAX_BYTES).toBe(500 * 1024 * 1024)
  })

  it("over the byte cap fails at once, final, with a sentence naming the limit (not a retryable timeout)", async () => {
    m.streams.mockResolvedValue(listing([VIDEO, AUDIO]))
    m.extract.mockRejectedValue(capRefusal())
    const err = await toSeparableAudio(URL_IN, "job-1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VideoTooLargeToSeparateError)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(
      "This video is larger than 500 MB. Trim it, or connect its audio instead (an Extract Audio node, or an MP3 or M4A of it).",
    )
    expect(m.upload).not.toHaveBeenCalled()
  })

  it("without sound fails at once, without a download: final, with the sentence the person sees", async () => {
    m.streams.mockResolvedValue(listing([VIDEO]))
    const err = await toSeparableAudio(URL_IN, "job-1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoAudioToSeparateError)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("This video has no sound to separate. Use a clip with audio in it, or connect the audio itself.")
    expect(m.extract).not.toHaveBeenCalled()
  })

  it("a silent video whose format probe fails still gets the silent-video sentence", async () => {
    m.streams.mockResolvedValue(listing([VIDEO]))
    m.formatProbe.mockRejectedValue(new Error("ffprobe failed"))
    await expect(toSeparableAudio(URL_IN, "job-1")).rejects.toBeInstanceOf(NoAudioToSeparateError)
  })

  it("a sound stream the downloaded copy does not really carry fails as a silent video", async () => {
    m.streams.mockResolvedValue(listing([VIDEO, AUDIO]))
    m.extract.mockRejectedValue(new NoAudioTrackError())
    const err = await toSeparableAudio(URL_IN, "job-1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoAudioToSeparateError)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(m.upload).not.toHaveBeenCalled()
  })

  it("any other extraction failure passes on as it is (a retryable error)", async () => {
    m.streams.mockResolvedValue(listing([VIDEO, AUDIO]))
    const boom = new Error("Download timeout: 120 s")
    m.extract.mockRejectedValue(boom)
    const err = await toSeparableAudio(URL_IN, "job-1").catch((e: unknown) => e)
    expect(err).toBe(boom)
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("cleans the work dir when the upload fails", async () => {
    m.streams.mockResolvedValue(listing([VIDEO, AUDIO]))
    m.upload.mockRejectedValue(new Error("storage down"))
    await expect(toSeparableAudio(URL_IN, "job-1")).rejects.toThrow("storage down")
    expect(m.cleanup).toHaveBeenCalledWith("/tmp/w")
  })
})

describe("toSeparableAudio — a picture or a GIF", () => {
  it.each([
    ["a PNG", ["png_pipe"]],
    ["a JPEG", ["jpeg_pipe"]],
    ["a JPEG read by name", ["image2"]],
    ["a GIF", ["gif"]],
    ["a WebP", ["webp_pipe"]],
  ])("%s gets its own sentence, final, nothing downloaded", async (_label, formatNames) => {
    m.streams.mockResolvedValue(listing([VIDEO]))
    m.formatProbe.mockResolvedValue({ formatNames })
    const err = await toSeparableAudio("https://cdn.example.com/picture", "job-1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NotSeparableMediaError)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe("This file is an image, not audio or a video. Connect a song, a recording, or a video with sound.")
    expect(m.extract).not.toHaveBeenCalled()
  })

  it("isImageFormat: picture demuxers yes; video and audio containers no", () => {
    expect(isImageFormat(["png_pipe"])).toBe(true)
    expect(isImageFormat(["apng"])).toBe(true)
    expect(isImageFormat(["image2pipe"])).toBe(true)
    expect(isImageFormat(["mov", "mp4", "m4a", "3gp", "3g2", "mj2"])).toBe(false)
    expect(isImageFormat(["matroska", "webm"])).toBe(false)
    expect(isImageFormat(["mp3"])).toBe(false)
    expect(isImageFormat([])).toBe(false)
  })
})
