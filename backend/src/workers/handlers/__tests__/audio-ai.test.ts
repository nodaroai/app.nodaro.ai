import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockRoutedTextToSpeech = vi.fn()
  const mockGenerateMusic = vi.fn()
  const mockTextToAudio = vi.fn()
  const mockKieAudioProviderInstance = {
    generateSoundEffect: vi.fn(),
    isolateAudio: vi.fn(),
    generateDialogue: vi.fn(),
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
  const mockUploadFileToR2 = vi.fn().mockResolvedValue("https://r2.example.com/video/job-1.mp4")
  const mockExtractAudioTrack = vi.fn().mockResolvedValue({ audioPath: "/tmp/vc/audio.mp3", workDir: "/tmp/vc" })
  const mockDirectVoiceChanger = vi.fn().mockResolvedValue(Buffer.from("revoiced-audio"))
  const mockMergeVideoAudio = vi.fn().mockResolvedValue("/tmp/merged/out.mp4")
  const mockCleanupWorkDir = vi.fn().mockResolvedValue(undefined)
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumb.png")
  const mockCreateAssetFromJob = vi.fn().mockResolvedValue(undefined)
  const mockFsReadFile = vi.fn().mockResolvedValue(Buffer.from("source-audio"))
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  const mockFinalizeJobWithMedia = vi.fn().mockResolvedValue({ ok: true })

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
    mockUploadFileToR2,
    mockExtractAudioTrack,
    mockDirectVoiceChanger,
    mockMergeVideoAudio,
    mockCleanupWorkDir,
    mockGenerateAndUploadThumbnail,
    mockCreateAssetFromJob,
    mockFsReadFile,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockMarkJobCompleted,
    mockFinalizeJobWithMedia,
    mockFrom,
    mockUpdate,
    mockEq,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.mockFrom } }))
vi.mock("@/lib/storage.js", () => ({ uploadToR2: mocks.mockUploadToR2, uploadBufferToR2: mocks.mockUploadBufferToR2, uploadFileToR2: mocks.mockUploadFileToR2 }))
vi.mock("@/providers/index.js", () => ({ textToSpeech: mocks.mockRoutedTextToSpeech }))
vi.mock("@/providers/audio/generate-music.js", () => ({ generateMusic: mocks.mockGenerateMusic }))
vi.mock("@/providers/audio/text-to-audio.js", () => ({ textToAudio: mocks.mockTextToAudio }))
vi.mock("@/providers/elevenlabs/direct-tts.js", () => ({ directElevenLabsTTS: mocks.mockDirectElevenLabsTTS, stripAudioTags: mocks.mockStripAudioTags }))
vi.mock("@/providers/kie/audio.js", () => ({ KieAudioProvider: mocks.mockKieAudioProvider, isKieAcceptedVoice: mocks.mockIsKieAcceptedVoice }))
vi.mock("@/providers/elevenlabs/voice-changer.js", () => ({ voiceChangerFromUrl: mocks.mockVoiceChangerFromUrl, directVoiceChanger: mocks.mockDirectVoiceChanger }))
vi.mock("@/providers/video/extract-audio-track.js", () => ({ extractAudioTrack: mocks.mockExtractAudioTrack }))
vi.mock("@/providers/video/merge-video-audio.js", () => ({ mergeVideoAudio: mocks.mockMergeVideoAudio }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ cleanupWorkDir: mocks.mockCleanupWorkDir }))
vi.mock("node:fs", () => ({ promises: { readFile: mocks.mockFsReadFile } }))
vi.mock("@/providers/elevenlabs/dubbing.js", () => ({ startDubbing: mocks.mockStartDubbing, waitForDubbing: mocks.mockWaitForDubbing, downloadDubbedAudio: mocks.mockDownloadDubbedAudio }))
vi.mock("@/providers/elevenlabs/voice-remix.js", () => ({ remixVoice: mocks.mockRemixVoice }))
vi.mock("@/providers/elevenlabs/voice-design.js", () => ({ designVoice: mocks.mockDesignVoice }))
vi.mock("@/providers/elevenlabs/forced-alignment.js", () => ({ forcedAlignment: mocks.mockForcedAlignment }))
vi.mock("@/providers/audio/transcribe.js", () => ({ transcribe: mocks.mockTranscribe }))
vi.mock("@/providers/audio/youtube-extractor.js", () => ({ extractYouTubeAudio: mocks.mockExtractYouTubeAudio }))
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia }))
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    commitJobCredits: mocks.mockCommitJobCredits,
    shouldSaveJobResult: mocks.mockShouldSaveJobResult,
    markJobCompleted: mocks.mockMarkJobCompleted,
    setJobProgress: vi.fn().mockResolvedValue(undefined),
    startProgressRamp: vi.fn().mockReturnValue({ stop: vi.fn() }),
    withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
    generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
    createAssetFromJob: mocks.mockCreateAssetFromJob,
  }
})

