import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => {
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
  const mockDirectElevenLabsDialogue = vi.fn().mockResolvedValue(Buffer.from("fake-dialogue"))
  const mockStripAudioTags = vi.fn((text: string) => text)
  const mockVoiceChangerFromUrl = vi.fn().mockResolvedValue(Buffer.from("fake-audio"))
  const mockStartDubbing = vi.fn().mockResolvedValue({ dubbingId: "dub-id", expectedDurationSec: 30 })
  const mockWaitForDubbing = vi.fn().mockResolvedValue({ dubbing_id: "dub-id", status: "dubbed" })
  const mockPollDubbingStatus = vi.fn().mockResolvedValue({ dubbing_id: "dub-id", status: "dubbing", media_metadata: { content_type: "audio/mpeg", duration: 30 } })
  const mockDownloadDubbedMedia = vi.fn().mockResolvedValue(Buffer.from("fake-audio"))
  const mockRemixVoice = vi.fn().mockResolvedValue({ audioUrl: "https://example.com/remix.mp3" })
  const mockDesignVoice = vi.fn().mockResolvedValue({ audioUrl: "https://example.com/design.mp3", generatedVoiceId: "voice-123" })
  const mockForcedAlignment = vi.fn().mockResolvedValue({ words: [] })
  const mockUploadFileToR2 = vi.fn().mockResolvedValue("https://r2.example.com/video/job-1.mp4")
  const mockExtractAudioTrack = vi.fn().mockResolvedValue({ audioPath: "/tmp/vc/audio.mp3", workDir: "/tmp/vc" })
  const mockDirectVoiceChanger = vi.fn().mockResolvedValue(Buffer.from("revoiced-audio"))
  const mockMergeVideoAudio = vi.fn().mockResolvedValue("/tmp/merged/out.mp4")
  const mockCleanupWorkDir = vi.fn().mockResolvedValue(undefined)
  // "What streams does this media ACTUALLY carry" — the voice-changer decides
  // audio-vs-video mode from this, never from the input slot.
  const mockProbeMediaStreams = vi.fn().mockResolvedValue({ hasVideo: true, hasAudio: true })
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumb.png")
  const mockWatermarkLocalVideoAndUpload = vi.fn().mockResolvedValue("https://r2.example.com/video/job-1.mp4")
  const mockCreateAssetFromJob = vi.fn().mockResolvedValue(undefined)
  const mockFsReadFile = vi.fn().mockResolvedValue(Buffer.from("source-audio"))
  const mockIsNodaroConnected = vi.fn().mockResolvedValue(false)
  // Transcribe ladder (#761): default OFF so every existing local-path test
  // behaves exactly as before; the ladder describe flips it per-test.
  const mockShouldRunOnCloud = vi.fn().mockResolvedValue(false)
  const mockRunJobOnCloud = vi.fn()
  const mockCloudTextToSpeech = vi.fn().mockResolvedValue({ url: "https://cloud.nodaro.ai/a.mp3", cost: null })
  const mockNodaroCloudAudioProvider = vi.fn().mockImplementation(function () {
    return { textToSpeech: mockCloudTextToSpeech }
  })
  const mockCreateCloudJob = vi.fn().mockResolvedValue("cloud-job-1")
  const mockWaitForCloudJob = vi.fn().mockResolvedValue({ output_data: { audioUrl: "https://cloud.nodaro.ai/dlg.mp3" } })
  const mockSafeFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(Buffer.from("cloud-audio")).buffer,
  })
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  const mockFinalizeJobWithMedia = vi.fn().mockResolvedValue({ ok: true })

  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockGenerateMusic,
    mockTextToAudio,
    mockKieAudioProvider,
    mockKieAudioProviderInstance,
    mockTranscribe,
    mockExtractYouTubeAudio,
    mockUploadToR2,
    mockUploadBufferToR2,
    mockDirectElevenLabsTTS,
    mockDirectElevenLabsDialogue,
    mockStripAudioTags,
    mockVoiceChangerFromUrl,
    mockStartDubbing,
    mockWaitForDubbing,
    mockPollDubbingStatus,
    mockDownloadDubbedMedia,
    mockRemixVoice,
    mockDesignVoice,
    mockForcedAlignment,
    mockUploadFileToR2,
    mockExtractAudioTrack,
    mockDirectVoiceChanger,
    mockMergeVideoAudio,
    mockCleanupWorkDir,
    mockProbeMediaStreams,
    mockGenerateAndUploadThumbnail,
    mockWatermarkLocalVideoAndUpload,
    mockCreateAssetFromJob,
    mockFsReadFile,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockMarkJobCompleted,
    mockFinalizeJobWithMedia,
    mockFrom,
    mockUpdate,
    mockEq,
    mockIsNodaroConnected,
    mockShouldRunOnCloud, mockRunJobOnCloud,
    mockCloudTextToSpeech,
    mockNodaroCloudAudioProvider,
    mockCreateCloudJob,
    mockWaitForCloudJob,
    mockSafeFetch,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.mockFrom } }))
