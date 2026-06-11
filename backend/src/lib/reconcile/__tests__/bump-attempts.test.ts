import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// vi.hoisted mocks — pattern matches replicate.test.ts / sync-sweep.test.ts
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Supabase plumbing. The bump-attempts helper hits multiple tables:
  //   - SELECT jobs.reconcile_attempts
  //   - UPDATE jobs SET reconcile_attempts=N (sub-cap path)
  //   - UPDATE jobs SET status=failed ... .in("status",[...]).select("id")  (exhaust path)
  //   - SELECT jobs (user_id, model_identifier, provider, provider_kind)     (anomaly log)
  //   - SELECT usage_logs (id, credits_used)                                  (anomaly log)
  //   - INSERT credit_anomalies                                               (anomaly log)
  //
  // Each `from()` returns a builder; the test-specific behavior is configured
  // per-table by inspecting the table name in `fromMock`.

  // jobs SELECT
  const jobsSelectSingleMock = vi.fn()
  const jobsSelectEqMock = vi.fn(() => ({ single: jobsSelectSingleMock }))
  const jobsSelectMock = vi.fn(() => ({ eq: jobsSelectEqMock }))

  // jobs UPDATE — must return a chainable that supports both
  //   .eq("id", v)              → sub-cap path (resolves directly)
  //   .eq("id", v).in("status", [...]).select("id")  → exhaust path
  const jobsUpdateSelectMock = vi.fn().mockResolvedValue({ data: [{ id: "j-1" }], error: null })
  const jobsUpdateInMock = vi.fn(() => ({ select: jobsUpdateSelectMock }))
  const jobsUpdateEqMock = vi.fn(() =>
    Object.assign(
      Promise.resolve({ data: null, error: null }),
      { in: jobsUpdateInMock },
    ),
  )
  const jobsUpdateMock = vi.fn(() => ({ eq: jobsUpdateEqMock }))

  // usage_logs SELECT (anomaly log)
  const usageLogsMaybeSingleMock = vi.fn().mockResolvedValue({
    data: { id: "log-1", credits_used: 7 },
    error: null,
  })
  const usageLogsLimitMock = vi.fn(() => ({ maybeSingle: usageLogsMaybeSingleMock }))
  const usageLogsOrderMock = vi.fn(() => ({ limit: usageLogsLimitMock }))
  const usageLogsSelectEqMock = vi.fn(() => ({ order: usageLogsOrderMock }))
  const usageLogsSelectMock = vi.fn(() => ({ eq: usageLogsSelectEqMock }))

  // credit_anomalies INSERT
  const anomaliesInsertMock = vi.fn().mockResolvedValue({ data: null, error: null })

  // jobs SELECT for anomaly log (user_id, model_identifier, provider, provider_kind)
  const jobsAnomalySingleMock = vi.fn().mockResolvedValue({
    data: {
      user_id: "user-1",
      model_identifier: "veo3",
      provider: "kie",
      provider_kind: "kie-veo",
    },
    error: null,
  })

  // Tracks which `select()` the test is in (first call = reconcile_attempts,
  // second = anomaly job lookup). Per-from-call closure handles the rest.
  let jobsSelectCallCount = 0

  const fromMock = vi.fn((table: string) => {
    if (table === "jobs") {
      return {
        select: vi.fn((_cols: string) => {
          jobsSelectCallCount++
          if (jobsSelectCallCount === 1) {
            return { eq: jobsSelectEqMock }
          }
          // anomaly log path — SELECT user_id, model_identifier, etc.
          return { eq: vi.fn(() => ({ single: jobsAnomalySingleMock })) }
        }),
        update: jobsUpdateMock,
      }
    }
    if (table === "usage_logs") {
      return { select: usageLogsSelectMock }
    }
    if (table === "credit_anomalies") {
      return { insert: anomaliesInsertMock }
    }
    return { select: vi.fn(), update: vi.fn(), insert: vi.fn() }
  })

  const refundMock = vi.fn().mockResolvedValue(undefined)

  function resetSelectCounter() { jobsSelectCallCount = 0 }

  return {
    fromMock,
    jobsSelectSingleMock,
    jobsUpdateMock,
    jobsUpdateEqMock,
    jobsUpdateInMock,
    jobsUpdateSelectMock,
    jobsAnomalySingleMock,
    usageLogsMaybeSingleMock,
    anomaliesInsertMock,
    refundMock,
    resetSelectCounter,
  }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))
