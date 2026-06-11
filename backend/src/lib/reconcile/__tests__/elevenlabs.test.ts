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
  const fromMock = vi.fn((_table: string) => ({
    select: jobsSelectMock,
    update: jobsUpdateMock,
  }))
  return { fetchMock, finalizeMock, refundMock, uploadBufferMock, jobsSingleMock, jobsUpdateMock, fromMock }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))
vi.mock("../../job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalizeMock }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundMock }))
vi.mock("../../storage.js", () => ({ uploadBufferToR2: mocks.uploadBufferMock }))
vi.mock("../../config.js", () => ({ config: { ELEVENLABS_API_KEY: "test-key" } }))

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
