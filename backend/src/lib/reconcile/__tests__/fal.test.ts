import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — mirror reconcile/replicate.test.ts. The lifecycle helpers
// (finalize/refund/markFailed-via-supabase/bumpAttempts) are stubbed, plus the
// fal queue status fetch + url extractor so no network / real config loads.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const fetchStatusMock = vi.fn()
  const extractUrlMock = vi.fn((o: unknown) => (o as { url?: string }).url ?? "https://fal.media/x.mp4")
  const finalizeMock = vi.fn().mockResolvedValue({ ok: true })
  const refundMock = vi.fn().mockResolvedValue(undefined)
  const bumpMock = vi.fn().mockResolvedValue(undefined)

  // markFailed() lives inside fal.ts and writes via supabase.from("jobs").update(...).eq("id",...).in("status",...).
  // Track which terminal update fired by capturing the update() arg objects.
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
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            in: jobsUpdateInMock,
          })
        }
        return { in: jobsUpdateInMock }
      }),
    }
  })
  const fromMock = vi.fn((_table: string) => ({ update: jobsUpdateMock }))

  return { fetchStatusMock, extractUrlMock, finalizeMock, refundMock, bumpMock, fromMock, jobsUpdateMock, jobsUpdateInMock, jobsUpdates }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))
vi.mock("../../job-finalize.js", async (importOriginal) => {
  // isFinalizeJobType + NOT_GENERIC_RECOVERABLE are pure lookups over static
  // sets — keep the REAL ones so the narrowing under test is the real thing,
  // not a re-declared copy that could drift from job-finalize.ts.
  const actual = await importOriginal<typeof import("../../job-finalize.js")>()
  return { ...actual, finalizeJobWithMedia: mocks.finalizeMock }
})
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundMock }))
vi.mock("../bump-attempts.js", () => ({ bumpAttemptsOrExhaust: mocks.bumpMock }))
vi.mock("../../../providers/fal/client.js", () => ({
  fetchFalRequestStatus: mocks.fetchStatusMock,
  extractFalUrl: mocks.extractUrlMock,
}))

import { reconcileFalJob, type FalJobRow } from "../fal.js"

const falRow = (over: Partial<FalJobRow> = {}): FalJobRow => ({
  id: "j-fal",
  provider_kind: "fal-request",
  provider_task_id: "req-1",
  reconcile_attempts: 0,
  job_type: "lip-sync",
  input_data: { provider: "sync-lipsync-v3" },
  ...over,
})

// G-7 harness accessor (did not exist before this task).
const lastJobsUpdate = (): Record<string, unknown> => mocks.jobsUpdates.at(-1) ?? {}