import { audioAIHandlers } from "../audio-ai.js"
// Real classifier — this is the EXACT predicate refundJobCredits uses to decide
// skip-vs-refund. Asserting on it proves the refund decision without re-mocking
// the credit pipeline.
import { isPostProcessingError } from "../../../lib/post-processing-error.js"

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
  mocks.mockKieAudioProviderInstance.generateDialogue.mockResolvedValue({ url: "https://kie.example.com/dialogue.mp3", cost: 0.01 })
  mocks.mockTranscribe.mockResolvedValue({ text: "Hello world", language: "en", segments: [] })
  mocks.mockExtractYouTubeAudio.mockResolvedValue("https://example.com/yt-audio.mp3")
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
  // Defaults for voice-changer video-mode deps (overridden per-test).
  mocks.mockUploadToR2.mockResolvedValue("https://r2.example.com/audio/job-1.mp3")
  mocks.mockUploadBufferToR2.mockResolvedValue("https://r2.example.com/audio/job-1.mp3")
  mocks.mockUploadFileToR2.mockResolvedValue("https://r2.example.com/video/job-1.mp4")
  mocks.mockExtractAudioTrack.mockResolvedValue({ audioPath: "/tmp/vc/audio.mp3", workDir: "/tmp/vc" })
  mocks.mockDirectVoiceChanger.mockResolvedValue(Buffer.from("revoiced-audio"))
  mocks.mockMergeVideoAudio.mockResolvedValue("/tmp/merged/out.mp4")
  mocks.mockFsReadFile.mockResolvedValue(Buffer.from("source-audio"))
})

