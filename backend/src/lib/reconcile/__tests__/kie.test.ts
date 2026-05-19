import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const pollKieTaskMock = vi.fn()
  const pollVeoTaskMock = vi.fn()
  const pollKling3TaskMock = vi.fn()
  const pollKontextTaskMock = vi.fn()
  const pollLumaTaskMock = vi.fn()
  const pollRunwayTaskMock = vi.fn()
  const pollAlephTaskMock = vi.fn()
  const finalizeMock = vi.fn().mockResolvedValue({ ok: true })
  const refundMock = vi.fn().mockResolvedValue(undefined)

  // KieError subclass — matches the real one's name property so the runtime
  // check `err instanceof KieError` works inside the handler.
  class FakeKieError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "KieError"
    }
  }

  // Supabase chain — supports both SELECT (for bumpAttempts) and UPDATE
  // (for bumpAttempts + markFailed). Per-table dispatch.
  const jobsSingleMock = vi.fn().mockResolvedValue({
    data: { reconcile_attempts: 0 },
    error: null,
  })
  const jobsSelectEqMock = vi.fn(() => ({ single: jobsSingleMock }))
  const jobsSelectMock = vi.fn(() => ({ eq: jobsSelectEqMock }))

  const jobsUpdateNeqMock = vi.fn().mockResolvedValue({ data: null, error: null })
  const jobsUpdateEqMock = vi.fn(() => ({
    neq: jobsUpdateNeqMock,
    // For bumpAttempts, the chain ends at .eq() — no .neq()
    then: undefined,
  }))
  // Mock the chain for bumpAttempts (.update().eq()) and markFailed (.update().eq().neq())
  // by returning a thenable that resolves directly when awaited.
  const jobsUpdateMock = vi.fn((arg: Record<string, unknown>) => {
    void arg
    return {
      eq: vi.fn((col: string, val: string) => {
        if (col === "id") {
          // Return an object that has both .neq() (for markFailed) and is awaitable (for bumpAttempts)
          return Object.assign(
            Promise.resolve({ data: null, error: null }) as Promise<{ data: null; error: null }> & { neq: typeof jobsUpdateNeqMock },
            { neq: jobsUpdateNeqMock },
          )
        }
        return { neq: jobsUpdateNeqMock }
      }),
    }
  })

  const fromMock = vi.fn((_table: string) => ({
    select: jobsSelectMock,
    update: jobsUpdateMock,
  }))

  return {
    pollKieTaskMock,
    pollVeoTaskMock,
    pollKling3TaskMock,
    pollKontextTaskMock,
    pollLumaTaskMock,
    pollRunwayTaskMock,
    pollAlephTaskMock,
    finalizeMock,
    refundMock,
    FakeKieError,
    jobsUpdateMock,
    jobsUpdateNeqMock,
    fromMock,
    jobsSingleMock,
  }
})

vi.mock("../../supabase.js", () => ({
  supabase: { from: mocks.fromMock },
}))

vi.mock("../../../providers/kie/client.js", () => ({
  pollKieTask: mocks.pollKieTaskMock,
  pollVeoTask: mocks.pollVeoTaskMock,
  KieError: mocks.FakeKieError,
}))

vi.mock("../../../providers/kie/kling3-client.js", () => ({
  pollKling3Task: mocks.pollKling3TaskMock,
}))

vi.mock("../../../providers/kie/kontext-client.js", () => ({
  pollKontextTask: mocks.pollKontextTaskMock,
}))

vi.mock("../../../providers/kie/luma-client.js", () => ({
  pollLumaTask: mocks.pollLumaTaskMock,
}))

vi.mock("../../../providers/kie/runway-client.js", () => ({
  pollRunwayTask: mocks.pollRunwayTaskMock,
  pollAlephTask: mocks.pollAlephTaskMock,
}))

vi.mock("../../job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.finalizeMock,
}))

vi.mock("../../credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: mocks.refundMock,
}))

import { reconcileKieJob, type KieJobRow } from "../kie.js"

