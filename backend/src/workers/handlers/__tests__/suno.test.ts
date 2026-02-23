import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockSunoGenerate = vi.fn()
  const mockSunoCover = vi.fn()
  const mockSunoExtend = vi.fn()
  const mockSunoLyrics = vi.fn()
  const mockSunoSeparate = vi.fn()
  const mockSunoMusicVideo = vi.fn()
  const mockUploadToR2 = vi.fn().mockResolvedValue("https://r2.example.com/audio/job-1.mp3")
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumbs/job-1.jpg")
  const mockIsSocialUrl = vi.fn().mockReturnValue(false)
  const mockDownloadAudioToR2 = vi.fn().mockResolvedValue("https://r2.example.com/downloads/audio.mp3")

  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockSunoGenerate, mockSunoCover, mockSunoExtend, mockSunoLyrics, mockSunoSeparate, mockSunoMusicVideo,
    mockUploadToR2, mockCommitJobCredits, mockShouldSaveJobResult,
    mockGenerateAndUploadThumbnail, mockIsSocialUrl, mockDownloadAudioToR2,
    mockFrom, mockUpdate, mockEq,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.mockFrom } }))
vi.mock("@/lib/storage.js", () => ({ uploadToR2: mocks.mockUploadToR2 }))
vi.mock("@/providers/kie/suno-client.js", () => ({
  sunoGenerate: mocks.mockSunoGenerate,
  sunoCover: mocks.mockSunoCover,
  sunoExtend: mocks.mockSunoExtend,
  sunoLyrics: mocks.mockSunoLyrics,
  sunoSeparate: mocks.mockSunoSeparate,
  sunoMusicVideo: mocks.mockSunoMusicVideo,
}))
vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
  isSocialUrl: mocks.mockIsSocialUrl,
  downloadAudioToR2: mocks.mockDownloadAudioToR2,
}))

import { sunoHandlers } from "../suno.js"

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return { name, data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false, ...overrides }
}

const SUNO_TRACK = { id: "track-1", audioUrl: "https://suno.example.com/track.mp3", title: "My Song", duration: 120, imageUrl: "https://suno.example.com/cover.jpg" }
const SUNO_RESULT = { taskId: "suno-task-1", tracks: [SUNO_TRACK] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockSunoGenerate.mockResolvedValue(SUNO_RESULT)
  mocks.mockSunoCover.mockResolvedValue(SUNO_RESULT)
  mocks.mockSunoExtend.mockResolvedValue(SUNO_RESULT)
  mocks.mockSunoLyrics.mockResolvedValue({ taskId: "suno-task-1", lyrics: "La la la" })
  mocks.mockSunoSeparate.mockResolvedValue({
    taskId: "suno-task-1",
    vocalUrl: "https://suno.example.com/vocal.mp3",
    instrumentalUrl: "https://suno.example.com/instrumental.mp3",
  })
  mocks.mockSunoMusicVideo.mockResolvedValue({ taskId: "suno-task-1", videoUrl: "https://suno.example.com/video.mp4" })
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
  mocks.mockIsSocialUrl.mockReturnValue(false)
})

