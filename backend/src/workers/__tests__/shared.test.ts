import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockHasCredits = { value: true }
  const mockCommitCredits = vi.fn().mockResolvedValue(undefined)
  const mockRefundCredits = vi.fn().mockResolvedValue(undefined)
  const mockUploadToR2 = vi.fn().mockResolvedValue("https://r2.example.com/images/test.png")
  const mockUploadBufferToR2 = vi.fn().mockResolvedValue("https://r2.example.com/images/test-wm.png")
  const mockUploadFileToR2 = vi.fn().mockResolvedValue("https://r2.example.com/videos/test.mp4")
  const mockApplyImageWatermark = vi.fn().mockResolvedValue(Buffer.from("watermarked"))
  const mockGenerateThumbnailFromUrl = vi.fn().mockResolvedValue(Buffer.from("thumb"))
  const mockCleanupWorkDir = vi.fn().mockResolvedValue(undefined)

  // Supabase mock with fine-grained control per call
  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockEq = vi.fn().mockReturnValue({
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    eq: vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockMaybeSingle }),
  })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect, single: mockSingle })
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
  })

  return {
    mockHasCredits,
    mockCommitCredits,
    mockRefundCredits,
    mockUploadToR2,
    mockUploadBufferToR2,
    mockUploadFileToR2,
    mockApplyImageWatermark,
    mockGenerateThumbnailFromUrl,
    mockCleanupWorkDir,
    mockFrom,
    mockSingle,
    mockMaybeSingle,
    mockEq,
    mockSelect,
    mockUpdate,
    mockInsert,
  }
})

vi.mock("@/lib/config.js", () => ({
  config: { R2_PUBLIC_URL: "https://r2.example.com" },
  hasCredits: () => mocks.mockHasCredits.value,
  isCloud: () => mocks.mockHasCredits.value,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/services/credits.js", () => ({
  CreditsService: {
    commitCredits: mocks.mockCommitCredits,
    refundCredits: mocks.mockRefundCredits,
  },
}))

vi.mock("@/lib/storage.js", () => ({
  uploadToR2: mocks.mockUploadToR2,
  uploadBufferToR2: mocks.mockUploadBufferToR2,
  uploadFileToR2: mocks.mockUploadFileToR2,
  uploadFileWithKeyToR2: vi.fn(),
}))

vi.mock("@/utils/watermark.js", () => ({
  applyImageWatermark: mocks.mockApplyImageWatermark,
  applyVideoWatermark: vi.fn(),
}))

vi.mock("@/utils/thumbnail.js", () => ({
  generateThumbnailFromUrl: mocks.mockGenerateThumbnailFromUrl,
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn().mockResolvedValue("/tmp/test-workdir"),
  cleanupWorkDir: mocks.mockCleanupWorkDir,
  downloadFile: vi.fn().mockResolvedValue(undefined),
  transcodeToBrowserSafe: vi.fn().mockImplementation((input: string) => Promise.resolve(input)),
}))

// youtube-dl-exec is only used by downloadAudioToR2 which we're not testing
vi.mock("youtube-dl-exec", () => ({ default: vi.fn() }))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import {
  isSocialUrl,
  shouldSaveJobResult,
  commitJobCredits,
  refundJobCredits,
  uploadImageMaybeWatermark,
  completeFfmpegVideoJob,
  completeFfmpegAudioJob,
  createAssetFromJob,
} from "../shared.js"

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockHasCredits.value = true
})

// ---------------------------------------------------------------------------
// isSocialUrl
// ---------------------------------------------------------------------------