describe("reconcileFalJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizeMock.mockResolvedValue({ ok: true })
    mocks.jobsUpdates.length = 0
    mocks.extractUrlMock.mockImplementation(
      (o: unknown) => (o as { url?: string }).url ?? "https://fal.media/x.mp4",
    )
  })

  it("COMPLETED → finalizes with the extracted URL (providerUsed: fal, cost: null)", async () => {
    mocks.fetchStatusMock.mockResolvedValue({
      status: "COMPLETED",
      output: { url: "https://fal.media/out.mp4" },
    })
    await reconcileFalJob(falRow())

    // endpoint resolved from input_data.provider via FAL_LIP_SYNC_CONFIGS
    expect(mocks.fetchStatusMock).toHaveBeenCalledWith("fal-ai/sync-lipsync/v3", "req-1")
    expect(mocks.finalizeMock).toHaveBeenCalledWith({
      jobId: "j-fal",
      jobType: "lip-sync",
      claimant: "cron",
      result: expect.objectContaining({
        url: "https://fal.media/out.mp4",
        cost: null,
        providerUsed: "fal",
      }),
    })
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.bumpMock).not.toHaveBeenCalled()
  })

  it("passes the opts.claimant through to finalize (worker stall re-pick)", async () => {
    mocks.fetchStatusMock.mockResolvedValue({
      status: "COMPLETED",
      output: { url: "https://fal.media/out.mp4" },
    })
    await reconcileFalJob(falRow(), { claimant: "worker" })
    expect(mocks.finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({ claimant: "worker" }),
    )
  })

  it("ERROR → markFailed + refund, no finalize", async () => {
    mocks.fetchStatusMock.mockResolvedValue({ status: "ERROR", error: "model crashed" })
    await reconcileFalJob(falRow({ id: "j-err", provider_task_id: "req-err" }))

    expect(mocks.refundMock).toHaveBeenCalledWith("j-err")
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.bumpMock).not.toHaveBeenCalled()
    // markFailed wrote a terminal status via supabase
    const failCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )
    expect(failCall).toBeTruthy()
    // Spec D11: the shared markJobFailed CAS. "queued" is newly failable (these
    // sweeps could not take a queued row at all before); "pending_review" is
    // absent BY CONSTRUCTION, so no reconcile tick can fail a job under review.
    expect(mocks.jobsUpdateInMock).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
  })

  it("pending → bumpAttempts, no finalize, no refund", async () => {
    mocks.fetchStatusMock.mockResolvedValue({ status: "pending" })
    await reconcileFalJob(falRow({ id: "j-pend", provider_task_id: "req-pend" }))

    expect(mocks.bumpMock).toHaveBeenCalledWith("j-pend", expect.anything())
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("missing provider_task_id → no-op (nothing to re-fetch)", async () => {
    await reconcileFalJob(falRow({ provider_task_id: null }))
    expect(mocks.fetchStatusMock).not.toHaveBeenCalled()
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.bumpMock).not.toHaveBeenCalled()
  })

  it("unresolvable endpoint (unknown/absent input_data.provider) → markFailed + refund, no status fetch", async () => {
    await reconcileFalJob(
      falRow({ id: "j-noendpoint", input_data: { provider: "not-a-fal-model" } }),
    )
    expect(mocks.fetchStatusMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).toHaveBeenCalledWith("j-noendpoint")
    const failCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )
    expect(failCall).toBeTruthy()
  })

  it("absent input_data entirely → markFailed + refund (no endpoint recoverable)", async () => {
    await reconcileFalJob(falRow({ id: "j-noinput", input_data: null }))
    expect(mocks.fetchStatusMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).toHaveBeenCalledWith("j-noinput")
  })

  // Mirror reconcileReplicateJob's B1 guard: a COMPLETED-but-finalize-failure
  // must bump reconcile_attempts (exhaust→refund) rather than markFailed/refund
  // immediately or loop forever.
  it("COMPLETED but finalize throws → bumps attempts, no markFailed, no refund, no propagation", async () => {
    mocks.fetchStatusMock.mockResolvedValue({
      status: "COMPLETED",
      output: { url: "https://fal.media/out.mp4" },
    })
    mocks.finalizeMock.mockRejectedValueOnce(new Error("R2 upload failed"))

    await expect(
      reconcileFalJob(falRow({ id: "j-fin-throw" })),
    ).resolves.toBeUndefined()

    expect(mocks.bumpMock).toHaveBeenCalledWith("j-fin-throw", expect.anything())
    expect(mocks.refundMock).not.toHaveBeenCalled()
    const failCall = mocks.jobsUpdateMock.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )
    expect(failCall).toBeUndefined()
  })

  it("COMPLETED but extractFalUrl throws (bad output shape) → bumps attempts (terminal handled by exhaust path)", async () => {
    mocks.fetchStatusMock.mockResolvedValue({ status: "COMPLETED", output: { foo: "bar" } })
    mocks.extractUrlMock.mockImplementationOnce(() => {
      throw new Error("Unexpected fal output shape")
    })
    await reconcileFalJob(falRow({ id: "j-badshape" }))
    expect(mocks.bumpMock).toHaveBeenCalledWith("j-badshape", expect.anything())
    expect(mocks.finalizeMock).not.toHaveBeenCalled()
  })

  // Task 2 (app-reports W4): jobs.error_message is user-visible — it must never
  // carry raw provider text. The raw text belongs in error_detail (admin-only),
  // redacted through redactProviderDetail.
  it("ERROR → puts a user-safe sentence in error_message and the raw provider text in error_detail", async () => {
    mocks.fetchStatusMock.mockResolvedValue({
      status: "ERROR",
      error: "model OOM https://fal.run/req/x?token=abc",
    })
    await reconcileFalJob(falRow({ id: "j-err-raw", provider_task_id: "req-err-raw" }))

    const update = lastJobsUpdate()
    expect(update.status).toBe("failed")
    expect(update.error_message).toBe("Generation failed on the provider. Please try again.")
    expect(update.error_message).not.toContain("model OOM")
    expect(update.error_detail).toContain("model OOM")
    expect(update.error_detail).not.toContain("token=abc")
  })

  // Task 4 fix round 1: pin fal.ts's new NOT_GENERIC_RECOVERABLE / isFinalizeJobType
  // guards (mirrors the kie.ts twins in kie.test.ts).
  describe("NOT_GENERIC_RECOVERABLE rows", () => {
    it("COMPLETED with job_type null → bumps with an 'unknown job_type' reason, no finalize", async () => {
      // Pins a deliberate behavior change: the old `?? "lip-sync"` fallback
      // cast is gone, so a null job_type no longer silently finalizes as
      // lip-sync — it bumps toward exhaustion instead.
      mocks.fetchStatusMock.mockResolvedValue({
        status: "COMPLETED",
        output: { url: "https://fal.media/null-type.mp4" },
      })
      await reconcileFalJob(falRow({ id: "j-null-type", job_type: null }))

      expect(mocks.bumpMock).toHaveBeenCalledWith("j-null-type", expect.stringMatching(/unknown job_type/))
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
    })

    it("COMPLETED with a denylisted job_type (character) → bumps with a named reason, no finalize", async () => {
      mocks.fetchStatusMock.mockResolvedValue({
        status: "COMPLETED",
        output: { url: "https://fal.media/character.mp4" },
      })
      await reconcileFalJob(falRow({ id: "j-character", job_type: "character" }))

      expect(mocks.bumpMock).toHaveBeenCalledWith(
        "j-character",
        expect.stringMatching(/not generically recoverable/),
      )
      expect(mocks.finalizeMock).not.toHaveBeenCalled()
    })
  })
})
