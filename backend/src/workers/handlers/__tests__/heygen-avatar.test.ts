import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockGenerateAvatarVideo = vi.fn()
  const mockUploadVideoMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/videos/ai-avatar-job-1.mp4")
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/ai-avatar-job-1.png")
  const mockFinalizeJobWithMedia = vi.fn().mockResolvedValue({ ok: true })
  const mockSetJobProgress = vi.fn(async () => {})

  return {
    mockGenerateAvatarVideo,
    mockUploadVideoMaybeWatermark,
    mockGenerateAndUploadThumbnail,
    mockFinalizeJobWithMedia,
    mockSetJobProgress,
  }
})

vi.mock("@/providers/heygen/video.js", () => ({
  generateAvatarVideo: mocks.mockGenerateAvatarVideo,
}))

vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
    generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
    setJobProgress: mocks.mockSetJobProgress,
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

vi.mock("../../../lib/job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia,
}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { handleAiAvatar } from "../heygen-avatar.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AVATAR_RESULT = {
  videoUrl: "https://files.heygen.ai/expiring/avatar.mp4",
  durationSec: 5.25,
  cost: 0.315,
  meteredCost: true as const,
}

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "ai-avatar",
    data: {
      jobId: "job-1",
      engine: "avatar-iv",
      avatarId: "avatar-abc123",
      speechMode: "text",
      script: "Hello, welcome to our product.",
      voiceId: "voice-xyz",
      voiceSpeed: 1.0,
      resolution: "720p",
      aspectRatio: "16:9",
      caption: false,
      usageLogId: "usage-1",
      ...data,
    },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    jobUserId: "user-1",
    usageLogId: "usage-1",
    shouldWatermark: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockGenerateAvatarVideo.mockResolvedValue(AVATAR_RESULT)
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/ai-avatar-job-1.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumbnails/ai-avatar-job-1.png")
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
})

// ---------------------------------------------------------------------------
// Happy path — text mode
// ---------------------------------------------------------------------------

describe("handleAiAvatar — text mode", () => {
  it("calls generateAvatarVideo with all text-mode fields", async () => {
    const job = makeJob()
    await handleAiAvatar(job as never, makeCtx())

    expect(mocks.mockGenerateAvatarVideo).toHaveBeenCalledWith({
      engine: "avatar-iv",
      avatarId: "avatar-abc123",
      speechMode: "text",
      script: "Hello, welcome to our product.",
      voiceId: "voice-xyz",
      voiceSpeed: 1.0,
      audioUrl: undefined,
      resolution: "720p",
      aspectRatio: "16:9",
      caption: false,
    })
  })

  it("re-hosts the expiring HeyGen URL to R2 via uploadVideoMaybeWatermark", async () => {
    const job = makeJob()
    await handleAiAvatar(job as never, makeCtx())

    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(
      AVATAR_RESULT.videoUrl,
      "job-1",
      "user-1",
      false,
    )
  })

  it("generates a thumbnail from the R2 URL (not the expiring HeyGen URL)", async () => {
    const job = makeJob()
    await handleAiAvatar(job as never, makeCtx())

    // The thumbnail should be generated from the R2 URL, not the expiring HeyGen URL.
    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalledWith(
      "https://r2.example.com/videos/ai-avatar-job-1.mp4",
      "job-1",
      "user-1",
    )
  })

  it("finalizes with the R2 url, meteredCost:true, provider cost, and heygen providerUsed", async () => {
    const job = makeJob()
    await handleAiAvatar(job as never, makeCtx())

    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        jobType: "ai-avatar",
        result: expect.objectContaining({
          url: AVATAR_RESULT.videoUrl,
          cost: AVATAR_RESULT.cost,
          meteredCost: true,
          providerUsed: "heygen",
        }),
        mediaUrl: "https://r2.example.com/videos/ai-avatar-job-1.mp4",
        extraOutputData: expect.objectContaining({
          thumbnailUrl: "https://r2.example.com/thumbnails/ai-avatar-job-1.png",
          durationSec: AVATAR_RESULT.durationSec,
        }),
      }),
    )
  })

  it("respects the shouldWatermark flag on ctx", async () => {
    const job = makeJob()
    await handleAiAvatar(job as never, makeCtx({ shouldWatermark: true }))

    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(
      expect.any(String),
      "job-1",
      "user-1",
      true, // shouldWatermark forwarded
    )
  })
})

// ---------------------------------------------------------------------------
// Audio mode
// ---------------------------------------------------------------------------

describe("handleAiAvatar — audio mode", () => {
  it("calls generateAvatarVideo with audio-mode fields", async () => {
    const job = makeJob({
      speechMode: "audio",
      audioUrl: "https://r2.example.com/audio/driving.mp3",
      script: undefined,
      voiceId: undefined,
      voiceSpeed: undefined,
    })
    await handleAiAvatar(job as never, makeCtx())

    expect(mocks.mockGenerateAvatarVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        speechMode: "audio",
        audioUrl: "https://r2.example.com/audio/driving.mp3",
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Error propagation — no double-refund
// ---------------------------------------------------------------------------

describe("handleAiAvatar — provider error propagation", () => {
  it("propagates a thrown generateAvatarVideo error without calling finalize", async () => {
    mocks.mockGenerateAvatarVideo.mockRejectedValueOnce(new Error("HeyGen 500"))
    const job = makeJob()

    await expect(handleAiAvatar(job as never, makeCtx())).rejects.toThrow("HeyGen 500")
    // finalizeJobWithMedia must NOT be called on error — the shared credit-guard
    // refund path in the worker's catch block handles the credit refund
    // (keyed on isFinalJobAttempt); calling finalize here would double-refund.
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("does not call finalizeJobWithMedia when finalize returns ok:false (cancel race)", async () => {
    mocks.mockFinalizeJobWithMedia.mockResolvedValueOnce({ ok: false })
    const job = makeJob()

    // Should not throw — just return early.
    await expect(handleAiAvatar(job as never, makeCtx())).resolves.toBeUndefined()
    // finalize was called once but returned ok:false (cancel won the CAS)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledTimes(1)
  })
})
