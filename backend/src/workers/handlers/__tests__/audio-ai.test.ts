import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockRoutedTextToSpeech = vi.fn()
  const mockGenerateMusic = vi.fn()
  const mockTextToAudio = vi.fn()
  const mockKieAudioProviderInstance = {
    generateSoundEffect: vi.fn(),
    isolateAudio: vi.fn(),
  }
  const mockKieAudioProvider = vi.fn().mockImplementation(function () { return mockKieAudioProviderInstance })
  const mockTranscribe = vi.fn()
  const mockExtractYouTubeAudio = vi.fn()
  const mockUploadToR2 = vi.fn().mockResolvedValue("https://r2.example.com/audio/job-1.mp3")
  const mockUploadBufferToR2 = vi.fn().mockResolvedValue("https://r2.example.com/audio/job-1.mp3")
  const mockDirectElevenLabsTTS = vi.fn().mockResolvedValue(Buffer.from("fake-audio"))
  const mockStripAudioTags = vi.fn((text: string) => text)
  const mockIsKieAcceptedVoice = vi.fn().mockReturnValue(true)
  const mockVoiceChangerFromUrl = vi.fn().mockResolvedValue(Buffer.from("fake-audio"))
  const mockStartDubbing = vi.fn().mockResolvedValue("dub-id")
  const mockWaitForDubbing = vi.fn().mockResolvedValue(undefined)
  const mockDownloadDubbedAudio = vi.fn().mockResolvedValue(Buffer.from("fake-audio"))
  const mockRemixVoice = vi.fn().mockResolvedValue({ audioUrl: "https://example.com/remix.mp3" })
  const mockDesignVoice = vi.fn().mockResolvedValue({ audioUrl: "https://example.com/design.mp3", generatedVoiceId: "voice-123" })
  const mockForcedAlignment = vi.fn().mockResolvedValue({ words: [] })
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)

  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockRoutedTextToSpeech,
    mockGenerateMusic,
    mockTextToAudio,
    mockKieAudioProvider,
    mockKieAudioProviderInstance,
    mockTranscribe,
    mockExtractYouTubeAudio,
    mockUploadToR2,
    mockUploadBufferToR2,
    mockDirectElevenLabsTTS,
    mockStripAudioTags,
    mockIsKieAcceptedVoice,
    mockVoiceChangerFromUrl,
    mockStartDubbing,
    mockWaitForDubbing,
    mockDownloadDubbedAudio,
    mockRemixVoice,
    mockDesignVoice,
    mockForcedAlignment,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockMarkJobCompleted,
    mockFrom,
    mockUpdate,
    mockEq,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.mockFrom } }))
vi.mock("@/lib/storage.js", () => ({ uploadToR2: mocks.mockUploadToR2, uploadBufferToR2: mocks.mockUploadBufferToR2 }))
vi.mock("@/providers/index.js", () => ({ textToSpeech: mocks.mockRoutedTextToSpeech }))
vi.mock("@/providers/audio/generate-music.js", () => ({ generateMusic: mocks.mockGenerateMusic }))
vi.mock("@/providers/audio/text-to-audio.js", () => ({ textToAudio: mocks.mockTextToAudio }))
vi.mock("@/providers/elevenlabs/direct-tts.js", () => ({ directElevenLabsTTS: mocks.mockDirectElevenLabsTTS, stripAudioTags: mocks.mockStripAudioTags }))
vi.mock("@/providers/kie/audio.js", () => ({ KieAudioProvider: mocks.mockKieAudioProvider, isKieAcceptedVoice: mocks.mockIsKieAcceptedVoice }))
vi.mock("@/providers/elevenlabs/voice-changer.js", () => ({ voiceChangerFromUrl: mocks.mockVoiceChangerFromUrl }))
vi.mock("@/providers/elevenlabs/dubbing.js", () => ({ startDubbing: mocks.mockStartDubbing, waitForDubbing: mocks.mockWaitForDubbing, downloadDubbedAudio: mocks.mockDownloadDubbedAudio }))
vi.mock("@/providers/elevenlabs/voice-remix.js", () => ({ remixVoice: mocks.mockRemixVoice }))
vi.mock("@/providers/elevenlabs/voice-design.js", () => ({ designVoice: mocks.mockDesignVoice }))
vi.mock("@/providers/elevenlabs/forced-alignment.js", () => ({ forcedAlignment: mocks.mockForcedAlignment }))
vi.mock("@/providers/audio/transcribe.js", () => ({ transcribe: mocks.mockTranscribe }))
vi.mock("@/providers/audio/youtube-extractor.js", () => ({ extractYouTubeAudio: mocks.mockExtractYouTubeAudio }))
vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  markJobCompleted: mocks.mockMarkJobCompleted,
}))

import { audioAIHandlers } from "../audio-ai.js"

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return { name, data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockRoutedTextToSpeech.mockResolvedValue({ url: "https://provider.example.com/tts.mp3", providerUsed: "elevenlabs-turbo", cost: 0.01, displayCost: 0.0125 })
  mocks.mockGenerateMusic.mockResolvedValue("https://replicate.example.com/music.mp3")
  mocks.mockTextToAudio.mockResolvedValue("https://replicate.example.com/audio.mp3")
  mocks.mockKieAudioProviderInstance.generateSoundEffect.mockResolvedValue({ url: "https://kie.example.com/sfx.mp3", cost: 0.01 })
  mocks.mockKieAudioProviderInstance.isolateAudio.mockResolvedValue({ url: "https://kie.example.com/isolated.mp3", cost: 0.01 })
  mocks.mockTranscribe.mockResolvedValue({ text: "Hello world", language: "en", segments: [] })
  mocks.mockExtractYouTubeAudio.mockResolvedValue("https://example.com/yt-audio.mp3")
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
})

