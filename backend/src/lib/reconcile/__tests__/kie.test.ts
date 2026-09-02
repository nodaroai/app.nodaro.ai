import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const pollKieTaskMock = vi.fn()
  const pollVeoTaskMock = vi.fn()
  const runVeo1080pTaskMock = vi.fn()
  const pollKling3TaskMock = vi.fn()
  const pollKontextTaskMock = vi.fn()
  const pollLumaTaskMock = vi.fn()
  const pollRunwayTaskMock = vi.fn()
  const pollAlephTaskMock = vi.fn()
  const pollSunoTaskMock = vi.fn()
  const uploadToR2Mock = vi.fn()
  const finalizeMock = vi.fn().mockResolvedValue({ ok: true })
  const refundMock = vi.fn().mockResolvedValue(undefined)

  // KieError subclass — matches the real one's name property so the runtime
  // check `err instanceof KieError` works inside the handler.
  class FakeKieError extends Error {
    isUpstreamFailure: boolean
    internalDetails: string
    constructor(message: string, isUpstreamFailure = false, internalDetails = "task failed: [500] raw provider text") {
      super(message)
      this.name = "KieError"
      this.isUpstreamFailure = isUpstreamFailure
      this.internalDetails = internalDetails
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

  const jobsUpdateInMock = vi.fn().mockResolvedValue({ data: null, error: null })
  const jobsUpdateEqMock = vi.fn(() => ({
    in: jobsUpdateInMock,
    // For bumpAttempts, the chain ends at .eq() — no .in()
    then: undefined,
  }))
  // Mock the chain for bumpAttempts (.update().eq()) and markFailed
  // (.update().eq().in(["pending","processing"])) by returning a thenable that
  // resolves directly when awaited.
  const jobsUpdateMock = vi.fn((arg: Record<string, unknown>) => {
    void arg
    return {
      eq: vi.fn((col: string, val: string) => {
        if (col === "id") {
          // Return an object that has both .in() (for markFailed) and is awaitable (for bumpAttempts)
          return Object.assign(
            Promise.resolve({ data: null, error: null }) as Promise<{ data: null; error: null }> & { in: typeof jobsUpdateInMock },
            { in: jobsUpdateInMock },
          )
        }
        return { in: jobsUpdateInMock }
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
    runVeo1080pTaskMock,
    pollKling3TaskMock,
    pollKontextTaskMock,
    pollLumaTaskMock,
    pollRunwayTaskMock,
    pollAlephTaskMock,
    pollSunoTaskMock,
    uploadToR2Mock,
    finalizeMock,
    refundMock,
    FakeKieError,
    jobsUpdateMock,
    jobsUpdateInMock,
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
  runVeo1080pTask: mocks.runVeo1080pTaskMock,
  KieError: mocks.FakeKieError,
  isUpstreamKieFailure: (err: unknown) =>
    err instanceof mocks.FakeKieError && err.isUpstreamFailure,
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

vi.mock("../../../providers/kie/suno-client.js", () => ({
  pollSunoTask: mocks.pollSunoTaskMock,
}))

vi.mock("../../storage.js", () => ({
  uploadToR2: mocks.uploadToR2Mock,
  uploadBufferToR2: vi.fn(),
  uploadFileToR2: vi.fn(),
  uploadFileWithKeyToR2: vi.fn(),
}))

vi.mock("../../job-finalize.js", async (importOriginal) => {
  // isFinalizeJobType + NOT_GENERIC_RECOVERABLE are pure lookups over static
  // sets — keep the REAL ones so the narrowing under test is the real thing,
  // not a re-declared copy that could drift from job-finalize.ts.
  const actual = await importOriginal<typeof import("../../job-finalize.js")>()
  return {
    ...actual,
    finalizeJobWithMedia: mocks.finalizeMock,
  }
})

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
      // Claimant identity (audit H1): the cron must claim as "cron" so it
      // never steals a live worker's fresh claim (and vice versa), while a
      // stall re-pick (inline reconcile, claimant "worker") can immediately
      // re-claim its own crashed predecessor's claim.
      claimant: "cron",
      result: expect.objectContaining({
        url: "https://kie.example/result.png",
        extraUrls: [],
        providerMs: 1234,
      }),
    })
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("inline (stall re-pick) caller: claimant 'worker' is threaded through to finalize", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce({
      resultJson: { resultUrls: ["https://kie.example/result.png"] },
      providerMs: 99,
      taskId: "t-inline",
    })
    const row: KieJobRow = {
      id: "j-inline",
      provider_kind: "kie-standard",
      provider_task_id: "t-inline",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }
    await reconcileKieJob(row, { claimant: "worker" })
    expect(mocks.finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ claimant: "worker" }),
    )
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

  it("kie-aleph success → uses pollAlephTask and finalizes", async () => {
    // Reconcile blind-spot regression: runway-aleph used to be tagged
    // `kie-standard`, which routed singlePoll to the wrong endpoint and
    // force-failed every stuck Aleph row after 18 attempts.
    mocks.pollAlephTaskMock.mockResolvedValueOnce("https://aleph.example/v.mp4")
    const row: KieJobRow = {
      id: "j-aleph",
      provider_kind: "kie-aleph",
      provider_task_id: "t-aleph",
      reconcile_attempts: 0,
      job_type: "video-to-video",
    }
    await reconcileKieJob(row)
    expect(mocks.pollAlephTaskMock).toHaveBeenCalledWith("t-aleph")
    expect(mocks.pollKieTaskMock).not.toHaveBeenCalled()
    expect(mocks.finalizeMock).toHaveBeenCalled()
  })

  it("kie-veo-1080p success → re-calls runVeo1080pTask with parent kieTaskId", async () => {
    // The 1080p endpoint reuses the original VEO task's id (no separate
    // 1080p task is created). singlePoll uses runVeo1080pTask which retries
    // internally; here we just verify the dispatch.
    mocks.runVeo1080pTaskMock.mockResolvedValueOnce({ url: "https://veo.example/1080p.mp4" })
    const row: KieJobRow = {
      id: "j-veo1080",
      provider_kind: "kie-veo-1080p",
      provider_task_id: "parent-veo-id",
      reconcile_attempts: 0,
      job_type: "video-upscale",
    }
    await reconcileKieJob(row)
    expect(mocks.runVeo1080pTaskMock).toHaveBeenCalledWith("parent-veo-id")
    expect(mocks.finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j-veo1080",
        jobType: "video-upscale",
        result: expect.objectContaining({ url: "https://veo.example/1080p.mp4" }),
      }),
    )
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

  it("upstream failure (KieError with upstreamFailure flag) → markFailed + refund, no finalize", async () => {
    // Regression: the REAL KieError.message is SANITIZED (e.g. the generic
    // "Generation failed…"), so the old `err.message.includes("task failed")`
    // check never matched and reconcile bumped a TERMINAL failure toward the
    // 18-attempt / 90-min exhaustion (the seedance-2 r2v incident). Classify
    // off the structured `upstreamFailure` flag, never the sanitized message.
    mocks.pollKieTaskMock.mockRejectedValueOnce(
      new mocks.FakeKieError(
        "Generation failed. Please try again or contact support if the issue persists.",
        true, // structured terminal-failure flag (NOT the sanitized message)
      ),
    )
    const row: KieJobRow = {
      id: "j-failed",
      provider_kind: "kie-standard",
      provider_task_id: "t-failed",
      reconcile_attempts: 0,
      job_type: "image-to-video",
    }
    await reconcileKieJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-failed")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    // W0: the redacted raw provider text rides along with the sanitized reason.
    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error_detail: expect.any(String) }),
    )
  })

  it("kie-veo upstream failure → markFailed + refund (fail-fast for non-kie-standard kinds)", async () => {
    // The shared isUpstreamKieFailure must fail-fast for EVERY poll client, not
    // just kie-standard — VEO/Kling-3/Kontext/Luma/Runway/Aleph terminal failures
    // previously rode to the 90-min exhaustion because only the sanitized message
    // was inspected.
    mocks.pollVeoTaskMock.mockRejectedValueOnce(
      new mocks.FakeKieError("Generation failed. Please try again or contact support.", true),
    )
    const row: KieJobRow = {
      id: "j-veo-failed",
      provider_kind: "kie-veo",
      provider_task_id: "t-veo-failed",
      reconcile_attempts: 0,
      job_type: "image-to-video",
    }
    await reconcileKieJob(row)
    expect(mocks.refundMock).toHaveBeenCalledWith("j-veo-failed")
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

  it("kie-suno with unrecoverable variant (job_type=suno-lyrics) → bumps attempts", async () => {
    const row: KieJobRow = {
      id: "j-suno-lyrics",
      provider_kind: "kie-suno",
      provider_task_id: "t-suno",
      reconcile_attempts: 0,
      job_type: "suno-lyrics",
    }
    await reconcileKieJob(row)
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.jobsUpdateMock).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Post-poll failures MUST bump reconcile_attempts (P0.1, audit Blocker B1).
  // Before this, a poll-success-but-finalize-failure propagated to the cron's
  // per-row catch (errors++ only) — a deterministic upload failure looped at
  // every tick FOREVER: charged user, credits stranded `reserved`, no refund,
  // no anomaly row. Bumping routes it into the 18-attempt exhaustion path
  // (forceFailExhausted → refund + credit_anomalies), which terminates.
  // -------------------------------------------------------------------------
  it("kie-standard: finalize throws → bumps reconcile_attempts, no markFailed, no refund, no propagation", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce({
      resultJson: { resultUrls: ["https://kie.example/r.png"] },
      providerMs: 1000,
      taskId: "t-fin",
    })
    mocks.finalizeMock.mockRejectedValueOnce(new Error("R2 upload failed"))
    const row: KieJobRow = {
      id: "j-finalize-throw",
      provider_kind: "kie-standard",
      provider_task_id: "t-fin",
      reconcile_attempts: 0,
      job_type: "generate-image",
    }

    await expect(reconcileKieJob(row)).resolves.toBeUndefined()

    expect(mocks.refundMock).not.toHaveBeenCalled()
    const bumpCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).reconcile_attempts === 1,
    )
    expect(bumpCall).toBeTruthy()
    expect(String((bumpCall![0] as Record<string, unknown>).reconcile_last_error)).toContain(
      "R2 upload failed",
    )
    const failCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )
    expect(failCall).toBeUndefined()
  })

  it("kie-suno music success → finalizes with providerUsed 'kie', matching the worker path (#753)", async () => {
    mocks.pollSunoTaskMock.mockResolvedValueOnce({
      taskId: "t-suno-ok",
      tracks: [
        { id: "tr1", title: "Track", duration: 30, imageUrl: "", audioUrl: "https://suno.example/a.mp3" },
      ],
    })
    mocks.uploadToR2Mock.mockResolvedValueOnce("https://r2.example/audio/j-suno-ok.mp3")
    mocks.finalizeMock.mockResolvedValueOnce({ ok: true })
    const row: KieJobRow = {
      id: "j-suno-ok",
      provider_kind: "kie-suno",
      provider_task_id: "t-suno-ok",
      reconcile_attempts: 0,
      job_type: "suno-generate",
    }

    await reconcileKieJob(row)

    expect(mocks.finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j-suno-ok",
        // The SERVING provider — the same value the worker's KIE path writes.
        // "suno" here used to split attribution across three values.
        result: expect.objectContaining({ providerUsed: "kie" }),
      }),
    )
  })

  it("kie-suno music: track upload throws → bumps reconcile_attempts, no finalize, no refund", async () => {
    mocks.pollSunoTaskMock.mockResolvedValueOnce({
      taskId: "t-suno-up",
      tracks: [
        { id: "tr1", title: "Track", duration: 30, imageUrl: "", audioUrl: "https://suno.example/a.mp3" },
      ],
    })
    // Generic transient failure — upload-size-exceeded now fast-fails
    // deterministically on the first bump (bump-attempts.test.ts).
    mocks.uploadToR2Mock.mockRejectedValueOnce(new Error("R2 503: service unavailable"))
    const row: KieJobRow = {
      id: "j-suno-upload-throw",
      provider_kind: "kie-suno",
      provider_task_id: "t-suno-up",
      reconcile_attempts: 0,
      job_type: "suno-generate",
    }

    await expect(reconcileKieJob(row)).resolves.toBeUndefined()

    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    const bumpCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).reconcile_attempts === 1,
    )
    expect(bumpCall).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// pollAttempts threading (stall-guard resume polling, incident 2026-07-15)
