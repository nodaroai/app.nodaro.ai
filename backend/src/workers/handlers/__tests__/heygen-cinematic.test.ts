import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockGenerateCinematicAvatar = vi.fn()
  const mockUploadVideoMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/videos/cinematic-job-1.mp4")
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/cinematic-job-1.png")
  const mockFinalizeJobWithMedia = vi.fn().mockResolvedValue({ ok: true })
  const mockSetJobProgress = vi.fn(async () => {})

  return {
    mockGenerateCinematicAvatar,
    mockUploadVideoMaybeWatermark,
    mockGenerateAndUploadThumbnail,
    mockFinalizeJobWithMedia,
    mockSetJobProgress,
  }
})

vi.mock("@/providers/heygen/cinematic.js", () => ({
  generateCinematicAvatar: mocks.mockGenerateCinematicAvatar,
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

import { handleCinematicAvatar } from "../heygen-cinematic.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CINEMATIC_RESULT = {
  videoUrl: "https://files.heygen.ai/expiring/cinematic.mp4",
  durationSec: 10,
  cost: 1.5,
  meteredCost: true as const,
}

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "cinematic-avatar",
    data: {
      jobId: "job-1",
      prompt: "A futuristic city at night, cinematic style.",
      avatarLooks: ["look-abc123"],
      duration: 10,
      autoDuration: false,
      aspectRatio: "16:9",
      resolution: "720p",
      enhancePrompt: false,
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
  mocks.mockGenerateCinematicAvatar.mockResolvedValue(CINEMATIC_RESULT)
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/cinematic-job-1.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumbnails/cinematic-job-1.png")
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("handleCinematicAvatar — happy path", () => {
  it("calls generateCinematicAvatar with all job data fields", async () => {
    const job = makeJob()
    await handleCinematicAvatar(job as never, makeCtx())

    expect(mocks.mockGenerateCinematicAvatar).toHaveBeenCalledWith({
      prompt: "A futuristic city at night, cinematic style.",
      avatarLooks: ["look-abc123"],
      duration: 10,
      autoDuration: false,
      aspectRatio: "16:9",
      resolution: "720p",
      enhancePrompt: false,
    })
  })

  it("re-hosts the expiring HeyGen URL to R2 via uploadVideoMaybeWatermark", async () => {
    const job = makeJob()
    await handleCinematicAvatar(job as never, makeCtx())

    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(
      CINEMATIC_RESULT.videoUrl,
      "job-1",
      "user-1",
      false,
    )
  })

  it("generates a thumbnail from the R2 URL (not the expiring HeyGen URL)", async () => {
    const job = makeJob()
    await handleCinematicAvatar(job as never, makeCtx())

    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalledWith(
      "https://r2.example.com/videos/cinematic-job-1.mp4",
      "job-1",
      "user-1",
    )
  })

  it("finalizes with meteredCost:true, provider cost, heygen providerUsed, and durationSec", async () => {
    const job = makeJob()
    await handleCinematicAvatar(job as never, makeCtx())

    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        jobType: "cinematic-avatar",
        result: expect.objectContaining({
          url: CINEMATIC_RESULT.videoUrl,
          cost: CINEMATIC_RESULT.cost,
          meteredCost: true,
          providerUsed: "heygen",
        }),
        mediaUrl: "https://r2.example.com/videos/cinematic-job-1.mp4",
        extraOutputData: expect.objectContaining({
          thumbnailUrl: "https://r2.example.com/thumbnails/cinematic-job-1.png",
          durationSec: CINEMATIC_RESULT.durationSec,
        }),
      }),
    )
  })

  it("respects the shouldWatermark flag on ctx", async () => {
    const job = makeJob()
    await handleCinematicAvatar(job as never, makeCtx({ shouldWatermark: true }))

    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(
      expect.any(String),
      "job-1",
      "user-1",
      true,
    )
  })

  it("supports multiple avatarLooks (up to 3)", async () => {
    const job = makeJob({
      avatarLooks: ["look-1", "look-2", "look-3"],
    })
    await handleCinematicAvatar(job as never, makeCtx())

    expect(mocks.mockGenerateCinematicAvatar).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarLooks: ["look-1", "look-2", "look-3"],
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// autoDuration mode
// ---------------------------------------------------------------------------

describe("handleCinematicAvatar — autoDuration mode", () => {
  it("forwards autoDuration:true to generateCinematicAvatar", async () => {
    const job = makeJob({ autoDuration: true, duration: undefined })
    await handleCinematicAvatar(job as never, makeCtx())

    expect(mocks.mockGenerateCinematicAvatar).toHaveBeenCalledWith(
      expect.objectContaining({ autoDuration: true }),
    )
  })
})

// ---------------------------------------------------------------------------
// Error propagation — no double-refund
// ---------------------------------------------------------------------------

describe("handleCinematicAvatar — provider error propagation", () => {
  it("propagates a thrown generateCinematicAvatar error without calling finalize", async () => {
    mocks.mockGenerateCinematicAvatar.mockRejectedValueOnce(new Error("HeyGen 500"))
    const job = makeJob()

    await expect(handleCinematicAvatar(job as never, makeCtx())).rejects.toThrow("HeyGen 500")
    // finalizeJobWithMedia must NOT be called on error — the shared credit-guard
    // refund path in the worker's catch block handles the credit refund
    // (keyed on isFinalJobAttempt); calling finalize here would double-refund.
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("does not throw when finalize returns ok:false (cancel race)", async () => {
    mocks.mockFinalizeJobWithMedia.mockResolvedValueOnce({ ok: false })
    const job = makeJob()

    // Should not throw — just return early.
    await expect(handleCinematicAvatar(job as never, makeCtx())).resolves.toBeUndefined()
    // finalize was called once but returned ok:false (cancel won the CAS)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledTimes(1)
  })
})
