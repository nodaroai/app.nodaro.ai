import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// vi.hoisted mocks — pattern matches replicate.test.ts / sync-sweep.test.ts
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Supabase plumbing. The bump-attempts helper hits multiple tables:
  //   - SELECT jobs.reconcile_attempts
  //   - UPDATE jobs SET reconcile_attempts=N (sub-cap path)
  //   - UPDATE jobs SET status=failed ... .in("status",[...]).select("id")  (exhaust path)
  //   - SELECT jobs (user_id, provider, provider_kind, provider_task_id)     (anomaly log)
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
  // G-7: capture every jobs.update(payload) so tests can assert on the exact
  // recorded update (lastJobsUpdate below), not just individual fields.
  const jobsUpdates: Array<Record<string, unknown>> = []
  const jobsUpdateMock = vi.fn((arg: Record<string, unknown>) => {
    jobsUpdates.push(arg)
    return { eq: jobsUpdateEqMock }
  })

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

  // jobs SELECT for anomaly log (user_id, provider, provider_kind, provider_task_id).
  // `model_identifier` is deliberately left in this fixture's data even though
  // the real `jobs` table has no such column and the real select no longer
  // names it — a stray `"veo3"` surviving into the insert would prove the
  // fix regressed to reading a field PostgREST would have nulled the whole
  // row for. See the "still discriminates" test below.
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
  // Records the exact column-list string passed to every `jobs.select(...)`,
  // in call order, so a test can pin the anomaly lookup's select shape.
  const recordedJobsSelects: string[] = []

  const fromMock = vi.fn((table: string) => {
    if (table === "jobs") {
      return {
        select: vi.fn((cols: string) => {
          jobsSelectCallCount++
          recordedJobsSelects.push(cols)
          if (jobsSelectCallCount === 1) {
            return { eq: jobsSelectEqMock }
          }
          // anomaly log path — SELECT user_id, provider, provider_kind, provider_task_id
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

  function resetSelectCounter() {
    jobsSelectCallCount = 0
    recordedJobsSelects.length = 0
  }

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
    recordedJobsSelects,
    jobsUpdates,
  }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.fromMock } }))
vi.mock("../../credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: mocks.refundMock,
}))

import { bumpAttemptsOrExhaust } from "../bump-attempts.js"
import { MAX_ATTEMPTS } from "../types.js"

// G-7 harness accessors (did not exist before this task).
const lastJobsUpdate = (): Record<string, unknown> => mocks.jobsUpdates.at(-1) ?? {}
const setReconcileAttempts = (n: number) =>
  mocks.jobsSelectSingleMock.mockResolvedValueOnce({ data: { reconcile_attempts: n }, error: null })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resetSelectCounter()
  mocks.jobsUpdates.length = 0
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

    // Task 2 (app-reports W4): error_message is the fixed user-safe sentence;
    // the raw provider string now lives in error_detail, admin-only.
    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        reconcile_attempts: 1,
        reconcile_last_error: "exhausted",
        error_message: "Generation could not be recovered.",
        error_detail: expect.stringContaining("upload-size-exceeded"),
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

    // Force-fail UPDATE: status=failed, error_message is the fixed user-safe
    // sentence (Task 2, app-reports W4), the raw reason moved to error_detail,
    // .in("status", [pending,processing])
    expect(mocks.jobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        reconcile_attempts: MAX_ATTEMPTS,
        reconcile_last_error: "exhausted",
        error_message: "Generation could not be recovered.",
        error_detail: expect.stringContaining("reconcile_exhausted: upstream URL expired"),
      }),
    )
    // Widened by the markJobFailed consolidation (spec D11): "queued" is now
    // failable, "pending_review" never is.
    expect(mocks.jobsUpdateInMock).toHaveBeenCalledWith(
      "status",
      ["pending", "queued", "processing"],
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

  it("force-fail writes a fixed user message and keeps the raw reason in error_detail", async () => {
    setReconcileAttempts(17) // next = 18 = MAX_ATTEMPTS
    await bumpAttemptsOrExhaust("job-exhaust-1", new Error("upstream 500: <html>gateway</html> https://api.vendor.io/x?key=zz"))
    const update = lastJobsUpdate()
    expect(update.error_message).toBe("Generation could not be recovered.")
    expect(update.error_detail).toContain("upstream 500")
    expect(update.error_detail).not.toContain("key=zz")
    expect(update.reconcile_last_error).toBe("exhausted")
  })

  // M-2a: the load-bearing pin. W0 routes KieError.internalDetails into
  // error_detail via providerDetailOf(err); this PR must not trade that richer
  // text for something re-derived from the sanitized message.
  it("prefers KieError.internalDetails over the re-derived machine string", async () => {
    setReconcileAttempts(17)
    const err = Object.assign(new Error("Generation failed. Please try again."), {
      name: "KieError",
      internalDetails: "task failed: [500] upstream pod evicted (node-7) during decode",
    })
    await bumpAttemptsOrExhaust("job-exhaust-2", err)
    const update = lastJobsUpdate()
    expect(update.error_detail).toContain("upstream pod evicted")
    expect(update.error_detail).not.toContain("reconcile_exhausted:")
    expect(update.error_message).toBe("Generation could not be recovered.")
  })

  it("falls back to the redacted machine string when the error carries no provider text", async () => {
    setReconcileAttempts(17)
    await bumpAttemptsOrExhaust("job-exhaust-3", new Error("still processing"))
    expect(lastJobsUpdate().error_detail).toContain("reconcile_exhausted: still processing")
  })
})

describe("logExhaustedAnomaly column safety", () => {
  it("never selects jobs.model_identifier (the column does not exist; PostgREST nulls the whole row)", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../bump-attempts.ts", import.meta.url), "utf8"),
    )
    // The anomaly lookup is the only `from("jobs").select(...)` in this module
    // besides the reconcile_attempts read. Neither may name model_identifier.
    expect(src).not.toMatch(/select\(\s*"[^"]*model_identifier/)
  })

  it("still records the model identity on the anomaly row from provider_kind", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../bump-attempts.ts", import.meta.url), "utf8"),
    )
    expect(src).toContain("model_identifier: jobRow.provider_kind")
  })

  it("mocked supabase client: anomaly lookup selects only real jobs columns and the insert carries provider_kind, not the stale model_identifier field", async () => {
    mocks.jobsSelectSingleMock.mockResolvedValueOnce({
      data: { reconcile_attempts: MAX_ATTEMPTS - 1 },
      error: null,
    })

    await bumpAttemptsOrExhaust("j-1", new Error("upstream URL expired"))

    // Second jobs.select() call is the anomaly lookup (first is reconcile_attempts).
    expect(mocks.recordedJobsSelects[1]).toBe(
      "user_id, provider, provider_kind, provider_task_id",
    )

    // The fixture's jobsAnomalySingleMock data still carries a `model_identifier:
    // "veo3"` field (see its declaration) purely as a trap: if the insert below
    // read `jobRow.model_identifier` it would see "veo3", not "kie-veo".
    expect(mocks.anomaliesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ model_identifier: "kie-veo", provider: "kie" }),
    )
  })
})