// ---------------------------------------------------------------------------
//
// The worker's stall re-pick (inline reconcile) runs INSIDE a live BullMQ
// handler, so it can afford to RESUME polling a still-running upstream task
// with a full attempt budget instead of the cron's one-shot probe. Without
// this, a job re-picked while the provider is still generating gets one
// failed probe, a bumped attempt counter, and then waits for the cron's
// 20-minute staleness threshold — the exact UX hole the drain fix closes.
describe("reconcileKieJob pollAttempts threading", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.jobsSingleMock.mockResolvedValue({ data: { reconcile_attempts: 0 }, error: null })
  })

  const successPoll = {
    resultJson: { resultUrls: ["https://kie.example/r.png"] },
    taskId: "t-poll",
  }

  it("kie-standard: opts.pollAttempts is forwarded to pollKieTask", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce(successPoll)
    await reconcileKieJob(
      { id: "j-pa", provider_kind: "kie-standard", provider_task_id: "t-pa", reconcile_attempts: 0, job_type: "generate-image" },
      { claimant: "worker", pollAttempts: 120 },
    )
    expect(mocks.pollKieTaskMock).toHaveBeenCalledWith("t-pa", 120)
  })

  it("kie-standard: defaults to a single probe when opts.pollAttempts is absent (cron path unchanged)", async () => {
    mocks.pollKieTaskMock.mockResolvedValueOnce(successPoll)
    await reconcileKieJob(
      { id: "j-pa-default", provider_kind: "kie-standard", provider_task_id: "t-pa1", reconcile_attempts: 0, job_type: "generate-image" },
    )
    expect(mocks.pollKieTaskMock).toHaveBeenCalledWith("t-pa1", 1)
  })

  it("kie-kontext + kie-luma: pollAttempts forwarded to their pollers too", async () => {
    mocks.pollKontextTaskMock.mockResolvedValueOnce(successPoll)
    await reconcileKieJob(
      { id: "j-kontext", provider_kind: "kie-kontext", provider_task_id: "t-k", reconcile_attempts: 0, job_type: "generate-image" },
      { claimant: "worker", pollAttempts: 60 },
    )
    expect(mocks.pollKontextTaskMock).toHaveBeenCalledWith("t-k", 60)

    mocks.pollLumaTaskMock.mockResolvedValueOnce(successPoll)
    await reconcileKieJob(
      { id: "j-luma", provider_kind: "kie-luma", provider_task_id: "t-l", reconcile_attempts: 0, job_type: "image-to-video" },
      { claimant: "worker", pollAttempts: 60 },
    )
    expect(mocks.pollLumaTaskMock).toHaveBeenCalledWith("t-l", 60)
  })
})

