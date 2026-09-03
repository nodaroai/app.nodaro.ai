import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const fetchMock = vi.fn()
  const finalizeMock = vi.fn().mockResolvedValue({ ok: true })
  const refundMock = vi.fn().mockResolvedValue(undefined)
  const uploadBufferMock = vi.fn().mockResolvedValue("https://r2.example/audio/j1.mp3")
  // jobs select: handler reads user_id; bumpAttemptsOrExhaust reads
  // reconcile_attempts — one shape serves both.
  const jobsSingleMock = vi.fn().mockResolvedValue({
    data: { reconcile_attempts: 0, user_id: "u1" },
    error: null,
  })
  const jobsSelectEqMock = vi.fn(() => ({ single: jobsSingleMock }))
  const jobsSelectMock = vi.fn(() => ({ eq: jobsSelectEqMock }))
  // markJobFailed (lib/job-failure.ts) ends its CAS with `.select("id")` and
  // reads the returned rows to answer "did WE flip it?" — the mock must model
  // that or every migrated writer sees a lost race.
  const jobsUpdateCasSelectMock = vi.fn().mockResolvedValue({ data: [{ id: "j-1" }], error: null })
  const jobsUpdateInMock = vi.fn(() => ({ select: jobsUpdateCasSelectMock }))
  // G-7: capture every jobs.update(payload) so tests can assert on the exact
  // recorded update (lastJobsUpdate below), not just individual fields.
  const jobsUpdates: Array<Record<string, unknown>> = []
  const jobsUpdateMock = vi.fn((arg: Record<string, unknown>) => {
    jobsUpdates.push(arg)
    return {
      eq: vi.fn((col: string, _val: string) => {
        if (col === "id") {
          // bumpAttempts awaits .update().eq(); markFailed chains .in([...]).
          return Object.assign(
            Promise.resolve({ data: null, error: null }),
            { in: jobsUpdateInMock },
          )
        }
        return { in: jobsUpdateInMock }
      }),
    }
  })
  // usage_logs: deliver's video path loads the reserved usage log itself
  // (.select().eq().eq().limit() chain).
  const usageLogsLimitMock = vi.fn().mockResolvedValue({ data: [{ id: "ul-1" }], error: null })
  const usageLogsChain = { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ limit: usageLogsLimitMock })) })) })) }
  const fromMock = vi.fn((table: string) => (
    table === "usage_logs" ? usageLogsChain : {
      select: jobsSelectMock,
      update: jobsUpdateMock,
    }
  ))
  const markCompletedMock = vi.fn().mockResolvedValue(true)
  const shouldSaveMock = vi.fn().mockResolvedValue(true)
  const watermarkUploadMock = vi.fn().mockResolvedValue("https://r2.example/video/j1.mp4")
  const commitMock = vi.fn().mockResolvedValue(undefined)
  const createAssetMock = vi.fn().mockResolvedValue(undefined)
  const thumbnailMock = vi.fn().mockResolvedValue("https://r2.example/thumb.png")
  const extractAudioMock = vi.fn().mockResolvedValue({ audioPath: "/tmp/x/audio.mp3", workDir: "/tmp/x" })
  return {
    fetchMock, finalizeMock, refundMock, uploadBufferMock, jobsSingleMock, jobsUpdateMock, jobsUpdateInMock, fromMock,
    markCompletedMock, shouldSaveMock, watermarkUploadMock, commitMock, createAssetMock, thumbnailMock, extractAudioMock,
    jobsUpdates,
  }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))
vi.mock("../../job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalizeMock }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundMock }))
vi.mock("../../storage.js", () => ({ uploadBufferToR2: mocks.uploadBufferMock, mediaObjectKey: (id: string, type: string, ext: string) => `${type}s/${id}.${ext}` }))
vi.mock("../../config.js", () => ({ config: { ELEVENLABS_API_KEY: "test-key" } }))
// Video-path deps of the shared deliver helper (audio path never touches these).
vi.mock("../../../workers/shared.js", () => ({
  commitJobCredits: mocks.commitMock,
  markJobCompleted: mocks.markCompletedMock,
  shouldSaveJobResult: mocks.shouldSaveMock,
  generateAndUploadThumbnail: mocks.thumbnailMock,
  createAssetFromJob: mocks.createAssetMock,
  watermarkLocalVideoAndUpload: mocks.watermarkUploadMock,
}))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn().mockResolvedValue("/tmp/dub-rec"),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../../providers/video/extract-audio-track.js", () => ({ extractAudioTrack: mocks.extractAudioMock }))
vi.mock("node:fs", () => ({ promises: { readFile: vi.fn().mockResolvedValue(Buffer.from("aud")), writeFile: vi.fn().mockResolvedValue(undefined) } }))

import { reconcileElevenLabsJob, type ElevenLabsJobRow } from "../elevenlabs.js"

function row(overrides: Partial<ElevenLabsJobRow> = {}): ElevenLabsJobRow {
  return {
    id: "j-el-1",
    provider_kind: "elevenlabs-async",
    provider_task_id: "dub-1",
    reconcile_attempts: 0,
    job_type: "text-to-audio",
    input_data: { targetLanguage: "en" },
    ...overrides,
  }
}

/** First fetch = dubbing metadata; second fetch = audio bytes. */
function mockDubbedFetches() {
  mocks.fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ dubbing_id: "dub-1", status: "dubbed", target_languages: ["en"] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })
}