vi.mock("../../credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: mocks.refundMock,
}))

import { bumpAttemptsOrExhaust } from "../bump-attempts.js"
import { MAX_ATTEMPTS } from "../types.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resetSelectCounter()
  mocks.jobsUpdateSelectMock.mockResolvedValue({ data: [{ id: "j-1" }], error: null })
  mocks.jobsAnomalySingleMock.mockResolvedValue({
    data: {
      user_id: "user-1",
      model_identifier: "veo3",
      provider: "kie",
      provider_kind: "kie-veo",
    },
    error: null,
  })
  mocks.usageLogsMaybeSingleMock.mockResolvedValue({
    data: { id: "log-1", credits_used: 7 },
    error: null,
  })
})

describe("bumpAttemptsOrExhaust", () => {
  it("MAX_ATTEMPTS is 18 (spec §5.5 / §7)", () => {
    expect(MAX_ATTEMPTS).toBe(18)
  })

  it("below cap: bumps attempts, no exhaust", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: 3 },
      error: null,
    })

    await bumpAttemptsOrExhaust("j-1", new Error("still processing"))

    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reconcile_attempts: 4,
        reconcile_last_error: "still processing",
      }),
    )
    // No exhaust — the second call (status=failed + .in().select()) did not fire.
    expect(mocks.jobsUpdateInMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.anomaliesInsertMock).not.toHaveBeenCalled()
  })

  it("at cap minus one: bumps to cap-1, still no exhaust", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: MAX_ATTEMPTS - 2 },
      error: null,
    })

    await bumpAttemptsOrExhaust("j-1", "still processing")

    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_attempts: MAX_ATTEMPTS - 1 }),
    )
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  // ── deterministic-error fast-fail ──
  // upload-size-exceeded is immutable for a given provider result: retrying
  // it 18 times just zombies the job at "processing" for ~90 minutes (prod
  // jobs 85359bd4 / 900e6402). It force-fails + refunds on the FIRST bump.

  it("upload-size-exceeded: force-fails + refunds on the FIRST bump", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: 0 },
      error: null,
    })

    await bumpAttemptsOrExhaust(
      "j-1",
      new Error("upload-size-exceeded: Content-Length 33239469 > cap 26214400"),
    )

    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        reconcile_attempts: 1,
        reconcile_last_error: "exhausted",
        error_message: expect.stringContaining("upload-size-exceeded"),
      }),
    )
    expect(mocks.refundMock).toHaveBeenCalledWith("j-1")
    expect(mocks.anomaliesInsertMock).toHaveBeenCalled()
  })

  it("storage-limit-exceeded stays transient (quota can self-heal) — bumps only", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: 0 },
      error: null,
    })

    await bumpAttemptsOrExhaust("j-1", new Error("storage-limit-exceeded: atomic reservation refused"))

    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_attempts: 1 }),
    )
    expect(mocks.jobsUpdateInMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("reaches cap: force-fails + refunds + logs anomaly", async () => {
    // current=17 → next=18 → exhaust
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: MAX_ATTEMPTS - 1 },
      error: null,
    })

    await bumpAttemptsOrExhaust("j-1", new Error("upstream URL expired"))

    // Force-fail UPDATE: status=failed, error_message prefixed, .in("status", [pending,processing])
    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        reconcile_attempts: MAX_ATTEMPTS,
        reconcile_last_error: "exhausted",
        error_message: expect.stringContaining("reconcile_exhausted"),
      }),
    )
    expect(mocks.jobsUpdateInMock).toHaveBeenCalledWith(
      "status",
      ["pending", "processing"],
    )
    expect(mocks.jobsUpdateSelectMock).toHaveBeenCalledWith("id")

    // Refund + anomaly
    expect(mocks.refundMock).toHaveBeenCalledWith("j-1")
    expect(mocks.anomaliesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: "j-1",
        user_id: "user-1",
        usage_log_id: "log-1",
        anomaly_type: "reconcile_exhausted",
        credits_estimated: 7,
        credits_actual: 0,
        diff: -7,
        status: "pending",
      }),
    )
  })

  // Audit A5 — the anomaly note must reflect what actually happened, not a
  // hardcoded "credits refunded" (which lied when the hold was already
  // committed, e.g. a partial loop-trim commit on a prior worker attempt).
  it("exhaustion with a refundable hold → note says refunded", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: MAX_ATTEMPTS - 1 },
      error: null,
    })
    mocks.refundMock.mockResolvedValueOnce(1)

    await bumpAttemptsOrExhaust("j-1", "boom")

    const insertArg = mocks.anomaliesInsertMock.mock.calls[0]![0] as Record<string, unknown>
    expect(String(insertArg.admin_notes)).toContain("reserved credits refunded")
  })

  it("exhaustion with NO remaining reserved hold → note says user may still be charged", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: MAX_ATTEMPTS - 1 },
      error: null,
    })
    mocks.refundMock.mockResolvedValueOnce(0)

    await bumpAttemptsOrExhaust("j-1", "boom")

    const insertArg = mocks.anomaliesInsertMock.mock.calls[0]![0] as Record<string, unknown>
    expect(String(insertArg.admin_notes)).toContain("NO reserved hold")
    expect(String(insertArg.admin_notes)).toContain("user may still be charged")
  })

  it("CAS race: status already cancelled → no refund, no anomaly", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: MAX_ATTEMPTS - 1 },
      error: null,
    })
    // CAS UPDATE matched 0 rows (job became cancelled between read and write)
    mocks.jobsUpdateSelectMock.mockResolvedValueOnce({ data: [], error: null })

    await bumpAttemptsOrExhaust("j-1", "still processing")

    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.anomaliesInsertMock).not.toHaveBeenCalled()
  })

  it("anomaly log handles missing usage_log gracefully", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: MAX_ATTEMPTS - 1 },
      error: null,
    })
    mocks.usageLogsMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null })

    await bumpAttemptsOrExhaust("j-1", "still processing")

    expect(mocks.refundMock).toHaveBeenCalledWith("j-1")
    // Anomaly still logged, with credits=0 as fallback
    expect(mocks.anomaliesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        anomaly_type: "reconcile_exhausted",
        credits_estimated: 0,
        usage_log_id: null,
      }),
    )
  })

  it("starts from 0 (null in DB) and bumps to 1", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: null },
      error: null,
    })

    await bumpAttemptsOrExhaust("j-1", "first attempt")

    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_attempts: 1 }),
    )
  })

  it("accepts Error object — uses .message", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: 1 },
      error: null,
    })
    const err = new Error("network blip")

    await bumpAttemptsOrExhaust("j-1", err)

    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_last_error: "network blip" }),
    )
  })

  it("accepts plain string", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: 1 },
      error: null,
    })

    await bumpAttemptsOrExhaust("j-1", "still processing")

    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ reconcile_last_error: "still processing" }),
    )
  })

  it("truncates long error messages to 500 chars", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: 1 },
      error: null,
    })

    const longMsg = "x".repeat(800)
    await bumpAttemptsOrExhaust("j-1", longMsg)

    const firstCall = mocks.jobsUpdateMock.mock.calls[0] as unknown[] | undefined
    const updateArg = firstCall?.[0] as { reconcile_last_error: string } | undefined
    expect(updateArg?.reconcile_last_error.length).toBe(500)
  })
})