describe("reconcileKieJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.refundMock.mockResolvedValue(undefined)
    mocks.jobsSingleMock.mockResolvedValue({ data: { reconcile_attempts: 0 }, error: null })
  })

  it("kie-standard success → calls finalizeJobWithMedia with the polled result URL", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce({
      resultJson: { resultUrls: ["https://kie.example/result.png"] },
      providerMs: 1234,
      taskId: "t1",
    })
    const row: KieJobRow = {
      id: "j-success",
      provider_kind: "kie-standard",
      provider_task_id: "t1",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileKieJob(row)
    expect(mocks.finalizeMock).toHaveBeenCalledWith({
      jobId: "j-success",
      jobType: "generate-image",
      result: expect.objectContaining({
        url: "https://kie.example/result.png",
        extraUrls: [],
        providerMs: 1234,
      }),
    })
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("kie-veo success → uses pollVeoTask + finalize with the resultUrls", async () => {
    mocks.pollVeoTaskMock.mockResolvedValueOnce({
      resultUrls: ["https://veo.example/clip.mp4"],
      providerMs: 30000,
    })
    const row: KieJobRow = {
      id: "j-veo",
      provider_kind: "kie-veo",
      provider_task_id: "t-veo",
      reconcile_attempts: 0,
      job_type: "image-to-video",
    }
    await reconcileKieJob(row)
    expect(mocks.pollVeoTaskMock).toHaveBeenCalledWith("t-veo", "VEO")
    expect(mocks.finalizeMock).toHaveBeenCalled()
  })

  it("kie-kling3 success → uses pollKling3Task and finalizes", async () => {
    mocks.pollKling3TaskMock.mockResolvedValueOnce("https://kling.example/v.mp4")
    const row: KieJobRow = {
      id: "j-kling3",
      provider_kind: "kie-kling3",
      provider_task_id: "t-kling",
      reconcile_attempts: 0,
      job_type: "image-to-video",
    }
    await reconcileKieJob(row)
    expect(mocks.pollKling3TaskMock).toHaveBeenCalledWith("t-kling")
    expect(mocks.finalizeMock).toHaveBeenCalled()
  })

  it("upstream failure (KieError 'task failed') → markFailed + refund, no finalize", async () => {
    mocks.pollKieTaskMock.mockRejectedValueOnce(
      new mocks.FakeKieError("task failed: [content_policy] Content policy violation"),
    )
    const row: KieJobRow = {
      id: "j-failed",
      provider_kind: "kie-standard",
      provider_task_id: "t-failed",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileKieJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-failed")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  it("still-running (timeout error) → bumps reconcile_attempts, no finalize, no refund", async () => {
    mocks.pollKieTaskMock.mockRejectedValueOnce(
      new Error("task timed out after 1 poll attempts"),
    )
    const row: KieJobRow = {
      id: "j-pending",
      provider_kind: "kie-standard",
      provider_task_id: "t-pending",
      reconcile_attempts: 5,
      job_type: "generate-image",
    }
    mocks.jobsSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: 5 },
      error: null,
    })
    await reconcileKieJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    // bumpAttempts read the current value + wrote +1
    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_attempts: 6 }),
    )
  })

  it("missing provider_task_id → no-op (returns without polling)", async () => {
    const row: KieJobRow = {
      id: "j-no-task",
      provider_kind: "kie-standard",
      provider_task_id: null,
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileKieJob(row)
    expect(mocks.pollKieTaskMock).not.toHaveBeenCalled()
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("unknown provider_kind → bumps attempts, no failure marked", async () => {
    const row: KieJobRow = {
      id: "j-unknown",
      provider_kind: "kie-mysterious",
      provider_task_id: "t-1",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileKieJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.jobsUpdateMock).toHaveBeenCalled()
  })

  it("kie-suno → bumps attempts (Suno reconcile deferred)", async () => {
    const row: KieJobRow = {
      id: "j-suno",
      provider_kind: "kie-suno",
      provider_task_id: "t-suno",
      reconcile_attempts: 0,
      job_type: "generate-music",
    }
    await reconcileKieJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.jobsUpdateMock).toHaveBeenCalled()
  })
})