vi.mock("@/lib/storage.js", () => ({ uploadToR2: mocks.mockUploadToR2, uploadBufferToR2: mocks.mockUploadBufferToR2, uploadFileToR2: mocks.mockUploadFileToR2, mediaObjectKey: (id: string, type: string, ext: string) => `${type}s/${id}.${ext}` }))
vi.mock("@/providers/audio/generate-music.js", () => ({ generateMusic: mocks.mockGenerateMusic }))
vi.mock("@/providers/audio/text-to-audio.js", () => ({ textToAudio: mocks.mockTextToAudio }))
vi.mock("@/providers/elevenlabs/direct-tts.js", () => ({ directElevenLabsTTS: mocks.mockDirectElevenLabsTTS, stripAudioTags: mocks.mockStripAudioTags }))
vi.mock("@/providers/elevenlabs/direct-dialogue.js", () => ({ directElevenLabsDialogue: mocks.mockDirectElevenLabsDialogue }))
vi.mock("@/providers/kie/audio.js", () => ({ KieAudioProvider: mocks.mockKieAudioProvider }))
vi.mock("@/providers/elevenlabs/voice-changer.js", () => ({ voiceChangerFromUrl: mocks.mockVoiceChangerFromUrl, directVoiceChanger: mocks.mockDirectVoiceChanger }))
vi.mock("@/providers/video/extract-audio-track.js", () => ({ extractAudioTrack: mocks.mockExtractAudioTrack }))
vi.mock("@/providers/video/merge-video-audio.js", () => ({ mergeVideoAudio: mocks.mockMergeVideoAudio }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ cleanupWorkDir: mocks.mockCleanupWorkDir, probeMediaStreams: mocks.mockProbeMediaStreams, createWorkDir: vi.fn().mockResolvedValue("/tmp/dub-wd") }))
vi.mock("node:fs", () => ({ promises: { readFile: mocks.mockFsReadFile, writeFile: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/providers/elevenlabs/dubbing.js", () => ({
  startDubbing: mocks.mockStartDubbing,
  waitForDubbing: mocks.mockWaitForDubbing,
  pollDubbingStatus: mocks.mockPollDubbingStatus,
  downloadDubbedMedia: mocks.mockDownloadDubbedMedia,
  DUBBING_MAX_DURATION_SEC: 30 * 60,
}))
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
    watermarkLocalVideoAndUpload: mocks.mockWatermarkLocalVideoAndUpload,
  }
})

vi.mock("../../../lib/nodaro-connect.js", () => ({
  isNodaroConnected: mocks.mockIsNodaroConnected,
}))
vi.mock("../../../providers/nodaro/audio.js", () => ({
  NodaroCloudAudioProvider: mocks.mockNodaroCloudAudioProvider,
}))
vi.mock("../../../providers/nodaro/run-on-cloud.js", () => ({
  shouldRunOnCloud: mocks.mockShouldRunOnCloud,
  runJobOnCloud: mocks.mockRunJobOnCloud,
}))
vi.mock("../../../providers/nodaro/client.js", () => ({
  createCloudJob: mocks.mockCreateCloudJob,
  waitForCloudJob: mocks.mockWaitForCloudJob,
  NodaroCloudError: class NodaroCloudError extends Error {},
}))
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.mockSafeFetch }))

