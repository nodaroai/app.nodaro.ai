import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockSunoGenerate = vi.fn()
  const mockSunoCover = vi.fn()
  const mockSunoExtend = vi.fn()
  const mockSunoLyrics = vi.fn()
  const mockSunoSeparate = vi.fn()
  const mockSunoMusicVideo = vi.fn()
  const mockSunoMashup = vi.fn()
  const mockSunoReplaceSection = vi.fn()
  const mockSunoAddInstrumental = vi.fn()
  const mockSunoAddVocals = vi.fn()
  const mockSunoConvertWav = vi.fn()
  const mockSunoUploadExtend = vi.fn()
  const mockUploadToR2 = vi.fn().mockResolvedValue("https://r2.example.com/audio/job-1.mp3")
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumbs/job-1.jpg")
  const mockIsSocialUrl = vi.fn().mockReturnValue(false)
  const mockDownloadAudioToR2 = vi.fn().mockResolvedValue("https://r2.example.com/downloads/audio.mp3")

  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockSunoGenerate, mockSunoCover, mockSunoExtend, mockSunoLyrics, mockSunoSeparate, mockSunoMusicVideo,
    mockSunoMashup, mockSunoReplaceSection, mockSunoAddInstrumental, mockSunoAddVocals, mockSunoConvertWav, mockSunoUploadExtend,
    mockUploadToR2, mockCommitJobCredits, mockShouldSaveJobResult,
    mockMarkJobCompleted,
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
  sunoMashup: mocks.mockSunoMashup,
  sunoReplaceSection: mocks.mockSunoReplaceSection,
  sunoAddInstrumental: mocks.mockSunoAddInstrumental,
  sunoAddVocals: mocks.mockSunoAddVocals,
  sunoConvertWav: mocks.mockSunoConvertWav,
  sunoUploadExtend: mocks.mockSunoUploadExtend,
}))
vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  markJobCompleted: mocks.mockMarkJobCompleted,
  generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
  isSocialUrl: mocks.mockIsSocialUrl,
  downloadAudioToR2: mocks.mockDownloadAudioToR2,
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  startProgressRamp: vi.fn().mockReturnValue({ stop: vi.fn() }),
  withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
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
  mocks.mockSunoMashup.mockResolvedValue(SUNO_RESULT)
  mocks.mockSunoReplaceSection.mockResolvedValue(SUNO_RESULT)
  mocks.mockSunoAddInstrumental.mockResolvedValue(SUNO_RESULT)
  mocks.mockSunoAddVocals.mockResolvedValue(SUNO_RESULT)
  mocks.mockSunoConvertWav.mockResolvedValue({ taskId: "suno-task-1", audioUrl: "https://suno.example.com/track.wav" })
  mocks.mockSunoUploadExtend.mockResolvedValue(SUNO_RESULT)
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
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
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

  // Regression net: Suno always returns 2 tracks per generation. Pre-fix the
  // handler uploaded only tracks[0] and silently discarded the second. Now the
  // worker uploads every track in parallel under suffixed keys and persists
  // both audioUrls + sunoTracks so the frontend version pill surfaces both.
  it("uploads all tracks and surfaces audioUrls + sunoTracks for multi-track results", async () => {
    const t1 = { id: "t1", audioUrl: "https://suno.example.com/a.mp3", title: "Take 1", duration: 100, imageUrl: "https://suno.example.com/a.jpg" }
    const t2 = { id: "t2", audioUrl: "https://suno.example.com/b.mp3", title: "Take 2", duration: 110, imageUrl: "https://suno.example.com/b.jpg" }
    mocks.mockSunoGenerate.mockResolvedValueOnce({ taskId: "suno-task-1", tracks: [t1, t2] })
    // Distinct R2 URLs per call so the assertion can verify suffix-keyed routing.
    mocks.mockUploadToR2
      .mockResolvedValueOnce("https://r2.example.com/audio/job-1.mp3")
      .mockResolvedValueOnce("https://r2.example.com/audio/job-1-v1.mp3")
    const job = makeJob("suno-generate", { prompt: "epic rock song" })
    await handler(job as never, makeCtx())

    expect(mocks.mockUploadToR2).toHaveBeenNthCalledWith(1, t1.audioUrl, "job-1", "audio", "user-1")
    expect(mocks.mockUploadToR2).toHaveBeenNthCalledWith(2, t2.audioUrl, "job-1-v1", "audio", "user-1")
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: expect.objectContaining({
        audioUrl: "https://r2.example.com/audio/job-1.mp3",
        audioUrls: [
          "https://r2.example.com/audio/job-1.mp3",
          "https://r2.example.com/audio/job-1-v1.mp3",
        ],
        sunoTracks: [
          { id: "t1", title: "Take 1", duration: 100, imageUrl: "https://suno.example.com/a.jpg", audioUrl: "https://r2.example.com/audio/job-1.mp3" },
          { id: "t2", title: "Take 2", duration: 110, imageUrl: "https://suno.example.com/b.jpg", audioUrl: "https://r2.example.com/audio/job-1-v1.mp3" },
        ],
        trackCount: 2,
      }),
    }))
  })

  // Inverse case: single-track results must NOT add audioUrls to output_data
  // (so the frontend doesn't mis-trigger the multi-variant fan-out path).
  it("omits audioUrls when only one track returned", async () => {
    const job = makeJob("suno-generate", { prompt: "single take" })
    await handler(job as never, makeCtx())

    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: expect.not.objectContaining({ audioUrls: expect.anything() }),
    }))
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
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
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
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
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
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: expect.objectContaining({
        videoUrl: "https://r2.example.com/video/job-1.mp4",
        thumbnailUrl: "https://r2.example.com/thumbs/job-1.jpg",
      }),
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })
})