describe("text-to-speech handler", () => {
  const handler = audioAIHandlers["text-to-speech"]

  it("happy path: generates speech, uploads, saves, commits", async () => {
    const job = makeJob("text-to-speech", { text: "Hello world" })
    await handler(job as never, makeCtx())

    expect(mocks.mockRoutedTextToSpeech).toHaveBeenCalledWith(
      "Hello world", "elevenlabs-turbo", undefined, undefined,
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://provider.example.com/tts.mp3", "job-1", "audio", "user-1")
    // progress flows through setJobProgress (mocked) — no direct assertion
    // progress flows through setJobProgress (mocked) — no direct assertion
    // markJobCompleted assertion removed — now inside finalizeJobWithMedia (mocked)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalled()
  })

  it("uses custom voice and options", async () => {
    const job = makeJob("text-to-speech", { text: "Hi", voice: "Daniel", stability: 0.5, speed: 1.2, languageCode: "en-US" })
    await handler(job as never, makeCtx())

    expect(mocks.mockRoutedTextToSpeech).toHaveBeenCalledWith(
      "Hi", "elevenlabs-turbo", "Daniel",
      expect.objectContaining({ stability: 0.5, speed: 1.2, languageCode: "en-US" }),
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
  })

  it("returns early when finalize signals not-ok (cancelled)", async () => {
    mocks.mockFinalizeJobWithMedia.mockResolvedValueOnce({ ok: false })
    const job = makeJob("text-to-speech", { text: "cancel" })
    await handler(job as never, makeCtx())
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalled()
  })

  // Reconciliation wiring (Task 1.11): when the router fires onTaskCreated
  // with a taskId, the persistence layer writes provider_kind +
  // provider_task_id + provider_call_started_at on the job row. KIE TTS
  // (elevenlabs-turbo) routes through KIE standard so the kind is
  // "kie-standard".
  it("persists provider_kind + provider_task_id on the job row via makeOnTaskCreated", async () => {
    mocks.mockRoutedTextToSpeech.mockImplementationOnce(
      async (
        _text: unknown,
        _model: unknown,
        _voice: unknown,
        _options: unknown,
        reconcileOpts?: { onTaskCreated?: (taskId: string) => Promise<void> },
      ) => {
        if (reconcileOpts?.onTaskCreated) {
          await reconcileOpts.onTaskCreated("t-test")
        }
        return { url: "https://provider.example.com/tts.mp3", providerUsed: "elevenlabs-turbo", cost: 0.01, displayCost: 0.0125 }
      },
    )
    const job = makeJob("text-to-speech", { text: "reconcile-me" })

    await handler(job as never, makeCtx())

    expect(mocks.mockFrom).toHaveBeenCalledWith("jobs")
    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_kind: "kie-standard",
        provider_task_id: "t-test",
        provider_call_started_at: expect.any(String),
      }),
    )
    expect(mocks.mockEq).toHaveBeenCalledWith("id", "job-1")
  })
})

describe("generate-music handler", () => {
  const handler = audioAIHandlers["generate-music"]

  it("happy path: generates music, uploads, saves, commits", async () => {
    const job = makeJob("generate-music", { prompt: "epic orchestral" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateMusic).toHaveBeenCalledWith("epic orchestral", undefined, undefined, undefined, undefined, undefined)
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://replicate.example.com/music.mp3", "job-1", "audio", "user-1")
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalled()
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
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalled()
  })

  it("uses KieAudioProvider for elevenlabs-sfx", async () => {
    const job = makeJob("text-to-audio", { prompt: "explosion", provider: "elevenlabs-sfx", duration: 5, loop: true, promptInfluence: 0.8 })
    await handler(job as never, makeCtx())

    expect(mocks.mockKieAudioProviderInstance.generateSoundEffect).toHaveBeenCalledWith(
      "explosion",
      { duration: 5, loop: true, promptInfluence: 0.8 },
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockTextToAudio).not.toHaveBeenCalled()
  })

  it("returns early when finalize signals not-ok (cancelled)", async () => {
    mocks.mockFinalizeJobWithMedia.mockResolvedValueOnce({ ok: false })
    const job = makeJob("text-to-audio", { prompt: "cancel" })
    await handler(job as never, makeCtx())
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalled()
  })
})

describe("transcribe handler", () => {
  const handler = audioAIHandlers["transcribe"]

  it("happy path: transcribes audio", async () => {
    const job = makeJob("transcribe", { audioUrl: "https://example.com/audio.mp3" })
    await handler(job as never, makeCtx())

    expect(mocks.mockTranscribe).toHaveBeenCalledWith("https://example.com/audio.mp3", undefined, undefined, { diarize: undefined, tagAudioEvents: undefined, onTaskCreated: expect.any(Function) })
    // transcribe outputs text/segments — keeps direct markJobCompleted (not via finalize)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { text: "Hello world", language: "en", segments: [] },
    }))
  })

  it("passes language parameter", async () => {
    const job = makeJob("transcribe", { audioUrl: "https://example.com/audio.mp3", language: "fr" })
    await handler(job as never, makeCtx())
    expect(mocks.mockTranscribe).toHaveBeenCalledWith("https://example.com/audio.mp3", undefined, "fr", { diarize: undefined, tagAudioEvents: undefined, onTaskCreated: expect.any(Function) })
  })
})

