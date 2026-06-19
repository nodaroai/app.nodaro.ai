import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  mockImageToVideo: vi.fn(),
  mockGenerateDialogue: vi.fn(),
  mockExtractAudioTrack: vi.fn(),
  mockDirectVoiceChanger: vi.fn(),
  mockMergeVideoAudio: vi.fn(),
  mockCleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  mockUploadToR2: vi.fn(),
  mockUploadBufferToR2: vi.fn(),
  mockUploadVideoMaybeWatermark: vi.fn(),
  mockWatermarkLocalVideoAndUpload: vi.fn(),
  mockGenerateAndUploadThumbnail: vi.fn(),
  mockFinalizeJobWithMedia: vi.fn(),
  mockSetJobProgress: vi.fn(async () => {}),
  mockReadFile: vi.fn(),
  mockFrom: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.mockFrom } }))

vi.mock("@/lib/storage.js", () => ({
  uploadToR2: mocks.mockUploadToR2,
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.mockImageToVideo,
  textToVideo: vi.fn(),
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
}))

vi.mock("@/providers/kie/audio.js", () => ({
  KieAudioProvider: class {
    generateDialogue = mocks.mockGenerateDialogue
  },
}))

vi.mock("@/providers/video/extract-audio-track.js", () => ({
  extractAudioTrack: mocks.mockExtractAudioTrack,
}))

vi.mock("@/providers/elevenlabs/voice-changer.js", () => ({
  directVoiceChanger: mocks.mockDirectVoiceChanger,
  voiceChangerFromUrl: vi.fn(),
}))

vi.mock("@/providers/video/merge-video-audio.js", () => ({
  mergeVideoAudio: mocks.mockMergeVideoAudio,
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: mocks.mockCleanupWorkDir,
  createWorkDir: vi.fn().mockResolvedValue("/tmp/workdir"),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  stripAudio: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, readFile: mocks.mockReadFile }
})

vi.mock("../../../lib/job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia,
}))

vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
    watermarkLocalVideoAndUpload: mocks.mockWatermarkLocalVideoAndUpload,
    generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
    setJobProgress: mocks.mockSetJobProgress,
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

// ---------------------------------------------------------------------------
// Module under test (after mocks)
// ---------------------------------------------------------------------------

import { videoAIHandlers } from "../video-ai.js"

const handler = videoAIHandlers["voiced-video"]

function makeJob(data: Record<string, unknown>) {
  return { name: "voiced-video", data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: false }

const VIDEO_RESULT = { url: "https://r2.example.com/raw.mp4", providerUsed: "kie", cost: 0.3, displayCost: 0.375 }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockImageToVideo.mockResolvedValue(VIDEO_RESULT)
  mocks.mockGenerateDialogue.mockResolvedValue({ url: "https://kie.example.com/dialogue.mp3", cost: 0.07 })
  mocks.mockUploadToR2.mockResolvedValue("https://r2.example.com/dialogue.mp3")
  mocks.mockExtractAudioTrack.mockResolvedValue({ audioPath: "/tmp/a.mp3", workDir: "/tmp/wd" })
  mocks.mockDirectVoiceChanger.mockResolvedValue(Buffer.from("revoiced"))
  mocks.mockUploadBufferToR2.mockResolvedValue("https://r2.example.com/revoiced.mp3")
  mocks.mockMergeVideoAudio.mockResolvedValue("/tmp/merged.mp4")
  mocks.mockWatermarkLocalVideoAndUpload.mockResolvedValue("https://r2.example.com/job-1-revoiced.mp4")
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/job-1.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumb.png")
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.mockReadFile.mockResolvedValue(Buffer.from("audio"))
})

