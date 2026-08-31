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
  const jobsUpdateInMock = vi.fn().mockResolvedValue({ data: null, error: null })
  const jobsUpdateMock = vi.fn((_arg: Record<string, unknown>) => ({
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
  }))
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
    fetchMock, finalizeMock, refundMock, uploadBufferMock, jobsSingleMock, jobsUpdateMock, fromMock,
    markCompletedMock, shouldSaveMock, watermarkUploadMock, commitMock, createAssetMock, thumbnailMock, extractAudioMock,
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

describe("reconcileElevenLabsJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