describe("extract-youtube-audio handler", () => {
  const handler = audioAIHandlers["extract-youtube-audio"]

  it("happy path: extracts audio from YouTube URL", async () => {
    const job = makeJob("extract-youtube-audio", { youtubeUrl: "https://youtube.com/watch?v=abc" })
    await handler(job as never, makeCtx())

    expect(mocks.mockExtractYouTubeAudio).toHaveBeenCalledWith("https://youtube.com/watch?v=abc")
    // extract-youtube-audio outputs raw audioUrl — keeps direct markJobCompleted (not via finalize)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { audioUrl: "https://example.com/yt-audio.mp3" },
    }))
  })
})

describe("audio-isolation handler", () => {
  const handler = audioAIHandlers["audio-isolation"]

  it("happy path: isolates audio, uploads, saves, commits", async () => {
    const job = makeJob("audio-isolation", { audioUrl: "https://example.com/song.mp3" })
    await handler(job as never, makeCtx())

    expect(mocks.mockKieAudioProviderInstance.isolateAudio).toHaveBeenCalledWith(
      "https://example.com/song.mp3",
      expect.objectContaining({ onTaskCreated: expect.any(Function) }),
    )
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://kie.example.com/isolated.mp3", "job-1", "audio", "user-1")
    // progress flows through setJobProgress (mocked) — no direct assertion
    // progress flows through setJobProgress (mocked) — no direct assertion
    // markJobCompleted assertion removed — now inside finalizeJobWithMedia (mocked)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalled()
  })

  it("returns early when finalize signals not-ok (cancelled)", async () => {
    mocks.mockFinalizeJobWithMedia.mockResolvedValueOnce({ ok: false })
    const job = makeJob("audio-isolation", { audioUrl: "https://example.com/song.mp3" })
    await handler(job as never, makeCtx())
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalled()
  })
})

describe("voice-design handler", () => {
  const handler = audioAIHandlers["voice-design"]

  it("marks provider_call_started_at with elevenlabs-sync before upstream call (Phase 5.1)", async () => {
    mocks.mockDesignVoice.mockResolvedValueOnce({ audioBuffer: Buffer.from("fake"), generatedVoiceId: "v-1" })
    const job = makeJob("voice-design", { text: "hello", voiceDescription: "warm narrator" })
    await handler(job as never, makeCtx())

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_kind: "elevenlabs-sync",
        provider_call_started_at: expect.any(String),
      }),
    )
    expect(mocks.mockEq).toHaveBeenCalledWith("id", "job-1")
  })
})