describe("isSocialUrl", () => {
  it.each([
    "https://www.youtube.com/watch?v=abc",
    "https://youtu.be/abc",
    "https://www.tiktok.com/@user/video/123",
    "https://www.instagram.com/p/abc",
    "https://twitter.com/user/status/123",
    "https://x.com/user/status/123",
    "https://www.facebook.com/watch/123",
    "https://fb.watch/abc",
  ])("returns true for social URL: %s", (url) => {
    expect(isSocialUrl(url)).toBe(true)
  })

  it.each([
    "https://example.com/video.mp4",
    "https://r2.example.com/videos/test.mp4",
    "https://cdn.replicate.com/output.mp4",
    "not-a-url",
    "",
  ])("returns false for non-social URL: %s", (url) => {
    expect(isSocialUrl(url)).toBe(false)
  })

  it("returns false for invalid URLs", () => {
    expect(isSocialUrl("://broken")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// shouldSaveJobResult
// ---------------------------------------------------------------------------

describe("shouldSaveJobResult", () => {
  it("returns true when job is processing", async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: { status: "processing" }, error: null })
    expect(await shouldSaveJobResult("job-1")).toBe(true)
  })

  it("returns false when job is cancelled", async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: { status: "cancelled" }, error: null })
    expect(await shouldSaveJobResult("job-1")).toBe(false)
  })

  it("returns true when job record not found", async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await shouldSaveJobResult("job-1")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// commitJobCredits
// ---------------------------------------------------------------------------

describe("commitJobCredits", () => {
  it("commits credits when cloud edition and usageLogId present", async () => {
    await commitJobCredits("usage-log-1", "job-1")
    expect(mocks.mockCommitCredits).toHaveBeenCalledWith("usage-log-1")
  })

  it("skips when no usageLogId", async () => {
    await commitJobCredits(null, "job-1")
    expect(mocks.mockCommitCredits).not.toHaveBeenCalled()
  })

  it("skips when undefined usageLogId", async () => {
    await commitJobCredits(undefined, "job-1")
    expect(mocks.mockCommitCredits).not.toHaveBeenCalled()
  })

  it("skips when not cloud edition", async () => {
    mocks.mockHasCredits.value = false
    await commitJobCredits("usage-log-1", "job-1")
    expect(mocks.mockCommitCredits).not.toHaveBeenCalled()
  })

  it("swallows errors", async () => {
    mocks.mockCommitCredits.mockRejectedValueOnce(new Error("DB down"))
    await expect(commitJobCredits("usage-log-1", "job-1")).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// refundJobCredits
// ---------------------------------------------------------------------------

describe("refundJobCredits", () => {
  it("refunds credits for system errors", async () => {
    await refundJobCredits("usage-log-1", "job-1", "Worker crashed unexpectedly")
    expect(mocks.mockRefundCredits).toHaveBeenCalledWith("usage-log-1")
  })

  it.each([
    "Provider error: rate limit exceeded",
    "Provider returned 500",
    "Provider rejected the request",
    "API error: 429",
    "KIE.ai task failed",
    "Replicate prediction failed",
    "Model error: unsupported format",
    "Content moderation flagged",
    "NSFW content detected",
  ])("does NOT refund for provider error: %s", async (msg) => {
    await refundJobCredits("usage-log-1", "job-1", msg)
    expect(mocks.mockRefundCredits).not.toHaveBeenCalled()
  })

  it("skips when no usageLogId", async () => {
    await refundJobCredits(null, "job-1", "crash")
    expect(mocks.mockRefundCredits).not.toHaveBeenCalled()
  })

  it("skips when not cloud edition", async () => {
    mocks.mockHasCredits.value = false
    await refundJobCredits("usage-log-1", "job-1", "crash")
    expect(mocks.mockRefundCredits).not.toHaveBeenCalled()
  })

  it("swallows errors", async () => {
    mocks.mockRefundCredits.mockRejectedValueOnce(new Error("DB down"))
    await expect(refundJobCredits("usage-log-1", "job-1", "crash")).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// uploadImageMaybeWatermark
// ---------------------------------------------------------------------------

describe("uploadImageMaybeWatermark", () => {
  it("uploads without watermark when watermark=false", async () => {
    const url = await uploadImageMaybeWatermark("https://source.com/img.png", "job-1", "user-1", false)
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith("https://source.com/img.png", "job-1", "image", "user-1")
    expect(mocks.mockApplyImageWatermark).not.toHaveBeenCalled()
    expect(url).toBe("https://r2.example.com/images/test.png")
  })

  it("downloads, watermarks, and uploads buffer when watermark=true", async () => {
    // Mock global fetch for the image download
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    })
    vi.stubGlobal("fetch", mockFetch)

    const url = await uploadImageMaybeWatermark("https://source.com/img.png", "job-1", "user-1", true)
    expect(mocks.mockApplyImageWatermark).toHaveBeenCalled()
    expect(mocks.mockUploadBufferToR2).toHaveBeenCalledWith(
      Buffer.from("watermarked"),
      "images/job-1.png",
      "image/png",
      "user-1",
    )
    expect(url).toBe("https://r2.example.com/images/test-wm.png")

    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// createAssetFromJob
// ---------------------------------------------------------------------------

describe("createAssetFromJob", () => {
  it("skips when no userId", async () => {
    await createAssetFromJob("job-1", undefined)
    expect(mocks.mockFrom).not.toHaveBeenCalled()
  })

  it("skips when job is not completed", async () => {
    mocks.mockSingle.mockResolvedValueOnce({
      data: { status: "processing", output_data: { imageUrl: "https://r2.example.com/images/test.png" } },
      error: null,
    })
    await createAssetFromJob("job-1", "user-1")
    // Should query jobs but not insert assets
    expect(mocks.mockInsert).not.toHaveBeenCalled()
  })

  it("creates asset for completed job with imageUrl", async () => {
    mocks.mockSingle.mockResolvedValueOnce({
      data: { status: "completed", output_data: { imageUrl: "https://r2.example.com/images/test.png" } },
      error: null,
    })
    // Mock the duplicate check
    mocks.mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    await createAssetFromJob("job-1", "user-1")
    expect(mocks.mockInsert).toHaveBeenCalled()
  })

  it("skips duplicate assets", async () => {
    mocks.mockSingle.mockResolvedValueOnce({
      data: { status: "completed", output_data: { imageUrl: "https://r2.example.com/images/test.png" } },
      error: null,
    })
    // Mock the duplicate check — existing asset found
    mocks.mockMaybeSingle.mockResolvedValueOnce({ data: { id: "existing-asset" }, error: null })

    await createAssetFromJob("job-1", "user-1")
    expect(mocks.mockInsert).not.toHaveBeenCalled()
  })

  it("swallows errors", async () => {
    mocks.mockSingle.mockRejectedValueOnce(new Error("DB down"))
    await expect(createAssetFromJob("job-1", "user-1")).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// completeFfmpegVideoJob
// ---------------------------------------------------------------------------

describe("completeFfmpegVideoJob", () => {
  it("uploads, generates thumbnail, updates DB, and commits credits", async () => {
    // shouldSaveJobResult returns true
    mocks.mockSingle.mockResolvedValueOnce({ data: { status: "processing" }, error: null })

    await completeFfmpegVideoJob("/tmp/work/output.mp4", {
      jobId: "job-1",
      jobUserId: "user-1",
      usageLogId: "usage-1",
      shouldWatermark: false,
    })

    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/work/output.mp4", "job-1", "video", "user-1")
    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
    expect(mocks.mockGenerateThumbnailFromUrl).toHaveBeenCalled()
    expect(mocks.mockUpdate).toHaveBeenCalled()
    expect(mocks.mockCommitCredits).toHaveBeenCalledWith("usage-1")
  })

  it("skips DB update when job was cancelled", async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: { status: "cancelled" }, error: null })

    await completeFfmpegVideoJob("/tmp/work/output.mp4", {
      jobId: "job-1",
      jobUserId: "user-1",
      usageLogId: "usage-1",
      shouldWatermark: false,
    })

    expect(mocks.mockUploadFileToR2).toHaveBeenCalled()
    expect(mocks.mockUpdate).not.toHaveBeenCalled()
    expect(mocks.mockCommitCredits).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// completeFfmpegAudioJob
// ---------------------------------------------------------------------------

describe("completeFfmpegAudioJob", () => {
  it("uploads, updates DB, and commits credits", async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: { status: "processing" }, error: null })

    await completeFfmpegAudioJob("/tmp/work/output.mp3", {
      jobId: "job-1",
      jobUserId: "user-1",
      usageLogId: "usage-1",
      shouldWatermark: false,
    })

    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/work/output.mp3", "job-1", "audio", "user-1")
    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
    expect(mocks.mockUpdate).toHaveBeenCalled()
    expect(mocks.mockCommitCredits).toHaveBeenCalledWith("usage-1")
  })

  it("skips DB update when job was cancelled", async () => {
    mocks.mockSingle.mockResolvedValueOnce({ data: { status: "cancelled" }, error: null })

    await completeFfmpegAudioJob("/tmp/work/output.mp3", {
      jobId: "job-1",
      jobUserId: "user-1",
      usageLogId: "usage-1",
      shouldWatermark: false,
    })

    expect(mocks.mockUpdate).not.toHaveBeenCalled()
    expect(mocks.mockCommitCredits).not.toHaveBeenCalled()
  })
})
