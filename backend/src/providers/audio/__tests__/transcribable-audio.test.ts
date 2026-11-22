import { beforeEach, describe, expect, it, vi } from "vitest"

// Only the side-effectful steps are mocked: the download + ffmpeg extraction,
// the work-dir cleanup and the scratch store. The silent-video error class stays
// REAL, so the test proves the mapping from it.
const m = vi.hoisted(() => ({
  extract: vi.fn(),
  cleanup: vi.fn(),
  upload: vi.fn(),
  discard: vi.fn(),
  jobId: vi.fn(),
}))

vi.mock("../../video/extract-audio-track.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../video/extract-audio-track.js")>()),
  extractAudioTrack: m.extract,
}))
vi.mock("../../video/ffmpeg-utils.js", () => ({ cleanupWorkDir: m.cleanup }))
vi.mock("../../../lib/job-scratch.js", () => ({ uploadJobScratchFile: m.upload, discardJobScratchFile: m.discard }))
vi.mock("../../../lib/job-cancellation.js", () => ({ getJobId: m.jobId }))

import { NoAudioTrackError } from "../../video/extract-audio-track.js"
import {
  isAcceptedAudioFile,
  laneNeedsAudioFile,
  LANE_NEEDS_AUDIO_FILE,
  NoAudioToTranscribeError,
  toTranscribableAudio,
} from "../transcribable-audio.js"
import { TRANSCRIBE_LANES } from "@nodaro/shared/models"

beforeEach(() => {
  vi.clearAllMocks()
  m.extract.mockResolvedValue({ audioPath: "/tmp/w/audio.mp3", workDir: "/tmp/w" })
  m.cleanup.mockResolvedValue(undefined)
  m.upload.mockResolvedValue("https://cdn.example.com/scratch/transcribe-audio-1.mp3")
  m.discard.mockResolvedValue(undefined)
  m.jobId.mockReturnValue("job-1")
})

describe("which lanes read only an audio file", () => {
  it("states every lane", () => {
    expect(Object.keys(LANE_NEEDS_AUDIO_FILE).sort()).toEqual([...TRANSCRIBE_LANES].sort())
  })

  it("the two whisper lanes do; Scribe, Nemotron and an unknown lane do not", () => {
    expect(laneNeedsAudioFile("whisper")).toBe(true)
    expect(laneNeedsAudioFile("incredibly-fast-whisper")).toBe(true)
    expect(laneNeedsAudioFile("elevenlabs-stt")).toBe(false)
    expect(laneNeedsAudioFile("nemotron-3-5-transcribe")).toBe(false)
    expect(laneNeedsAudioFile("something-else")).toBe(false)
  })
})

describe("isAcceptedAudioFile", () => {
  it.each([
    "https://cdn.example.com/audios/a.mp3",
    "https://cdn.example.com/a.WAV",
    "https://cdn.example.com/a.flac?sig=1",
    "https://cdn.example.com/a.mp3#t=2",
  ])("%s is", (url) => expect(isAcceptedAudioFile(url)).toBe(true))

  it.each([
    "https://cdn.example.com/videos/e3da6842.mp4",
    "https://cdn.example.com/a.m4a",
    "https://cdn.example.com/a.ogg",
    "https://cdn.example.com/a.mov?x=.mp3",
    // The host is not the file: a name ending .mp3 there says nothing about the path.
    "https://audio.mp3",
  ])("%s is not", (url) => expect(isAcceptedAudioFile(url)).toBe(false))
})

describe("toTranscribableAudio", () => {
  it("returns an accepted audio file as it is, with nothing to store", async () => {
    const audio = await toTranscribableAudio("https://cdn.example.com/audios/a.mp3")

    expect(audio.url).toBe("https://cdn.example.com/audios/a.mp3")
    expect(m.extract).not.toHaveBeenCalled()
    await audio.discard()
    expect(m.discard).not.toHaveBeenCalled()
  })

  it("stores a video's audio track as an MP3 in the job's scratch folder", async () => {
    const audio = await toTranscribableAudio("https://cdn.example.com/videos/clip.mp4")

    expect(m.extract).toHaveBeenCalledWith("https://cdn.example.com/videos/clip.mp4")
    expect(m.upload).toHaveBeenCalledWith("/tmp/w/audio.mp3", "transcribe-audio", "mp3", "audio/mpeg", "job-1")
    expect(m.cleanup).toHaveBeenCalledWith("/tmp/w")
    expect(audio.url).toBe("https://cdn.example.com/scratch/transcribe-audio-1.mp3")

    await audio.discard()
    expect(m.discard).toHaveBeenCalledWith("https://cdn.example.com/scratch/transcribe-audio-1.mp3", "job-1")
  })

  it("answers a video with no audio track with the transcription's own error", async () => {
    m.extract.mockRejectedValueOnce(new NoAudioTrackError())

    await expect(toTranscribableAudio("https://cdn.example.com/videos/silent.mp4")).rejects.toBeInstanceOf(NoAudioToTranscribeError)
    expect(m.upload).not.toHaveBeenCalled()
  })

  it("passes any other extraction failure on as it is", async () => {
    m.extract.mockRejectedValueOnce(new Error("download failed"))

    await expect(toTranscribableAudio("https://cdn.example.com/videos/clip.mp4")).rejects.toThrow("download failed")
  })

  it("cleans the work dir when the upload fails", async () => {
    m.upload.mockRejectedValueOnce(new Error("storage down"))

    await expect(toTranscribableAudio("https://cdn.example.com/videos/clip.mp4")).rejects.toThrow("storage down")
    expect(m.cleanup).toHaveBeenCalledWith("/tmp/w")
  })

  it("outside a job, stores the file and leaves it to the scratch sweep", async () => {
    m.jobId.mockReturnValue(undefined)

    const audio = await toTranscribableAudio("https://cdn.example.com/videos/clip.mp4")
    await audio.discard()

    expect(m.upload).toHaveBeenCalledWith("/tmp/w/audio.mp3", "transcribe-audio", "mp3", "audio/mpeg", undefined)
    expect(m.discard).not.toHaveBeenCalled()
  })
})
