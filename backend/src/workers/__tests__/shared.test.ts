import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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
  // Terminal `.select()` after a conditional UPDATE — used by markJobCompleted.
  // Default: 1-row response so the existing complete*Job tests treat the
  // conditional UPDATE as successful.
  const mockUpdateSelect = vi.fn().mockResolvedValue({ data: [{ id: "ok" }], error: null })
  const mockNeq = vi.fn().mockReturnValue({ select: mockUpdateSelect })
  const mockEq = vi.fn().mockReturnValue({
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    eq: vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockMaybeSingle }),
    neq: mockNeq,
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
    mockNeq,
    mockUpdateSelect,
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

vi.mock("@/ee/services/credits.js", () => ({
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

// uploadImageMaybeWatermark now uses safeFetch (DNS-aware SSRF gate) instead
// of global fetch; tests inject responses via vi.mocked(safeFetch).
vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: vi.fn(),
  isPrivateOrReservedIP: vi.fn(() => false),
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
  markJobCompleted,
  commitJobCredits,
  refundJobCredits,
  uploadImageMaybeWatermark,
  completeFfmpegVideoJob,
  completeFfmpegAudioJob,
  createAssetFromJob,
  setJobProgress,
  startProgressRamp,
  _resetJobProgressMap,
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
// markJobCompleted — atomic conditional UPDATE
// ---------------------------------------------------------------------------

describe("markJobCompleted", () => {
  // Each test installs its own mock supabase.from chain because the new
  // helper uses .update().eq().neq().select() which the shared mock above
  // doesn't terminate cleanly (it returns chainable objects, not a Promise).

  function installUpdateMock(updateResult: { data: unknown; error: unknown }): {
    update: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    neq: ReturnType<typeof vi.fn>
    select: ReturnType<typeof vi.fn>
  } {
    const select = vi.fn().mockResolvedValue(updateResult)
    const neq = vi.fn().mockReturnValue({ select })
    const eq = vi.fn().mockReturnValue({ neq })
    const update = vi.fn().mockReturnValue({ eq })
    mocks.mockFrom.mockReturnValueOnce({ update } as never)
    return { update, eq, neq, select }
  }

  it("returns true when the row was updated (status was not cancelled)", async () => {
    installUpdateMock({ data: [{ id: "job-1" }], error: null })

    const ok = await markJobCompleted("job-1", { output_data: { videoUrl: "x" } })
    expect(ok).toBe(true)
  })

  it("returns false when zero rows matched (regression: race with cancellation)", async () => {
    // The conditional UPDATE matched zero rows because the user cancelled the
    // job between the worker's pre-check and the UPDATE. Caller must skip
    // commitJobCredits — otherwise the user gets a free generation.
    installUpdateMock({ data: [], error: null })

    const ok = await markJobCompleted("job-1", { output_data: { videoUrl: "x" } })
    expect(ok).toBe(false)
  })

  it("returns false on supabase error (defensive — don't commit credits on DB failure)", async () => {
    installUpdateMock({ data: null, error: { message: "DB down" } })

    const ok = await markJobCompleted("job-1", { output_data: { videoUrl: "x" } })
    expect(ok).toBe(false)
  })

  it("uses .neq('status', 'cancelled') to gate the update atomically", async () => {
    const { eq, neq } = installUpdateMock({ data: [{ id: "job-1" }], error: null })

    await markJobCompleted("job-1", { output_data: {} })

    expect(eq).toHaveBeenCalledWith("id", "job-1")
    expect(neq).toHaveBeenCalledWith("status", "cancelled")
  })

  it("includes status, progress, and completed_at in the update payload", async () => {
    const { update } = installUpdateMock({ data: [{ id: "job-1" }], error: null })

    await markJobCompleted("job-1", { output_data: { videoUrl: "x" }, provider: "kie" })

    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload.status).toBe("completed")
    expect(payload.progress).toBe(100)
    expect(typeof payload.completed_at).toBe("string")
    expect(payload.output_data).toEqual({ videoUrl: "x" })
    expect(payload.provider).toBe("kie")
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
    "Generation failed. Please try again or contact support if the issue persists.",
    "createTask failed: 500 - Internal Server Error",
    "Invalid input parameters. Please check your settings and try again.",
    "Generation timed out. Please try again.",
    "cancelled",
  ])("refunds for pre-processing / provider creation error: %s", async (msg) => {
    await refundJobCredits("usage-log-1", "job-1", msg)
    expect(mocks.mockRefundCredits).toHaveBeenCalledWith("usage-log-1")
  })

  it.each([
    "Failed to upload to R2",
    "Upload to R2 failed for video",
    "R2 upload error: connection refused",
    "Failed to download image: 404",
    "Failed to download video: 500",
    "Watermark failed: ffmpeg exited with code 1",
    "Transcode failed: invalid codec",
    "ffmpeg failed after watermark step",
  ])("does NOT refund for post-processing failure: %s", async (msg) => {
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
    // safeFetch mock (replaces the previous globalThis.fetch stub) — covers
    // the watermark download path that now goes through the SSRF-safe fetch.
    const { safeFetch } = await import("../../lib/safe-fetch.js")
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as unknown as Response)

    const url = await uploadImageMaybeWatermark("https://source.com/img.png", "job-1", "user-1", true)
    expect(mocks.mockApplyImageWatermark).toHaveBeenCalled()
    expect(mocks.mockUploadBufferToR2).toHaveBeenCalledWith(
      Buffer.from("watermarked"),
      "images/job-1.png",
      "image/png",
      "user-1",
    )
    expect(url).toBe("https://r2.example.com/images/test-wm.png")
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

// ---------------------------------------------------------------------------
// setJobProgress — monotonic guard
// ---------------------------------------------------------------------------

describe("setJobProgress monotonic guard", () => {
  function makeJob(): { updateProgress: ReturnType<typeof vi.fn> & ((p: number) => Promise<void>) } {
    const fn = vi.fn(async (_p: number) => undefined as unknown as void)
    return { updateProgress: fn as ReturnType<typeof vi.fn> & ((p: number) => Promise<void>) }
  }

  beforeEach(() => {
    _resetJobProgressMap()
    mocks.mockUpdate.mockClear()
  })

  it("writes a forward progress value", async () => {
    const job = makeJob()
    await setJobProgress(job, "j-1", 30)
    expect(job.updateProgress).toHaveBeenCalledWith(30)
    expect(mocks.mockUpdate).toHaveBeenCalledWith({ progress: 30 })
  })

  it("drops a small backwards write within the regression window", async () => {
    const job = makeJob()
    await setJobProgress(job, "j-2", 30)
    await setJobProgress(job, "j-2", 12) // 18pt drop, < 25pt threshold
    expect(job.updateProgress).toHaveBeenCalledTimes(1)
    expect(job.updateProgress).toHaveBeenCalledWith(30)
  })

  it("accepts a large backwards write (treats as reset/retry)", async () => {
    const job = makeJob()
    await setJobProgress(job, "j-3", 50)
    await setJobProgress(job, "j-3", 5) // 45pt drop > 25pt threshold
    expect(job.updateProgress).toHaveBeenCalledTimes(2)
    expect(job.updateProgress).toHaveBeenLastCalledWith(5)
  })

  it("dedupes repeated identical writes", async () => {
    const job = makeJob()
    await setJobProgress(job, "j-4", 40)
    await setJobProgress(job, "j-4", 40)
    await setJobProgress(job, "j-4", 40)
    expect(job.updateProgress).toHaveBeenCalledTimes(1)
  })

  it("clears the in-memory entry on terminal 100%", async () => {
    const job = makeJob()
    await setJobProgress(job, "j-5", 100)
    // After the entry is cleared, the next backwards write goes through
    // without being suppressed (proves the map was reset).
    await setJobProgress(job, "j-5", 5)
    expect(job.updateProgress).toHaveBeenCalledTimes(2)
    expect(job.updateProgress).toHaveBeenLastCalledWith(5)
  })
})

// ---------------------------------------------------------------------------
// startProgressRamp — two-phase (linear → asymptotic)
// ---------------------------------------------------------------------------

describe("startProgressRamp two-phase ramp", () => {
  function makeJob(): { updateProgress: ReturnType<typeof vi.fn> & ((p: number) => Promise<void>) } {
    const fn = vi.fn(async (_p: number) => undefined as unknown as void)
    return { updateProgress: fn as ReturnType<typeof vi.fn> & ((p: number) => Promise<void>) }
  }

  beforeEach(() => {
    _resetJobProgressMap()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("climbs linearly to cap during phase 1", async () => {
    const job = makeJob()
    const ramp = startProgressRamp(job, "ramp-1", {
      start: 5,
      cap: 35,
      tickMs: 1000,
      tickStep: 10,
    })
    // Three ticks: 5 -> 15 -> 25 -> 35
    await vi.advanceTimersByTimeAsync(3100)
    const calls = job.updateProgress.mock.calls.map((c) => c[0])
    expect(calls).toEqual([15, 25, 35])
    ramp.stop()
  })

  it("keeps moving past cap via asymptotic phase 2 (no freeze)", async () => {
    const job = makeJob()
    const ramp = startProgressRamp(job, "ramp-2", {
      start: 5,
      cap: 35,
      tickMs: 500,
      tickStep: 10,
      softCeiling: 90,
      asymptoteFactor: 0.1,
    })
    // Phase 1 finishes after 3 ticks (15, 25, 35). Phase 2 kicks in: each
    // tick adds (90 - current) * 0.1, so the bar keeps climbing.
    await vi.advanceTimersByTimeAsync(20_000) // 40 ticks total
    const calls = job.updateProgress.mock.calls.map((c) => c[0])
    // Last value should be well past the old hard cap of 35 — proving the
    // bar didn't freeze.
    const last = calls[calls.length - 1]
    expect(last).toBeGreaterThan(60)
    // And below the soft ceiling — confirming asymptotic, not overshoot.
    expect(last).toBeLessThan(90)
    // Strictly monotonic — never goes backwards.
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]).toBeGreaterThanOrEqual(calls[i - 1] as number)
    }
    ramp.stop()
  })

  it("respects stop() — no further writes after stop", async () => {
    const job = makeJob()
    const ramp = startProgressRamp(job, "ramp-3", {
      start: 5,
      cap: 35,
      tickMs: 500,
      tickStep: 10,
    })
    await vi.advanceTimersByTimeAsync(1100) // 2 ticks
    const after2Ticks = job.updateProgress.mock.calls.length
    ramp.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(job.updateProgress.mock.calls.length).toBe(after2Ticks)
  })
})