describe("suno-generate handler", () => {
  const handler = sunoHandlers["suno-generate"]

  it("happy path: generates, uploads first track, saves metadata", async () => {
    const job = makeJob("suno-generate", { prompt: "epic rock song" })
    await handler(job as never, makeCtx())

    expect(mocks.mockSunoGenerate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "epic rock song" }))
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://suno.example.com/track.mp3", "job-1", "audio", "user-1")
    expect(mocks.mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      output_data: expect.objectContaining({
        audioUrl: "https://r2.example.com/audio/job-1.mp3",
        sunoTrackId: "track-1",
        sunoTitle: "My Song",
      }),
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("throws when no tracks returned", async () => {
    mocks.mockSunoGenerate.mockResolvedValueOnce({ taskId: "suno-task-1", tracks: [] })
    const job = makeJob("suno-generate", { prompt: "no tracks" })
    await expect(handler(job as never, makeCtx())).rejects.toThrow("Suno returned no tracks")
  })
})

describe("suno-cover handler", () => {
  const handler = sunoHandlers["suno-cover"]

  it("happy path with non-social URL", async () => {
    const job = makeJob("suno-cover", { prompt: "jazz cover", uploadUrl: "https://example.com/song.mp3" })
    await handler(job as never, makeCtx())

    expect(mocks.mockDownloadAudioToR2).not.toHaveBeenCalled()
    expect(mocks.mockSunoCover).toHaveBeenCalledWith(expect.objectContaining({ uploadUrl: "https://example.com/song.mp3" }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("downloads audio first for social URLs", async () => {
    mocks.mockIsSocialUrl.mockReturnValueOnce(true)
    const job = makeJob("suno-cover", { prompt: "jazz cover", uploadUrl: "https://youtube.com/watch?v=abc" })
    await handler(job as never, makeCtx())

    expect(mocks.mockDownloadAudioToR2).toHaveBeenCalledWith("https://youtube.com/watch?v=abc")
    expect(mocks.mockSunoCover).toHaveBeenCalledWith(expect.objectContaining({ uploadUrl: "https://r2.example.com/downloads/audio.mp3" }))
  })
})

describe("suno-extend handler", () => {
  const handler = sunoHandlers["suno-extend"]

  it("happy path", async () => {
    const job = makeJob("suno-extend", { audioId: "audio-1" })
    await handler(job as never, makeCtx())

    expect(mocks.mockSunoExtend).toHaveBeenCalledWith(expect.objectContaining({ audioId: "audio-1" }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })
})

describe("suno-lyrics handler", () => {
  const handler = sunoHandlers["suno-lyrics"]

  it("happy path: generates lyrics (text output only)", async () => {
    const job = makeJob("suno-lyrics", { prompt: "a love song" })
    await handler(job as never, makeCtx())

    expect(mocks.mockSunoLyrics).toHaveBeenCalledWith({ prompt: "a love song" })
    expect(mocks.mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      output_data: { lyrics: "La la la", sunoTaskId: "suno-task-1" },
    }))
    expect(mocks.mockUploadToR2).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })
})

describe("suno-separate handler", () => {
  const handler = sunoHandlers["suno-separate"]

  it("happy path: uploads available stems", async () => {
    mocks.mockUploadToR2
      .mockResolvedValueOnce("https://r2.example.com/audio/job-1-vocal.mp3")
      .mockResolvedValueOnce("https://r2.example.com/audio/job-1-instrumental.mp3")

    const job = makeJob("suno-separate", { taskId: "suno-task-1", audioId: "audio-1" })
    await handler(job as never, makeCtx())

    expect(mocks.mockSunoSeparate).toHaveBeenCalledWith({ taskId: "suno-task-1", audioId: "audio-1", type: "separate_vocal" })
    expect(mocks.mockUploadToR2).toHaveBeenCalledTimes(2)
    expect(mocks.mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      output_data: expect.objectContaining({
        separateType: "separate_vocal",
        vocalUrl: "https://r2.example.com/audio/job-1-vocal.mp3",
        instrumentalUrl: "https://r2.example.com/audio/job-1-instrumental.mp3",
      }),
    }))
  })
})

describe("suno-music-video handler", () => {
  const handler = sunoHandlers["suno-music-video"]

  it("happy path: generates video, uploads, creates thumbnail", async () => {
    mocks.mockUploadToR2.mockResolvedValueOnce("https://r2.example.com/video/job-1.mp4")
    const job = makeJob("suno-music-video", { taskId: "suno-task-1", audioId: "audio-1" })
    await handler(job as never, makeCtx())

    expect(mocks.mockSunoMusicVideo).toHaveBeenCalledWith({ taskId: "suno-task-1", audioId: "audio-1" })
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://suno.example.com/video.mp4", "job-1", "video", "user-1")
    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalledWith("https://r2.example.com/video/job-1.mp4", "job-1", "user-1")
    expect(mocks.mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      output_data: expect.objectContaining({
        videoUrl: "https://r2.example.com/video/job-1.mp4",
        thumbnailUrl: "https://r2.example.com/thumbs/job-1.jpg",
      }),
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })
})

describe("shared suno handler behavior", () => {
  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const handler = sunoHandlers["suno-generate"]
    const job = makeJob("suno-generate", { prompt: "cancel" })
    await handler(job as never, makeCtx())
    expect(mocks.mockUpdate).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})