import { audioAIHandlers } from "../audio-ai.js"
// The REAL config object (not a module mock — the handler's siblings read other
// fields off it). TTS branches on ELEVENLABS_API_KEY, and `config.ts` does
// `import "dotenv/config"`, so without pinning it here the branch taken depends
// on whether the machine happens to have a `backend/.env`. That is exactly how
// these tests passed locally and failed in CI: a developer .env sent every run
// down the direct-ElevenLabs path, so the cloud branch was never executed
// anywhere until CI ran it with no key at all.
import { config } from "../../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
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
  mocks.mockGenerateMusic.mockResolvedValue("https://replicate.example.com/music.mp3")
  mocks.mockTextToAudio.mockResolvedValue("https://replicate.example.com/audio.mp3")
  mocks.mockKieAudioProviderInstance.generateSoundEffect.mockResolvedValue({ url: "https://kie.example.com/sfx.mp3", cost: 0.01 })
  mocks.mockKieAudioProviderInstance.isolateAudio.mockResolvedValue({ url: "https://kie.example.com/isolated.mp3", cost: 0.01 })
  mocks.mockDirectElevenLabsDialogue.mockResolvedValue(Buffer.from("fake-dialogue"))
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
  // Realistic default: the media matches its extension (video files carry
  // video, .mp3 does not). Per-test overrides are how the lying-container
  // cases are exercised.
  mocks.mockProbeMediaStreams.mockImplementation(async (url: string) => ({
    hasVideo: /\.(mp4|webm|mov)(\?|$)/i.test(url),
    hasAudio: true,
  }))
  mocks.mockFsReadFile.mockResolvedValue(Buffer.from("source-audio"))
  // Pin the TTS branch. Ambient `backend/.env` must not decide which path the
  // suite exercises — see the note on the config import above.
  config.ELEVENLABS_API_KEY = "el_test"
  mocks.mockIsNodaroConnected.mockResolvedValue(false)
  mocks.mockShouldRunOnCloud.mockResolvedValue(false)
  mocks.mockCloudTextToSpeech.mockResolvedValue({ url: "https://cloud.nodaro.ai/a.mp3", cost: null })
  mocks.mockSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(Buffer.from("cloud-audio")).buffer,
  })
})

// `config` is a shared module singleton. Vitest isolates modules per file
// today, so a leaked mutation cannot reach another file — but that is a
// default nobody here chose, and an ambient value silently deciding a branch
// is precisely the bug this suite just caught. Restore it explicitly.
const originalElevenLabsKey = config.ELEVENLABS_API_KEY
afterEach(() => {
  config.ELEVENLABS_API_KEY = originalElevenLabsKey
})

/**
 * The keyless branch, which decides what a self-hoster sees.
 *
 * Order is the contract: local key wins, then the connection, then the SHARED
 * missing-key error. The last one is the reason this block exists — without it
 * an unconnected keyless install falls into the cloud path and reports
 * "nodaro.ai is not connected", telling the user to check a connection they
 * never set up instead of to add the key they meant to use.
 */
describe("text-to-speech provider selection (keyless self-host)", () => {
  const handler = audioAIHandlers["text-to-speech"]

  it("a local key wins — the connection is never consulted", async () => {
    config.ELEVENLABS_API_KEY = "el_test"
    mocks.mockIsNodaroConnected.mockResolvedValue(true)

    await handler(makeJob("text-to-speech", { text: "Hi", provider: "elevenlabs-v3" }) as never, makeCtx())

    expect(mocks.mockDirectElevenLabsTTS).toHaveBeenCalled()
    expect(mocks.mockCloudTextToSpeech).not.toHaveBeenCalled()
  })

  it("no key + connected — generates on the cloud and stores the bytes locally", async () => {
    config.ELEVENLABS_API_KEY = ""
    mocks.mockIsNodaroConnected.mockResolvedValue(true)

    await handler(makeJob("text-to-speech", { text: "Hi", provider: "elevenlabs-v3" }) as never, makeCtx())

    expect(mocks.mockCloudTextToSpeech).toHaveBeenCalled()
    expect(mocks.mockDirectElevenLabsTTS).not.toHaveBeenCalled()
    // The audio must land under the instance's own R2 key, so nothing
    // downstream learns it was generated elsewhere.
    expect(mocks.mockUploadBufferToR2).toHaveBeenCalledWith(
      Buffer.from("cloud-audio"), "audios/job-1.mp3", "audio/mpeg", "user-1",
    )
  })

  it("no key + NOT connected — the shared missing-key error, not 'nodaro.ai is not connected'", async () => {
    config.ELEVENLABS_API_KEY = ""
    mocks.mockIsNodaroConnected.mockResolvedValue(false)
  mocks.mockShouldRunOnCloud.mockResolvedValue(false)

    await expect(
      handler(makeJob("text-to-speech", { text: "Hi", provider: "elevenlabs-v3" }) as never, makeCtx()),
    ).rejects.toMatchObject({ code: "provider_key_missing" })

    expect(mocks.mockCloudTextToSpeech).not.toHaveBeenCalled()
  })
})

