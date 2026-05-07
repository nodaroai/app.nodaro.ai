import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockImageToVideo = vi.fn()
  const mockApplySmartLoopCut = vi.fn()
  const mockRefundLoopTrimAddon = vi.fn().mockResolvedValue(undefined)

  const mockUploadToR2 = vi.fn().mockResolvedValue("https://r2.example.com/videos/raw.mp4")
  const mockMergeVideoAudio = vi.fn().mockResolvedValue("/tmp/workdir/merged.mp4")
  const mockCleanupWorkDir = vi.fn().mockResolvedValue(undefined)

  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  const mockUploadVideoMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  const mockWatermarkLocalVideoAndUpload = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1-merged.mp4")
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")

  const mockSetJobProgress = vi.fn(async () => {})

  // Supabase chain (worker handler imports supabase from @/lib/supabase.js
  // transitively via shared.js; we don't exercise it here but stub for safety)
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockImageToVideo,
    mockApplySmartLoopCut,
    mockRefundLoopTrimAddon,
    mockUploadToR2,
    mockMergeVideoAudio,
    mockCleanupWorkDir,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockMarkJobCompleted,
    mockUploadVideoMaybeWatermark,
    mockWatermarkLocalVideoAndUpload,
    mockGenerateAndUploadThumbnail,
    mockSetJobProgress,
    mockFrom,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/lib/storage.js", () => ({
  uploadToR2: mocks.mockUploadToR2,
  uploadBufferToR2: vi.fn().mockResolvedValue("https://r2.example.com/buffer.mp4"),
}))

vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.mockImageToVideo,
  textToVideo: vi.fn(),
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
}))

vi.mock("@/providers/video/apply-smart-loop-cut.js", () => ({
  applySmartLoopCutToR2Url: mocks.mockApplySmartLoopCut,
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

vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    commitJobCredits: mocks.mockCommitJobCredits,
    shouldSaveJobResult: mocks.mockShouldSaveJobResult,
    markJobCompleted: mocks.mockMarkJobCompleted,
    uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
    watermarkLocalVideoAndUpload: mocks.mockWatermarkLocalVideoAndUpload,
    generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
    setJobProgress: mocks.mockSetJobProgress,
    refundLoopTrimAddon: mocks.mockRefundLoopTrimAddon,
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { videoAIHandlers } from "../video-ai.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return {
    name,
    data: { jobId: "job-1", ...data },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    jobUserId: "user-1",
    usageLogId: "log-1",
    shouldWatermark: false,
    ...overrides,
  }
}

const VIDEO_RESULT = {
  url: "https://r2.example.com/raw.mp4",
  providerUsed: "veo3.1",
  cost: 1.25,
  displayCost: 1.5625,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockImageToVideo.mockResolvedValue(VIDEO_RESULT)
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  mocks.mockUploadToR2.mockResolvedValue("https://r2.example.com/videos/raw.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
  mocks.mockMarkJobCompleted.mockResolvedValue(true)
})

// ---------------------------------------------------------------------------
// image-to-video handler — smart-loop-cut
// ---------------------------------------------------------------------------

describe("image-to-video handler — smart-loop-cut", () => {
  const handler = videoAIHandlers["image-to-video"]

  it("applies smart-loop-cut when loopTrim.enabled", async () => {
    mocks.mockApplySmartLoopCut.mockResolvedValueOnce("https://r2.example.com/trimmed.mp4")

    const job = makeJob("image-to-video", {
      imageUrl: "https://x.png",
      provider: "veo3.1",
      duration: 8,
      loopTrim: { enabled: true, framesToTest: 16, quality: "precise" },
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockApplySmartLoopCut).toHaveBeenCalledTimes(1)
    expect(mocks.mockApplySmartLoopCut).toHaveBeenCalledWith(
      "https://r2.example.com/raw.mp4",
      "job-1",
      "user-1",
      expect.objectContaining({
        lookbackFrames: 16,
        quality: "precise",
      }),
    )
    // The trimmed URL should be the one uploaded, not the raw
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(
      "https://r2.example.com/trimmed.mp4",
      "job-1",
      "user-1",
      false,
    )
    expect(mocks.mockRefundLoopTrimAddon).not.toHaveBeenCalled()
  })

  it("on smart-loop-cut failure: keeps un-trimmed clip and refunds addon", async () => {
    mocks.mockApplySmartLoopCut.mockRejectedValueOnce(new Error("ffmpeg crashed"))

    const job = makeJob("image-to-video", {
      imageUrl: "https://x.png",
      provider: "veo3.1",
      duration: 8,
      loopTrim: { enabled: true, framesToTest: 16, quality: "precise" },
    })

    await handler(job as never, makeCtx())

    // ceil(8/5) + ceil(16/24) = 2 + 1 = 3
    expect(mocks.mockRefundLoopTrimAddon).toHaveBeenCalledWith("job-1", "log-1", 3)

    // Falls back to the un-trimmed raw URL
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(
      "https://r2.example.com/raw.mp4",
      "job-1",
      "user-1",
      false,
    )

    // Job still completes
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalled()
  })

  it("skips smart-loop-cut when loopTrim is undefined", async () => {
    const job = makeJob("image-to-video", {
      imageUrl: "https://x.png",
      provider: "veo3.1",
      duration: 8,
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockApplySmartLoopCut).not.toHaveBeenCalled()
    expect(mocks.mockRefundLoopTrimAddon).not.toHaveBeenCalled()
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalled()
  })

  it("skips smart-loop-cut when loopTrim.enabled is false", async () => {
    const job = makeJob("image-to-video", {
      imageUrl: "https://x.png",
      provider: "veo3.1",
      duration: 8,
      loopTrim: { enabled: false, framesToTest: 16, quality: "precise" },
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockApplySmartLoopCut).not.toHaveBeenCalled()
    expect(mocks.mockRefundLoopTrimAddon).not.toHaveBeenCalled()
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalled()
  })

  it("forwards outputSilent=true when sound=false", async () => {
    mocks.mockApplySmartLoopCut.mockResolvedValueOnce("https://r2.example.com/trimmed.mp4")

    // Use a non-VEO provider so the post-process audio-strip path doesn't
    // run; only smart-loop-cut should care about outputSilent here.
    const job = makeJob("image-to-video", {
      imageUrl: "https://x.png",
      provider: "minimax",
      duration: 8,
      sound: false,
      loopTrim: { enabled: true, framesToTest: 16, quality: "precise" },
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockApplySmartLoopCut).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ outputSilent: true }),
    )
  })
})