describe("voiced-video handler — audio_driven (Seedance 2)", () => {
  it("synthesises multi-speaker dialogue, feeds it as reference audio, and charges the addon", async () => {
    await handler(
      makeJob({
        imageUrl: "https://x.png",
        prompt: "two people talk",
        provider: "seedance-2-fast",
        duration: 8,
        characterVoices: [
          { voiceId: "anna-v", speaker: "Anna" },
          { voiceId: "gordon-v", speaker: "Gordon" },
        ],
        dialogue: [
          { speaker: "Anna", line: "good morning" },
          { speaker: "Gordon", line: "morning to you" },
        ],
        voicedAudioAddon: 4,
      }) as never,
      ctx,
    )

    // each line synthesised in its OWN voice, in order
    expect(mocks.mockGenerateDialogue).toHaveBeenCalledWith(
      [
        { text: "good morning", voice: "anna-v" },
        { text: "morning to you", voice: "gordon-v" },
      ],
      undefined,
    )
    // the stitched track is fed as reference audio; the model supplies the soundtrack
    expect(mocks.mockImageToVideo).toHaveBeenCalledWith(
      "https://x.png",
      "seedance-2-fast",
      "two people talk",
      8,
      undefined,
      expect.objectContaining({ referenceAudioUrls: ["https://r2.example.com/dialogue.mp3"], generateAudio: false }),
    )
    // no separate revoice for the audio_driven path
    expect(mocks.mockDirectVoiceChanger).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: "image-to-video",
        extraNonProviderCredits: 4,
        extraOutputData: expect.objectContaining({ voiceApplied: true }),
      }),
    )
  })
})

describe("voiced-video handler — native_speech (VEO)", () => {
  it("bakes the line into the prompt, then revoices the clip to the primary voice", async () => {
    await handler(
      makeJob({
        imageUrl: "https://x.png",
        prompt: "she speaks to camera",
        provider: "veo3.1",
        duration: 8,
        characterVoices: [{ voiceId: "anna-v", speaker: "Anna" }],
        dialogue: [{ speaker: "Anna", line: "hello there" }],
        voicedAudioAddon: 4,
      }) as never,
      ctx,
    )

    const [imgUrl, prov, bakedPrompt, , , opts] = mocks.mockImageToVideo.mock.calls[0]
    expect(imgUrl).toBe("https://x.png")
    expect(prov).toBe("veo3.1")
    expect(bakedPrompt).toContain("hello there")
    expect((opts as { generateAudio?: boolean }).generateAudio).toBe(true)
    expect((opts as Record<string, unknown>).referenceAudioUrls).toBeUndefined()

    // revoice chain: extract -> speech-to-speech (primary voice, keep bed) -> remux
    expect(mocks.mockExtractAudioTrack).toHaveBeenCalledWith(VIDEO_RESULT.url)
    expect(mocks.mockDirectVoiceChanger).toHaveBeenCalledWith(
      expect.any(Buffer),
      "anna-v",
      expect.objectContaining({ removeBackgroundNoise: false }),
    )
    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalled()
    expect(mocks.mockGenerateDialogue).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({ extraNonProviderCredits: 4, extraOutputData: expect.objectContaining({ voiceApplied: true }) }),
    )
  })
})

describe("voiced-video handler — no voice resolvable", () => {
  it("generates a plain clip and refunds the audio addon (voiceApplied false, extra 0)", async () => {
    await handler(
      makeJob({
        imageUrl: "https://x.png",
        prompt: "a plain clip with no quoted dialogue",
        provider: "seedance-2-fast",
        duration: 8,
        characterVoices: [],
        dialogue: [],
        voicedAudioAddon: 4,
      }) as never,
      ctx,
    )

    expect(mocks.mockGenerateDialogue).not.toHaveBeenCalled()
    const opts = mocks.mockImageToVideo.mock.calls[0][5] as Record<string, unknown>
    expect(opts.referenceAudioUrls).toBeUndefined()
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        extraNonProviderCredits: 0,
        extraOutputData: expect.objectContaining({ voiceApplied: false }),
      }),
    )
  })
})