// G-7 harness accessor (did not exist before this task).
const lastJobsUpdate = (): Record<string, unknown> => mocks.jobsUpdates.at(-1) ?? {}

describe("reconcileElevenLabsJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.jobsUpdates.length = 0
    global.fetch = mocks.fetchMock as unknown as typeof fetch
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.uploadBufferMock.mockResolvedValue("https://r2.example/audio/j1.mp3")
    mocks.jobsSingleMock.mockResolvedValue({
      data: { reconcile_attempts: 0, user_id: "u1" },
      error: null,
    })
  })

  it("dubbed → uploads to R2 and finalizes with the R2 URL", async () => {
    mockDubbedFetches()
    await reconcileElevenLabsJob(row())
    expect(mocks.uploadBufferMock).toHaveBeenCalledTimes(1)
    expect(mocks.finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j-el-1", mediaUrl: "https://r2.example/audio/j1.mp3" }),
    )
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  // P0.1 (audit Blocker B1): post-poll failures must bump reconcile_attempts
  // so deterministic failures exhaust (refund + anomaly) instead of looping
  // at every cron tick forever.
  it("R2 upload throws → bumps reconcile_attempts, no finalize, no refund, no propagation", async () => {
    mockDubbedFetches()
    // Generic transient failure — NOT upload-size-exceeded, which is now a
    // DETERMINISTIC error that fast-fails on the first bump (see
    // bump-attempts.test.ts).
    mocks.uploadBufferMock.mockRejectedValueOnce(new Error("R2 503: service unavailable"))

    await expect(reconcileElevenLabsJob(row())).resolves.toBeUndefined()

    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    const bumpCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).reconcile_attempts === 1,
    )
    expect(bumpCall).toBeTruthy()
  })

  it("VIDEO dub (media_metadata content_type video/*) → .mp4 Accept, video delivery, NO cron watermark", async () => {
    mocks.fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          dubbing_id: "dub-1", status: "dubbed", target_languages: ["en"],
          media_metadata: { content_type: "video/mp4", duration: 90 },
        }),
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })

    await reconcileElevenLabsJob(row({ input_data: { targetLanguage: "en", videoUrl: "https://x/clip.mp4" } }))

    // The media download asked for video.
    const dl = mocks.fetchMock.mock.calls[1]
    expect((dl[1] as { headers: Record<string, string> }).headers.Accept).toBe("video/mp4")
    // Cron-recovered video skips the free-tier watermark (KIE reconcile precedent).
    expect(mocks.watermarkUploadMock).toHaveBeenCalledWith(expect.stringContaining("dubbed.mp4"), "j-el-1", "u1", false)
    // Same output shape the worker delivers: video + audio sidecar + thumbnail.
    expect(mocks.markCompletedMock).toHaveBeenCalledWith("j-el-1", {
      output_data: expect.objectContaining({
        videoUrl: "https://r2.example/video/j1.mp4",
        audioUrl: "https://r2.example/audio/j1.mp3",
        thumbnailUrl: "https://r2.example/thumb.png",
      }),
    })
    expect(mocks.commitMock).toHaveBeenCalledWith("ul-1", "j-el-1")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("finalize throws → bumps reconcile_attempts, no refund, no propagation", async () => {
    mockDubbedFetches()
    mocks.finalizeMock.mockRejectedValueOnce(new Error("DB blip"))

    await expect(reconcileElevenLabsJob(row())).resolves.toBeUndefined()

    expect(mocks.refundMock).not.toHaveBeenCalled()
    const bumpCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).reconcile_attempts === 1,
    )
    expect(bumpCall).toBeTruthy()
  })

  // Task 2 (app-reports W4): jobs.error_message is user-visible — it must never
  // carry raw provider text. The raw text belongs in error_detail (admin-only),
  // redacted through redactProviderDetail. The failed branch returns before the
  // audio download, so only one fetch (dubbing metadata) is needed.
  it("dubbing failed → puts a user-safe sentence in error_message and the raw provider text in error_detail", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        dubbing_id: "dub-1",
        status: "failed",
        error: "source rejected https://api.elevenlabs.io/v1/x?key=zz",
      }),
    })

    await reconcileElevenLabsJob(row({ id: "j-el-fail" }))

    const update = lastJobsUpdate()
    expect(update.status).toBe("failed")
    expect(update.error_message).toBe("Generation failed on the provider. Please try again.")
    expect(update.error_message).not.toContain("source rejected")
    expect(update.error_detail).toContain("source rejected")
    expect(update.error_detail).not.toContain("key=zz")
    expect(mocks.refundMock).toHaveBeenCalledWith("j-el-fail")
    // Spec D11: the shared markJobFailed CAS. "queued" is newly failable (these
    // sweeps could not take a queued row at all before); "pending_review" is
    // absent BY CONSTRUCTION, so no reconcile tick can fail a job under review.
    expect(mocks.jobsUpdateInMock).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
  })
})