// ---------------------------------------------------------------------------
// NOT_GENERIC_RECOVERABLE (Task 4, B2b): DAG-node-type, entity-handler, and
// unknown/NULL job_type rows must bump reconcile_attempts with a NAMED reason
// instead of being cast into finalizeJobWithMedia (the old
// `(row.job_type ?? "generate-image") as FinalizeJobType`), which threw
// "unknown jobType" and rode the exhaustion path to a bogus refund.
//
// G-7 harness note: this file has no `bumpMock`/`lastBumpReason` — only
// fal.test.ts mocks `../bump-attempts.js`. Rather than invent a second,
// parallel bump-attempts harness here, `bumpAttemptsOrExhaust` stays the REAL
// implementation (as it already is for every other test in this file) and
// `lastBumpReason` reads the reason back off the same `jobsUpdateMock` every
// other test in this file already asserts against.
// ---------------------------------------------------------------------------
describe("NOT_GENERIC_RECOVERABLE rows", () => {
  const row = (over: Partial<KieJobRow> = {}): KieJobRow => ({
    id: "j-row",
    provider_kind: "kie-standard",
    provider_task_id: "t-row",
    reconcile_attempts: 0,
    job_type: "generate-image",
    ...over,
  })

  const lastJobsUpdate = (): Record<string, unknown> =>
    (mocks.jobsUpdateMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined) ?? {}

  const lastBumpReason = (): string => {
    const last = lastJobsUpdate()
    return typeof last.reconcile_last_error === "string" ? last.reconcile_last_error : ""
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.refundMock.mockResolvedValue(undefined)
    mocks.jobsSingleMock.mockResolvedValue({ data: { reconcile_attempts: 0 }, error: null })
    // The guard sits AFTER the poll (M-4a), so every test here except the
    // "still fails fast" one needs the poll to succeed to reach it.
    mocks.pollKieTaskMock.mockResolvedValue({
      resultJson: { resultUrls: ["https://kie.example/should-not-reach-finalize.png"] },
      providerMs: 100,
      taskId: "t-default",
    })
  })

  it("bumps with a named reason instead of calling finalize for a DAG character row", async () => {
    await reconcileKieJob(row({
      id: "job-dag-char",
      provider_kind: "kie-standard",
      provider_task_id: "task-dag-char",
      job_type: "character",
    }))
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    // The poll DOES run — the guard sits after it on purpose (M-4a), so a
    // genuinely-failed provider task still fails fast + refunds on tick 1.
    expect(mocks.pollKieTaskMock).toHaveBeenCalled()
    expect(lastBumpReason()).toMatch(/not generically recoverable: character/)
  })

  it("still fails fast and refunds when the provider task itself failed", async () => {
    mocks.pollKieTaskMock.mockRejectedValue(
      new mocks.FakeKieError("Generation failed. Please try again.", true),
    )
    await reconcileKieJob(row({
      id: "job-dag-char-failed",
      provider_kind: "kie-standard",
      provider_task_id: "task-dag-char-failed",
      job_type: "character",
    }))
    // This is what the after-the-poll placement buys: tick 1 instead of 18.
    expect(mocks.refundMock).toHaveBeenCalled()
    expect(lastJobsUpdate().status).toBe("failed")
  })

  it("bumps with a named reason for a route-origin generate-character row", async () => {
    await reconcileKieJob(row({
      id: "job-entity-char",
      provider_kind: "kie-standard",
      provider_task_id: "task-entity-char",
      job_type: "generate-character",
    }))
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(lastBumpReason()).toMatch(/not generically recoverable: generate-character/)
  })

  it("bumps rather than finalizing as an image when job_type is null", async () => {
    await reconcileKieJob(row({
      id: "job-null-type",
      provider_kind: "kie-standard",
      provider_task_id: "task-null-type",
      job_type: null,
    }))
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(lastBumpReason()).toMatch(/unknown job_type/)
  })

  it("still finalizes a genuine media row", async () => {
    mocks.pollKieTaskMock.mockResolvedValue({
      resultJson: { resultUrls: ["https://cdn.example/out.png"] },
      providerMs: 50,
      taskId: "t-img",
    })
    await reconcileKieJob(row({
      id: "job-img",
      provider_kind: "kie-standard",
      provider_task_id: "task-img",
      job_type: "generate-image",
    }))
    expect(mocks.finalizeMock).toHaveBeenCalledWith(expect.objectContaining({ jobType: "generate-image" }))
  })

  it("logs one line when the cron fails a job, so a burst is traceable in Railway", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.pollKieTaskMock.mockRejectedValue(
      new mocks.FakeKieError("Generation failed. Please try again.", true),
    )
    await reconcileKieJob(row({
      id: "job-silent-1",
      provider_kind: "kie-standard",
      provider_task_id: "task-silent-1",
      job_type: "generate-image",
    }))
    const lines = spy.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes("[reconcile/kie]") && l.includes("job-silent-1"))).toBe(true)
    spy.mockRestore()
  })
})