describe("suno-mashup handler", () => {
  const handler = sunoHandlers["suno-mashup"]

  it("happy path: mashes up two tracks, uploads, saves metadata", async () => {
    const job = makeJob("suno-mashup", { uploadUrlList: ["https://example.com/a.mp3", "https://example.com/b.mp3"] })
    await handler(job as never, makeCtx())

    expect(mocks.mockSunoMashup).toHaveBeenCalledWith(expect.objectContaining({ uploadUrlList: ["https://example.com/a.mp3", "https://example.com/b.mp3"] }))
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://suno.example.com/track.mp3", "job-1", "audio", "user-1")
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("throws when no tracks returned", async () => {
    mocks.mockSunoMashup.mockResolvedValueOnce({ taskId: "suno-task-1", tracks: [] })
    const job = makeJob("suno-mashup", { uploadUrlList: ["https://example.com/a.mp3", "https://example.com/b.mp3"] })
    await expect(handler(job as never, makeCtx())).rejects.toThrow("Suno mashup returned no tracks")
  })
})

describe("suno-replace-section handler", () => {
  const handler = sunoHandlers["suno-replace-section"]

  it("happy path: replaces section, uploads, saves metadata", async () => {
    const job = makeJob("suno-replace-section", { taskId: "suno-task-1", audioId: "audio-1", infillStartS: 10, infillEndS: 20, prompt: "new verse", tags: "rock" })
    await handler(job as never, makeCtx())

    expect(mocks.mockSunoReplaceSection).toHaveBeenCalledWith(expect.objectContaining({ audioId: "audio-1", infillStartS: 10, infillEndS: 20, prompt: "new verse", tags: "rock" }))
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://suno.example.com/track.mp3", "job-1", "audio", "user-1")
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("throws when no tracks returned", async () => {
    mocks.mockSunoReplaceSection.mockResolvedValueOnce({ taskId: "suno-task-1", tracks: [] })
    const job = makeJob("suno-replace-section", { taskId: "suno-task-1", audioId: "audio-1", infillStartS: 10, infillEndS: 20, prompt: "new", tags: "rock" })
    await expect(handler(job as never, makeCtx())).rejects.toThrow("Suno replace-section returned no tracks")
  })
})

describe("suno-add-instrumental handler", () => {
  const handler = sunoHandlers["suno-add-instrumental"]

  it("happy path: adds instrumental, uploads, saves metadata", async () => {
    const job = makeJob("suno-add-instrumental", { taskId: "suno-task-1", audioId: "audio-1" })
    await handler(job as never, makeCtx())

    expect(mocks.mockSunoAddInstrumental).toHaveBeenCalledWith(expect.objectContaining({ taskId: "suno-task-1", audioId: "audio-1" }))
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://suno.example.com/track.mp3", "job-1", "audio", "user-1")
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("throws when no tracks returned", async () => {
    mocks.mockSunoAddInstrumental.mockResolvedValueOnce({ taskId: "suno-task-1", tracks: [] })
    const job = makeJob("suno-add-instrumental", { taskId: "suno-task-1", audioId: "audio-1" })
    await expect(handler(job as never, makeCtx())).rejects.toThrow("Suno add-instrumental returned no tracks")
  })
})

describe("suno-add-vocals handler", () => {
  const handler = sunoHandlers["suno-add-vocals"]

  it("happy path: adds vocals, uploads, saves metadata", async () => {
    const job = makeJob("suno-add-vocals", { taskId: "suno-task-1", audioId: "audio-1" })
    await handler(job as never, makeCtx())

    expect(mocks.mockSunoAddVocals).toHaveBeenCalledWith(expect.objectContaining({ taskId: "suno-task-1", audioId: "audio-1" }))
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://suno.example.com/track.mp3", "job-1", "audio", "user-1")
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("throws when no tracks returned", async () => {
    mocks.mockSunoAddVocals.mockResolvedValueOnce({ taskId: "suno-task-1", tracks: [] })
    const job = makeJob("suno-add-vocals", { taskId: "suno-task-1", audioId: "audio-1" })
    await expect(handler(job as never, makeCtx())).rejects.toThrow("Suno add-vocals returned no tracks")
  })
})

describe("suno-convert-wav handler", () => {
  const handler = sunoHandlers["suno-convert-wav"]

  it("happy path: converts to WAV, uploads, saves metadata", async () => {
    const job = makeJob("suno-convert-wav", { taskId: "suno-task-1", audioId: "audio-1" })
    await handler(job as never, makeCtx())

    expect(mocks.mockSunoConvertWav).toHaveBeenCalledWith({ taskId: "suno-task-1", audioId: "audio-1" })
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://suno.example.com/track.wav", "job-1", "audio", "user-1")
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { audioUrl: "https://r2.example.com/audio/job-1.mp3", sunoTaskId: "suno-task-1" },
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })
})

describe("suno-upload-extend handler", () => {
  const handler = sunoHandlers["suno-upload-extend"]

  it("happy path with non-social URL", async () => {
    const job = makeJob("suno-upload-extend", { uploadUrl: "https://example.com/song.mp3", continueAt: 60 })
    await handler(job as never, makeCtx())

    expect(mocks.mockDownloadAudioToR2).not.toHaveBeenCalled()
    expect(mocks.mockSunoUploadExtend).toHaveBeenCalledWith(expect.objectContaining({ uploadUrl: "https://example.com/song.mp3", continueAt: 60 }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("downloads audio first for social URLs", async () => {
    mocks.mockIsSocialUrl.mockReturnValueOnce(true)
    const job = makeJob("suno-upload-extend", { uploadUrl: "https://youtube.com/watch?v=abc", continueAt: 30 })
    await handler(job as never, makeCtx())

    expect(mocks.mockDownloadAudioToR2).toHaveBeenCalledWith("https://youtube.com/watch?v=abc")
    expect(mocks.mockSunoUploadExtend).toHaveBeenCalledWith(expect.objectContaining({ uploadUrl: "https://r2.example.com/downloads/audio.mp3" }))
  })

  it("throws when no tracks returned", async () => {
    mocks.mockSunoUploadExtend.mockResolvedValueOnce({ taskId: "suno-task-1", tracks: [] })
    const job = makeJob("suno-upload-extend", { uploadUrl: "https://example.com/song.mp3", continueAt: 60 })
    await expect(handler(job as never, makeCtx())).rejects.toThrow("Suno upload-extend returned no tracks")
  })
})

describe("shared suno handler behavior", () => {
  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const handler = sunoHandlers["suno-generate"]
    const job = makeJob("suno-generate", { prompt: "cancel" })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})
