import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const fetchMock = vi.fn()
  const finalizeMock = vi.fn().mockResolvedValue({ ok: true })
  const refundMock = vi.fn().mockResolvedValue(undefined)
  const jobsSingleMock = vi.fn().mockResolvedValue({
    data: { reconcile_attempts: 0 },
    error: null,
  })
  const jobsSelectEqMock = vi.fn(() => ({ single: jobsSingleMock }))
  const jobsSelectMock = vi.fn(() => ({ eq: jobsSelectEqMock }))
  const jobsUpdateNeqMock = vi.fn().mockResolvedValue({ data: null, error: null })
  const jobsUpdateMock = vi.fn((_arg: Record<string, unknown>) => ({
    eq: vi.fn((col: string, _val: string) => {
      if (col === "id") {
        // markFailed now CAS-guards with .in("status",[...]) (M6-consistent),
        // older sites used .neq("status","cancelled") — support both terminals.
        return Object.assign(
          Promise.resolve({ data: null, error: null }),
          { neq: jobsUpdateNeqMock, in: jobsUpdateNeqMock },
        )
      }
      return { neq: jobsUpdateNeqMock, in: jobsUpdateNeqMock }
    }),
  }))
  const fromMock = vi.fn((_table: string) => ({
    select: jobsSelectMock,
    update: jobsUpdateMock,
  }))

  return {
    fetchMock,
    finalizeMock,
    refundMock,
    fromMock,
    jobsSingleMock,
    jobsUpdateMock,
  }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))
vi.mock("../../job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalizeMock }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundMock }))
vi.mock("../../config.js", () => ({ config: { REPLICATE_API_TOKEN: "test-token" } }))

import { reconcileReplicateJob, type ReplicateJobRow } from "../replicate.js"

describe("reconcileReplicateJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mocks.fetchMock as unknown as typeof fetch
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.jobsSingleMock.mockResolvedValue({ data: { reconcile_attempts: 0 }, error: null })
  })

  it("succeeded with output URL → finalizes with the URL", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "p-1",
        status: "succeeded",
        output: "https://replicate.example/result.png",
        metrics: { predict_time: 4.5 },
      }),
    })
    const row: ReplicateJobRow = {
      id: "j-r",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-1",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.finalizeMock).toHaveBeenCalledWith({
      jobId: "j-r",
      jobType: "generate-image",
      result: expect.objectContaining({
        url: "https://replicate.example/result.png",
        providerUsed: "replicate",
        providerMs: 4500,
      }),
    })
  })

  it("succeeded with output array → uses first URL + extras", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "p-2",
        status: "succeeded",
        output: ["https://r.example/v0.png", "https://r.example/v1.png"],
      }),
    })
    const row: ReplicateJobRow = {
      id: "j-r2",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-2",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.finalizeMock).toHaveBeenCalledWith({
      jobId: "j-r2",
      jobType: "generate-image",
      result: expect.objectContaining({
        url: "https://r.example/v0.png",
        extraUrls: ["https://r.example/v1.png"],
      }),
    })
  })

  it("failed status → markFailed + refund", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "p-fail",
        status: "failed",
        error: "model crashed",
      }),
    })
    const row: ReplicateJobRow = {
      id: "j-fail",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-fail",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-fail")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  it("canceled status → markFailed + refund", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "p-c", status: "canceled" }),
    })
    const row: ReplicateJobRow = {
      id: "j-c",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-c",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-c")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  it("starting status → bumpAttempts, no finalize, no refund", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "p-s", status: "starting" }),
    })
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: 3 },
      error: null,
    })
    const row: ReplicateJobRow = {
      id: "j-s",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-s",
      reconcile_attempts: 3,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_attempts: 4 }),
    )
  })

  it("fetch failure → bumpAttempts (HTTP error)", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    })
    const row: ReplicateJobRow = {
      id: "j-err",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-err",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.jobsUpdateMock).toHaveBeenCalled()
  })

  it("missing provider_task_id → no-op", async () => {
    const row: ReplicateJobRow = {
      id: "j-no",
      provider_kind: "replicate-prediction",
      provider_task_id: null,
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.fetchMock).not.toHaveBeenCalled()
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  it("replicate-training still-running → bumps attempts, no fetch character", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "processing" }),
    })
    const row: ReplicateJobRow = {
      id: "j-tr",
      provider_kind: "replicate-training",
      provider_task_id: "tr-1",
      reconcile_attempts: 0,
      job_type: "character-lora-training",
    }
    await reconcileReplicateJob(row)
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.fetchMock.mock.calls[0]![0]).toContain("/v1/trainings/tr-1")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("succeeded with no output → markFailed + refund", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "p-empty", status: "succeeded", output: null }),
    })
    const row: ReplicateJobRow = {
      id: "j-empty",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-empty",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileReplicateJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-empty")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  // P0.1 (audit Blocker B1): a poll-success-but-finalize-failure must bump
  // reconcile_attempts so a deterministic failure exhausts to refund+anomaly
  // instead of looping at every cron tick forever.
  it("succeeded but finalize throws → bumps reconcile_attempts, no markFailed, no refund, no propagation", async () => {
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "p-fin",
        status: "succeeded",
        output: ["https://replicate.example/out.png"],
      }),
    })
    mocks.finalizeMock.mockRejectedValueOnce(new Error("R2 upload failed"))
    const row: ReplicateJobRow = {
      id: "j-finalize-throw",
      provider_kind: "replicate-prediction",
      provider_task_id: "p-fin",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }

    await expect(reconcileReplicateJob(row)).resolves.toBeUndefined()

    expect(mocks.refundMock).not.toHaveBeenCalled()
    const bumpCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).reconcile_attempts === 1,
    )
    expect(bumpCall).toBeTruthy()
    const failCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )
    expect(failCall).toBeUndefined()
  })
})