describe("text-to-dialogue provider selection (keyless self-host)", () => {
  const handler = audioAIHandlers["text-to-dialogue"]
  const lines = [{ text: "Hi", voice: "Rachel" }, { text: "Hello", voice: "Daniel" }]

  it("a local key wins — direct API, options threaded, bytes to OUR R2 key", async () => {
    config.ELEVENLABS_API_KEY = "el_test"
    mocks.mockIsNodaroConnected.mockResolvedValue(true)

    await handler(makeJob("text-to-dialogue", { dialogue: lines, stability: 0.5, languageCode: "en", seed: 42, applyTextNormalization: "on" }) as never, makeCtx())

    expect(mocks.mockDirectElevenLabsDialogue).toHaveBeenCalledWith(
      lines,
      expect.objectContaining({ stability: 0.5, languageCode: "en", seed: 42, applyTextNormalization: "on" }),
    )
    expect(mocks.mockCreateCloudJob).not.toHaveBeenCalled()
    expect(mocks.mockUploadBufferToR2).toHaveBeenCalledWith(
      Buffer.from("fake-dialogue"), "audios/job-1.mp3", "audio/mpeg", "user-1",
    )
    // finalize keeps the historical jobType (asset creation keys off it)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: "generate-dialogue",
        result: expect.objectContaining({ cost: null, providerUsed: "elevenlabs-direct" }),
      }),
    )
  })

  it("no key + connected — generates on the cloud and stores the bytes locally", async () => {
    config.ELEVENLABS_API_KEY = ""
    mocks.mockIsNodaroConnected.mockResolvedValue(true)

    await handler(makeJob("text-to-dialogue", { dialogue: lines }) as never, makeCtx())

    expect(mocks.mockCreateCloudJob).toHaveBeenCalledWith(
      "/v1/text-to-dialogue", expect.objectContaining({ dialogue: lines }),
    )
    expect(mocks.mockDirectElevenLabsDialogue).not.toHaveBeenCalled()
    expect(mocks.mockUploadBufferToR2).toHaveBeenCalledWith(
      Buffer.from("cloud-audio"), "audios/job-1.mp3", "audio/mpeg", "user-1",
    )
  })

  it("no key + NOT connected — the shared missing-key error", async () => {
    config.ELEVENLABS_API_KEY = ""
    mocks.mockIsNodaroConnected.mockResolvedValue(false)

    await expect(
      handler(makeJob("text-to-dialogue", { dialogue: lines }) as never, makeCtx()),
    ).rejects.toMatchObject({ code: "provider_key_missing" })

    expect(mocks.mockCreateCloudJob).not.toHaveBeenCalled()
    expect(mocks.mockDirectElevenLabsDialogue).not.toHaveBeenCalled()
  })
})