describe("text-to-speech handler", () => {
  const handler = audioAIHandlers["text-to-speech"]

  it("happy path: generates speech, uploads, saves, commits", async () => {
    const job = makeJob("text-to-speech", { text: "Hello world" })
    await handler(job as never, makeCtx())

    expect(mocks.mockRoutedTextToSpeech).toHaveBeenCalledWith("Hello world", "elevenlabs-turbo", undefined, undefined)
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://provider.example.com/tts.mp3", "job-1", "audio", "user-1")
    expect(job.updateProgress).toHaveBeenCalledWith(50)
    expect(job.updateProgress).toHaveBeenCalledWith(100)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { audioUrl: "https://r2.example.com/audio/job-1.mp3" },
      provider: "elevenlabs-turbo",
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", 0.01)
  })

  it("uses custom voice and options", async () => {
    const job = makeJob("text-to-speech", { text: "Hi", voice: "Daniel", stability: 0.5, speed: 1.2, languageCode: "en-US" })
    await handler(job as never, makeCtx())

    expect(mocks.mockRoutedTextToSpeech).toHaveBeenCalledWith(
      "Hi", "elevenlabs-turbo", "Daniel",
      expect.objectContaining({ stability: 0.5, speed: 1.2, languageCode: "en-US" }),
    )
  })

  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("text-to-speech", { text: "cancel" })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})

describe("generate-music handler", () => {
  const handler = audioAIHandlers["generate-music"]

  it("happy path: generates music, uploads, saves, commits", async () => {
    const job = makeJob("generate-music", { prompt: "epic orchestral" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateMusic).toHaveBeenCalledWith("epic orchestral", undefined, undefined, undefined, undefined, undefined)
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://replicate.example.com/music.mp3", "job-1", "audio", "user-1")
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("passes custom duration and lyrics", async () => {
    const job = makeJob("generate-music", { prompt: "rock", duration: 30, lyrics: "yeah!" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateMusic).toHaveBeenCalledWith("rock", undefined, 30, undefined, "yeah!", undefined)
  })
})

describe("text-to-audio handler", () => {
  const handler = audioAIHandlers["text-to-audio"]

  it("happy path with default provider", async () => {
    const job = makeJob("text-to-audio", { prompt: "rain sounds" })
    await handler(job as never, makeCtx())

    expect(mocks.mockTextToAudio).toHaveBeenCalledWith("rain sounds", undefined, undefined)
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("uses KieAudioProvider for elevenlabs-sfx", async () => {
    const job = makeJob("text-to-audio", { prompt: "explosion", provider: "elevenlabs-sfx", duration: 5, loop: true, promptInfluence: 0.8 })
    await handler(job as never, makeCtx())

    expect(mocks.mockKieAudioProviderInstance.generateSoundEffect).toHaveBeenCalledWith("explosion", {
      duration: 5, loop: true, promptInfluence: 0.8,
    })
    expect(mocks.mockTextToAudio).not.toHaveBeenCalled()
  })

  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("text-to-audio", { prompt: "cancel" })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
  })
})

describe("transcribe handler", () => {
  const handler = audioAIHandlers["transcribe"]

  it("happy path: transcribes audio", async () => {
    const job = makeJob("transcribe", { audioUrl: "https://example.com/audio.mp3" })
    await handler(job as never, makeCtx())

    expect(mocks.mockTranscribe).toHaveBeenCalledWith("https://example.com/audio.mp3", undefined, undefined, { diarize: undefined, tagAudioEvents: undefined })
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { text: "Hello world", language: "en", segments: [] },
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", undefined)
  })

  it("passes language parameter", async () => {
    const job = makeJob("transcribe", { audioUrl: "https://example.com/audio.mp3", language: "fr" })
    await handler(job as never, makeCtx())
    expect(mocks.mockTranscribe).toHaveBeenCalledWith("https://example.com/audio.mp3", undefined, "fr", { diarize: undefined, tagAudioEvents: undefined })
  })
})

describe("extract-youtube-audio handler", () => {
  const handler = audioAIHandlers["extract-youtube-audio"]

  it("happy path: extracts audio from YouTube URL", async () => {
    const job = makeJob("extract-youtube-audio", { youtubeUrl: "https://youtube.com/watch?v=abc" })
    await handler(job as never, makeCtx())

    expect(mocks.mockExtractYouTubeAudio).toHaveBeenCalledWith("https://youtube.com/watch?v=abc")
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { audioUrl: "https://example.com/yt-audio.mp3" },
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })
})

describe("audio-isolation handler", () => {
  const handler = audioAIHandlers["audio-isolation"]

  it("happy path: isolates audio, uploads, saves, commits", async () => {
    const job = makeJob("audio-isolation", { audioUrl: "https://example.com/song.mp3" })
    await handler(job as never, makeCtx())

    expect(mocks.mockKieAudioProviderInstance.isolateAudio).toHaveBeenCalledWith("https://example.com/song.mp3")
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://kie.example.com/isolated.mp3", "job-1", "audio", "user-1")
    expect(job.updateProgress).toHaveBeenCalledWith(50)
    expect(job.updateProgress).toHaveBeenCalledWith(100)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { audioUrl: "https://r2.example.com/audio/job-1.mp3" },
      provider_cost: 0.01,
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", 0.01)
  })

  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("audio-isolation", { audioUrl: "https://example.com/song.mp3" })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
  })
})