describe("forced-alignment handler", () => {
  const handler = audioAIHandlers["forced-alignment"]

  it("marks provider_call_started_at with elevenlabs-sync before upstream call (Phase 5.1)", async () => {
    mocks.mockForcedAlignment.mockResolvedValueOnce({ alignment: [{ text: "hi", start: 0, end: 1 }] })
    const job = makeJob("forced-alignment", { audioUrl: "https://example.com/audio.mp3", transcript: "hi" })
    await handler(job as never, makeCtx())

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_kind: "elevenlabs-sync",
        provider_call_started_at: expect.any(String),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Refund-correctness: POST-provider upload failures must tag a
// PostProcessingError so the worker never refunds work the provider billed:
// recoverable rows are left `processing` for reconcile (self-heal branch),
// the rest skip the refund. PRE-provider (input-side) failures must stay
// plain so the worker REFUNDS. `isPostProcessingError` is the exact
// predicate both the self-heal branch and refundJobCredits use.
// ---------------------------------------------------------------------------

/** Run `fn`, return the thrown error (fails the test if nothing throws). */
async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (err) {
    return err
  }
  throw new Error("expected handler to throw, but it resolved")
}

describe("revenue-leak: post-provider upload failure → PostProcessingError (refund SKIPPED)", () => {
  // Each case: provider succeeds (we are billed), then the result upload throws
  // a RAW (non-PostProcessing) error. The handler must re-tag it so the refund
  // guard skips. Without the runPostProcessing wrap, the raw error propagates
  // unchanged and the user is wrongly refunded → revenue leak.
  const rawUploadError = () => new Error("R2 PutObject failed: connection reset")

  it("text-to-speech (direct ElevenLabs branch, uploadBufferToR2)", async () => {
    // useDirectApi branch: provider already returned the audio buffer.
    mocks.mockIsKieAcceptedVoice.mockReturnValueOnce(false)
    mocks.mockUploadBufferToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("text-to-speech", { text: "hi", voice: "custom-uuid", voiceType: "custom" })
    const err = await captureThrow(() => audioAIHandlers["text-to-speech"](job as never, makeCtx()))
    expect(mocks.mockDirectElevenLabsTTS).toHaveBeenCalled() // provider was billed
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("text-to-speech (routed/KIE branch, uploadToR2)", async () => {
    mocks.mockUploadToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("text-to-speech", { text: "hi" })
    const err = await captureThrow(() => audioAIHandlers["text-to-speech"](job as never, makeCtx()))
    expect(mocks.mockRoutedTextToSpeech).toHaveBeenCalled()
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("generate-music (uploadToR2)", async () => {
    mocks.mockUploadToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("generate-music", { prompt: "epic" })
    const err = await captureThrow(() => audioAIHandlers["generate-music"](job as never, makeCtx()))
    expect(mocks.mockGenerateMusic).toHaveBeenCalled()
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("text-to-audio (uploadToR2)", async () => {
    mocks.mockUploadToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("text-to-audio", { prompt: "rain" })
    const err = await captureThrow(() => audioAIHandlers["text-to-audio"](job as never, makeCtx()))
    expect(mocks.mockTextToAudio).toHaveBeenCalled()
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("audio-isolation (uploadToR2)", async () => {
    mocks.mockUploadToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("audio-isolation", { audioUrl: "https://example.com/song.mp3" })
    const err = await captureThrow(() => audioAIHandlers["audio-isolation"](job as never, makeCtx()))
    expect(mocks.mockKieAudioProviderInstance.isolateAudio).toHaveBeenCalled()
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("text-to-dialogue (uploadToR2)", async () => {
    mocks.mockUploadToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("text-to-dialogue", { dialogue: [{ text: "hi", voice: "Rachel" }] })
    const err = await captureThrow(() => audioAIHandlers["text-to-dialogue"](job as never, makeCtx()))
    expect(mocks.mockKieAudioProviderInstance.generateDialogue).toHaveBeenCalled()
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("dubbing (uploadBufferToR2)", async () => {
    mocks.mockUploadBufferToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("dubbing", { audioUrl: "https://example.com/in.mp3", targetLanguage: "es" })
    const err = await captureThrow(() => audioAIHandlers["dubbing"](job as never, makeCtx()))
    expect(mocks.mockDownloadDubbedAudio).toHaveBeenCalled() // provider delivered
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("voice-remix (uploadBufferToR2)", async () => {
    mocks.mockRemixVoice.mockResolvedValueOnce(Buffer.from("remixed"))
    mocks.mockUploadBufferToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("voice-remix", { text: "hi", voiceDescription: "warm" })
    const err = await captureThrow(() => audioAIHandlers["voice-remix"](job as never, makeCtx()))
    expect(mocks.mockRemixVoice).toHaveBeenCalled()
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("voice-design (uploadBufferToR2)", async () => {
    mocks.mockDesignVoice.mockResolvedValueOnce({ audioBuffer: Buffer.from("fake"), generatedVoiceId: "v-1" })
    mocks.mockUploadBufferToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("voice-design", { text: "hi", voiceDescription: "warm" })
    const err = await captureThrow(() => audioAIHandlers["voice-design"](job as never, makeCtx()))
    expect(mocks.mockDesignVoice).toHaveBeenCalled()
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("voice-changer audio mode (uploadBufferToR2)", async () => {
    mocks.mockVoiceChangerFromUrl.mockResolvedValueOnce(Buffer.from("revoiced"))
    mocks.mockUploadBufferToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("voice-changer", { audioUrl: "https://example.com/in.mp3", voiceId: "v-1" })
    const err = await captureThrow(() => audioAIHandlers["voice-changer"](job as never, makeCtx()))
    expect(mocks.mockVoiceChangerFromUrl).toHaveBeenCalled() // provider delivered
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("voice-changer video mode: revoiced-audio upload (uploadBufferToR2) is post-provider", async () => {
    // extractAudioTrack (input) + directVoiceChanger (provider) succeed; the
    // upload of the PROVIDER OUTPUT throws → must be tagged.
    mocks.mockUploadBufferToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("voice-changer", { videoUrl: "https://example.com/in.mp4", voiceId: "v-1" })
    const err = await captureThrow(() => audioAIHandlers["voice-changer"](job as never, makeCtx()))
    expect(mocks.mockDirectVoiceChanger).toHaveBeenCalled() // provider delivered
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("voice-changer video mode: merged-video upload (uploadFileToR2) is post-provider", async () => {
    // Everything through merge succeeds; the final merged-file upload throws.
    mocks.mockUploadFileToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("voice-changer", { videoUrl: "https://example.com/in.mp4", voiceId: "v-1" })
    const err = await captureThrow(() => audioAIHandlers["voice-changer"](job as never, makeCtx()))
    expect(mocks.mockMergeVideoAudio).toHaveBeenCalled()
    expect(isPostProcessingError(err)).toBe(true)
  })
})

describe("safe-direction: PRE-provider (input-side) failure → plain error (refund HAPPENS)", () => {
  it("voice-changer video mode: extractAudioTrack (input download) failure is NOT tagged", async () => {
    // extractAudioTrack downloads + demuxes the user's INPUT video BEFORE the
    // provider call. A failure here means the provider was NEVER billed — the
    // user is owed a refund, so the error MUST stay un-tagged.
    mocks.mockExtractAudioTrack.mockRejectedValueOnce(new Error("Failed to download: https://example.com/in.mp4"))
    const job = makeJob("voice-changer", { videoUrl: "https://example.com/in.mp4", voiceId: "v-1" })
    const err = await captureThrow(() => audioAIHandlers["voice-changer"](job as never, makeCtx()))
    expect(mocks.mockDirectVoiceChanger).not.toHaveBeenCalled() // provider never reached
    expect(isPostProcessingError(err)).toBe(false) // → refund HAPPENS
  })

  it("voice-changer video mode: reading the extracted INPUT audio failure is NOT tagged", async () => {
    // fs.readFile reads the demuxed INPUT audio, still before the provider call.
    mocks.mockFsReadFile.mockRejectedValueOnce(new Error("EACCES: permission denied"))
    const job = makeJob("voice-changer", { videoUrl: "https://example.com/in.mp4", voiceId: "v-1" })
    const err = await captureThrow(() => audioAIHandlers["voice-changer"](job as never, makeCtx()))
    expect(mocks.mockDirectVoiceChanger).not.toHaveBeenCalled()
    expect(isPostProcessingError(err)).toBe(false)
  })

  it("transcribe: social-video input audio extraction failure is NOT tagged", async () => {
    // extractYouTubeAudio here is PRE-provider input prep (the STT provider
    // can't consume a youtube page URL). Failure → provider never billed → refund.
    mocks.mockExtractYouTubeAudio.mockRejectedValueOnce(new Error("yt-dlp failed"))
    const job = makeJob("transcribe", { audioUrl: "https://youtube.com/watch?v=abc" })
    const err = await captureThrow(() => audioAIHandlers["transcribe"](job as never, makeCtx()))
    expect(mocks.mockTranscribe).not.toHaveBeenCalled() // provider never reached
    expect(isPostProcessingError(err)).toBe(false)
  })
})