describe("text-to-speech handler", () => {
  const handler = audioAIHandlers["text-to-speech"]

  it("happy path: generates speech via directElevenLabsTTS, uploads, finalizes", async () => {
    const job = makeJob("text-to-speech", { text: "Hello world", provider: "elevenlabs-v3" })
    await handler(job as never, makeCtx())

    expect(mocks.mockDirectElevenLabsTTS).toHaveBeenCalledWith(
      "Hello world", "Rachel", "elevenlabs-v3",
      expect.objectContaining({ allowDefaultVoiceFallback: false }),
    )
    expect(mocks.mockUploadBufferToR2).toHaveBeenCalledWith(
      Buffer.from("fake-audio"), "audios/job-1.mp3", "audio/mpeg", "user-1",
    )
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: "text-to-speech",
        result: expect.objectContaining({ cost: null, providerUsed: "elevenlabs-direct" }),
      }),
    )
  })

  it("uses custom voice and options", async () => {
    const job = makeJob("text-to-speech", { text: "Hi", provider: "elevenlabs-v3", voice: "Daniel", stability: 0.5, speed: 1.2, languageCode: "en-US" })
    await handler(job as never, makeCtx())

    expect(mocks.mockDirectElevenLabsTTS).toHaveBeenCalledWith(
      "Hi", "Daniel", "elevenlabs-v3",
      expect.objectContaining({ stability: 0.5, speed: 1.2, languageCode: "en-US" }),
    )
  })

  it("resolves an omitted voice to the first allowed-gender voice, not Rachel (B4c)", async () => {
    // Open the surface gate (config snapshots process.env once at import, so
    // mutate the live field) + lock to male-only, then reset the memo.
    const prevEdition = config.EDITION
    config.EDITION = "business"
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
    __resetSurfaceProfileCacheForTests()
    try {
      const job = makeJob("text-to-speech", { text: "hello", provider: "elevenlabs-v3" }) // no voice
      await handler(job as never, makeCtx())
      expect(mocks.mockDirectElevenLabsTTS).toHaveBeenCalledWith(
        "hello", "Adam", "elevenlabs-v3", expect.anything(),
      )
    } finally {
      config.EDITION = prevEdition
      delete process.env.NODARO_SURFACE_PROFILE
      __resetSurfaceProfileCacheForTests()
    }
  })

  it("returns early when finalize signals not-ok (cancelled)", async () => {
    mocks.mockFinalizeJobWithMedia.mockResolvedValueOnce({ ok: false })
    const job = makeJob("text-to-speech", { text: "cancel", provider: "elevenlabs-v3" })
    await handler(job as never, makeCtx())
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalled()
  })

  // Regression guard for the KIE→direct migration: a premade, KIE-accepted
  // voice used to route turbo/multilingual through KIE's TTS proxy
  // (`useDirectApi` was false). Now every provider goes direct regardless of
  // voice/voiceType.
  it("elevenlabs-turbo with a premade voice routes direct (not KIE) with turbo model mapping", async () => {
    const job = makeJob("text-to-speech", { text: "Hello", provider: "elevenlabs-turbo", voice: "Rachel", voiceType: "premade" })
    await handler(job as never, makeCtx())

    expect(mocks.mockDirectElevenLabsTTS).toHaveBeenCalledWith(
      "Hello", "Rachel", "elevenlabs-turbo",
      expect.objectContaining({ allowDefaultVoiceFallback: false }),
    )
    // Non-v3 → tags stripped before hitting the provider.
    expect(mocks.mockStripAudioTags).toHaveBeenCalledWith("Hello")
  })

  it("elevenlabs-multilingual with a premade voice routes direct (not KIE)", async () => {
    const job = makeJob("text-to-speech", { text: "Bonjour", provider: "elevenlabs-multilingual", voice: "Sarah", voiceType: "premade" })
    await handler(job as never, makeCtx())

    expect(mocks.mockDirectElevenLabsTTS).toHaveBeenCalledWith(
      "Bonjour", "Sarah", "elevenlabs-multilingual",
      expect.objectContaining({ allowDefaultVoiceFallback: false }),
    )
    expect(mocks.mockStripAudioTags).toHaveBeenCalledWith("Bonjour")
  })

  it("defaults an absent provider to elevenlabs-v3 (direct), tags NOT stripped", async () => {
    const job = makeJob("text-to-speech", { text: "no provider given [whispers]" })
    await handler(job as never, makeCtx())

    expect(mocks.mockDirectElevenLabsTTS).toHaveBeenCalledWith(
      "no provider given [whispers]", "Rachel", "elevenlabs-v3",
      expect.objectContaining({ allowDefaultVoiceFallback: false }),
    )
    expect(mocks.mockStripAudioTags).not.toHaveBeenCalled()
  })

  // Reconcile consideration: the direct call is synchronous — it never calls
  // makeOnTaskCreated/markProviderCallStart, so TTS jobs never persist
  // provider_kind/provider_call_started_at and stay invisible to the
  // reconcile cron (which only scans rows with a non-null
  // provider_call_started_at). See lib/reconcile/cron.ts.
  it("does not persist provider_kind / provider_call_started_at (no reconcile wiring)", async () => {
    const job = makeJob("text-to-speech", { text: "sync call", provider: "elevenlabs-turbo" })
    await handler(job as never, makeCtx())
    expect(mocks.mockUpdate).not.toHaveBeenCalled()
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

// ---------------------------------------------------------------------------
// Transcribe cloud ladder (#761) — the TTS ladder's sibling. On a keyless
// connected install the payload replays on the cloud; a keyed install never
// reaches it; keyless-unconnected keeps the local path's own honest error.
// ---------------------------------------------------------------------------
describe("transcribe cloud ladder (#761)", () => {
  const handler = audioAIHandlers["transcribe"]

  it("keyless + connected: replays the payload on the cloud and persists its output verbatim", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(true)
    mocks.mockRunJobOnCloud.mockResolvedValueOnce({
      text: "cloud transcript",
      language: "en",
      segments: [{ start: 0, end: 1, text: "cloud transcript" }],
    })
    const job = makeJob("transcribe", { audioUrl: "https://example.com/audio.mp3", provider: "elevenlabs-stt" })
    await handler(job as never, makeCtx())

    expect(mocks.mockRunJobOnCloud).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({ audioUrl: "https://example.com/audio.mp3", provider: "elevenlabs-stt" }),
      expect.any(Function),
    )
    expect(mocks.mockTranscribe).not.toHaveBeenCalled()
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: expect.objectContaining({ text: "cloud transcript", language: "en" }),
    }))
  })

  it("keyed install never reaches the cloud — byte-identical local path", async () => {
    // shouldRunOnCloud is the single gate; the handler passes it the key for
    // the CHOSEN provider so a keyed install resolves false.
    mocks.mockShouldRunOnCloud.mockResolvedValue(false)
    const job = makeJob("transcribe", { audioUrl: "https://example.com/audio.mp3" })
    await handler(job as never, makeCtx())
    expect(mocks.mockRunJobOnCloud).not.toHaveBeenCalled()
    expect(mocks.mockTranscribe).toHaveBeenCalled()
  })

  it("an empty cloud result fails loudly instead of completing with no text", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(true)
    mocks.mockRunJobOnCloud.mockResolvedValueOnce({})
    const job = makeJob("transcribe", { audioUrl: "https://example.com/audio.mp3" })
    await expect(handler(job as never, makeCtx())).rejects.toThrow("no transcription")
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
  })

  it("resolves the key per PROVIDER: whisper lanes gate on the Replicate token", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(false)
    const job = makeJob("transcribe", { audioUrl: "https://example.com/a.mp3", provider: "whisper" })
    await handler(job as never, makeCtx())
    // The gate received the REPLICATE token slot (empty in tests), not ElevenLabs'.
    expect(mocks.mockShouldRunOnCloud).toHaveBeenCalledWith(config.REPLICATE_API_TOKEN)
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

describe("dubbing handler — modes, parking, post-hoc cap", () => {
  const handler = audioAIHandlers["dubbing"]

  it("audio upload: classified audio mode, real mime, delivered as mp3", async () => {
    const job = makeJob("dubbing", { audioUrl: "https://example.com/in.mp3", targetLanguage: "es", probedDurationSec: 60 })
    await handler(job as never, makeCtx())
    expect(mocks.mockStartDubbing).toHaveBeenCalledWith(
      { url: "https://example.com/in.mp3", mime: "audio/mpeg", ext: "mp3" },
      "es",
      expect.anything(),
      expect.anything(),
    )
    // Route probed it (probedDurationSec set) → NO post-hoc status probe.
    expect(mocks.mockPollDubbingStatus).not.toHaveBeenCalled()
    expect(mocks.mockDownloadDubbedMedia).toHaveBeenCalledWith("dub-id", "es", false)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: "text-to-audio", result: expect.objectContaining({ providerUsed: "elevenlabs-dubbing" }) }),
    )
  })

  it("video upload: video mode end-to-end — real mime up, .mp4 down, video delivery with sidecar", async () => {
    const job = makeJob("dubbing", { videoUrl: "https://example.com/clip.mp4", targetLanguage: "fr", probedDurationSec: 90 })
    await handler(job as never, makeCtx({ shouldWatermark: true }))
    expect(mocks.mockStartDubbing).toHaveBeenCalledWith(
      { url: "https://example.com/clip.mp4", mime: "video/mp4", ext: "mp4" },
      "fr",
      expect.anything(),
      expect.anything(),
    )
    expect(mocks.mockDownloadDubbedMedia).toHaveBeenCalledWith("dub-id", "fr", true)
    // Video delivery: nodaro watermark honours ctx, sidecar + thumbnail ride output_data.
    // stringContaining: path.join is backslashed on Windows checkouts.
    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalledWith(expect.stringContaining("dubbed.mp4"), "job-1", "user-1", true)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: expect.objectContaining({
        videoUrl: "https://r2.example.com/video/job-1.mp4",
        audioUrl: "https://r2.example.com/audio/job-1.mp3",
        thumbnailUrl: "https://r2.example.com/thumb.png",
      }),
    })
    expect(mocks.mockCommitJobCredits).toHaveBeenCalled()
    expect(mocks.mockCreateAssetFromJob).toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("sourceUrl: mode + duration come from ElevenLabs' own probe; video content_type → video mode", async () => {
    mocks.mockPollDubbingStatus.mockResolvedValueOnce({
      dubbing_id: "dub-id", status: "dubbing",
      media_metadata: { content_type: "video/mp4", duration: 120 },
    })
    const job = makeJob("dubbing", { sourceUrl: "https://youtube.com/watch?v=x", targetLanguage: "de" })
    await handler(job as never, makeCtx())
    expect(mocks.mockStartDubbing).toHaveBeenCalledWith(
      { sourceUrl: "https://youtube.com/watch?v=x" },
      "de",
      expect.anything(),
      expect.anything(),
    )
    expect(mocks.mockDownloadDubbedMedia).toHaveBeenCalledWith("dub-id", "de", true)
  })

  it("sourceUrl race: an EMPTY early probe is corrected by the FINAL status's media_metadata (video not delivered as .mp3)", async () => {
    // ElevenLabs hadn't fetched the link yet at the post-start poll — no
    // media_metadata. The final "dubbed" status carries it; the worker must
    // re-derive the mode there, like the reconcile lane does.
    mocks.mockPollDubbingStatus.mockResolvedValueOnce({ dubbing_id: "dub-id", status: "dubbing" })
    mocks.mockWaitForDubbing.mockResolvedValueOnce({
      dubbing_id: "dub-id", status: "dubbed",
      media_metadata: { content_type: "video/mp4", duration: 90 },
    })
    const job = makeJob("dubbing", { sourceUrl: "https://youtube.com/watch?v=y", targetLanguage: "es" })
    await handler(job as never, makeCtx())
    expect(mocks.mockDownloadDubbedMedia).toHaveBeenCalledWith("dub-id", "es", true)
    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalled()
  })

  it("post-hoc cap: an un-probeable span past 30 min fails fast BEFORE polling (never strands the envelope)", async () => {
    mocks.mockPollDubbingStatus.mockResolvedValueOnce({
      dubbing_id: "dub-id", status: "dubbing",
      media_metadata: { content_type: "audio/mpeg", duration: 2400 },
    })
    const job = makeJob("dubbing", { sourceUrl: "https://youtube.com/watch?v=long", targetLanguage: "es" })
    await expect(handler(job as never, makeCtx())).rejects.toThrow(/maximum is 30 minutes/)
    expect(mocks.mockWaitForDubbing).not.toHaveBeenCalled()
  })

  it("parks (returns without finalize) when the projected wait exceeds the worker budget", async () => {
    mocks.mockStartDubbing.mockResolvedValueOnce({ dubbingId: "dub-id", expectedDurationSec: 900 })
    const job = makeJob("dubbing", { audioUrl: "https://example.com/in.mp3", targetLanguage: "es", probedDurationSec: 1500 })
    await handler(job as never, makeCtx())
    expect(mocks.mockWaitForDubbing).not.toHaveBeenCalled()
    expect(mocks.mockDownloadDubbedMedia).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("parks on inline-budget timeout (still dubbing) instead of fail+refund while ElevenLabs bills", async () => {
    mocks.mockWaitForDubbing.mockResolvedValueOnce({ dubbing_id: "dub-id", status: "dubbing" })
    const job = makeJob("dubbing", { audioUrl: "https://example.com/in.mp3", targetLanguage: "es", probedDurationSec: 60 })
    await handler(job as never, makeCtx())
    expect(mocks.mockDownloadDubbedMedia).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
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

  it("text-to-speech (direct ElevenLabs API, uploadBufferToR2)", async () => {
    // Every TTS request (v3/turbo/multilingual, any voice type) now goes
    // through directElevenLabsTTS — the provider already returned the audio
    // buffer, so a failed upload must be tagged post-provider.
    mocks.mockUploadBufferToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("text-to-speech", { text: "hi", provider: "elevenlabs-turbo", voice: "custom-uuid", voiceType: "custom" })
    const err = await captureThrow(() => audioAIHandlers["text-to-speech"](job as never, makeCtx()))
    expect(mocks.mockDirectElevenLabsTTS).toHaveBeenCalled() // provider was billed
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

  it("text-to-dialogue (direct ElevenLabs API, uploadBufferToR2)", async () => {
    mocks.mockUploadBufferToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("text-to-dialogue", { dialogue: [{ text: "hi", voice: "Rachel" }] })
    const err = await captureThrow(() => audioAIHandlers["text-to-dialogue"](job as never, makeCtx()))
    expect(mocks.mockDirectElevenLabsDialogue).toHaveBeenCalled()
    expect(isPostProcessingError(err)).toBe(true)
  })

  it("dubbing (uploadBufferToR2)", async () => {
    mocks.mockUploadBufferToR2.mockRejectedValueOnce(rawUploadError())
    const job = makeJob("dubbing", { audioUrl: "https://example.com/in.mp3", targetLanguage: "es" })
    const err = await captureThrow(() => audioAIHandlers["dubbing"](job as never, makeCtx()))
    expect(mocks.mockDownloadDubbedMedia).toHaveBeenCalled() // provider delivered
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

// ---------------------------------------------------------------------------
// voice-changer: THE MEDIA DECIDES THE MODE, never the input slot.
// ---------------------------------------------------------------------------
//
// 2026-08-30: an audio-only M4A uploaded as `.mp4` (video/mp4) was wired into
// the video input. The demux + paid speech-to-speech pass succeeded, then the
// remux died at `-map 0:v` — three retries, no refund, no output. The slot,
// extension and MIME all lied; the streams don't. Probe them and route on
// what is actually there.

describe("voice-changer: the media decides the mode, never the input slot", () => {
  it("video slot + audio-only media → revoices, completes as AUDIO, never remuxes", async () => {
    mocks.mockProbeMediaStreams.mockResolvedValueOnce({ hasVideo: false, hasAudio: true })
    const src = "https://cdn.example.com/uploads/videos/consultation.mp4"
    const job = makeJob("voice-changer", { videoUrl: src, voiceId: "v-1" })
    await audioAIHandlers["voice-changer"](job as never, makeCtx())
    expect(mocks.mockProbeMediaStreams).toHaveBeenCalledWith(src)
    expect(mocks.mockExtractAudioTrack).toHaveBeenCalledWith(src)
    expect(mocks.mockDirectVoiceChanger).toHaveBeenCalled()
    expect(mocks.mockMergeVideoAudio).not.toHaveBeenCalled()
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1",
      mediaUrl: "https://r2.example.com/audio/job-1.mp3",
      extraOutputData: expect.objectContaining({ sourceHasVideo: false }),
    }))
  })

  it("probe failure fails OPEN — the video path (remux) still runs on the slot's word", async () => {
    mocks.mockProbeMediaStreams.mockRejectedValueOnce(new Error("ffprobe hiccup"))
    const job = makeJob("voice-changer", { videoUrl: "https://example.com/in.mp4", voiceId: "v-1" })
    await audioAIHandlers["voice-changer"](job as never, makeCtx())
    expect(mocks.mockMergeVideoAudio).toHaveBeenCalled()
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: expect.objectContaining({ videoUrl: "https://r2.example.com/video/job-1.mp4" }),
    }))
  })

  it("audio slot + a VIDEO file → demuxes first (the STS provider never sees a video container); output is audio", async () => {
    mocks.mockProbeMediaStreams.mockResolvedValueOnce({ hasVideo: true, hasAudio: true })
    const src = "https://example.com/actually-a-video.mp4"
    const job = makeJob("voice-changer", { audioUrl: src, voiceId: "v-1" })
    await audioAIHandlers["voice-changer"](job as never, makeCtx())
    expect(mocks.mockExtractAudioTrack).toHaveBeenCalledWith(src)
    expect(mocks.mockDirectVoiceChanger).toHaveBeenCalled()
    expect(mocks.mockVoiceChangerFromUrl).not.toHaveBeenCalled()
    expect(mocks.mockMergeVideoAudio).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(expect.objectContaining({
      mediaUrl: "https://r2.example.com/audio/job-1.mp3",
      extraOutputData: expect.objectContaining({ sourceHasVideo: true }),
    }))
  })

  it("audio slot + plain audio → the untouched legacy audio path (voiceChangerFromUrl)", async () => {
    mocks.mockProbeMediaStreams.mockResolvedValueOnce({ hasVideo: false, hasAudio: true })
    mocks.mockVoiceChangerFromUrl.mockResolvedValueOnce(Buffer.from("revoiced"))
    const job = makeJob("voice-changer", { audioUrl: "https://example.com/in.mp3", voiceId: "v-1" })
    await audioAIHandlers["voice-changer"](job as never, makeCtx())
    expect(mocks.mockVoiceChangerFromUrl).toHaveBeenCalled()
    expect(mocks.mockExtractAudioTrack).not.toHaveBeenCalled()
    expect(mocks.mockMergeVideoAudio).not.toHaveBeenCalled()
  })
})
