// @test-units-by-name names no node type: it commits and refunds usage logs through CreditsService
/**
 * The C3 sweep and a stale METERED LLM job ("a metered call is never left
 * free"): R59 — a billed job is settled at its ACTUAL from what its row
 * recorded (the hold whole only at the D10 cap or when the row's spend cannot
 * be priced); R60 — a job whose call started with nothing billed recorded
 * keeps its hold to the cap, never refunded; everything else is refunded
 * exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const LOG = "22222222-2222-4222-8222-222222222222"
const JOB = "11111111-1111-4111-8111-111111111111"

const h = vi.hoisted(() => {
  const state = {
    logs: [] as Array<Record<string, unknown>>,
    logsError: null as { message: string } | null,
    /** Fail only the next N reads of the job's reserved logs. */
    logsErrorReads: 0,
    /** Throw (not answer an error) on the next read of the job's reserved logs. */
    logsThrow: false,
    job: null as Record<string, unknown> | null,
    jobError: null as { message: string } | null,
    /** usage_logs.status answered to the cap's confirmation read. */
    logStatus: "reserved" as string,
    logCharged: null as number | null,
    jobUpdates: [] as Array<Record<string, unknown>>,
    reports: [] as Array<Record<string, unknown>>,
    /** Logs a commit settled — no longer `reserved`. */
    committed: new Set<string>(),
    /** Every jobs-row write's status CAS (`.in("status", …)`), in order. */
    jobStatusCas: [] as unknown[][],
    /** The error every jobs-row write answers (B: the billed-marker write's own error is checked). */
    jobUpdateError: null as { message: string } | null,
  }
  const chain = (table: string) => {
    const c: Record<string, unknown> = {}
    let updating: Record<string, unknown> | null = null
    for (const m of ["select", "eq", "in", "neq", "limit"]) c[m] = vi.fn(() => c)
    c.in = vi.fn((col: string, vals: unknown[]) => {
      if (table === "jobs" && updating && col === "status") state.jobStatusCas.push(vals)
      return c
    })
    c.update = vi.fn((v: Record<string, unknown>) => {
      updating = v
      if (table === "jobs") state.jobUpdates.push(v)
      return c
    })
    c.maybeSingle = vi.fn(async () =>
      table === "jobs"
        ? { data: state.job, error: state.jobError }
        : table === "usage_logs"
          ? { data: { status: state.logStatus, credits_charged: state.logCharged }, error: null }
          : { data: null, error: null },
    )
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      if (table === "usage_logs" && !updating && state.logsThrow) {
        state.logsThrow = false
        return Promise.reject(new Error("socket hang up")).then(resolve, reject)
      }
      if (table === "usage_logs" && !updating && state.logsErrorReads > 0) {
        state.logsErrorReads--
        return Promise.resolve({ data: null, error: { message: "timeout" } }).then(resolve, reject)
      }
      return Promise.resolve(
        updating && table === "jobs" && (updating as { status?: unknown }).status === "failed"
          ? { data: [{ id: JOB }], error: null }
          : updating && table === "jobs" && state.jobUpdateError
            ? { data: null, error: state.jobUpdateError }
          : table === "usage_logs" && !updating
            ? { data: state.logsError ? null : state.logs.filter((l) => !state.committed.has(String(l.id))), error: state.logsError }
            : { data: null, error: null },
      ).then(resolve, reject)
    }
    return c
  }
  return { state, from: vi.fn((t: string) => chain(t)) }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: h.from, rpc: vi.fn() } }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async (r: Record<string, unknown>) => (h.state.reports.push(r), true)) }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config.js")>()),
  hasCredits: () => true,
}))

const { CreditsService } = await import("../../../ee/billing/credits.js")
const { sweepStaleSyncJob } = await import("../sync-sweep.js")

const job = { id: JOB, provider_kind: "anthropic-sync", reconcile_attempts: 0, reconcile_last_error: null as string | null }

beforeEach(() => {
  vi.restoreAllMocks()
  h.state.logs = []
  h.state.logsError = null
  h.state.job = null
  h.state.jobError = null
  h.state.logStatus = "reserved"
  h.state.logCharged = null
  h.state.logsErrorReads = 0
  h.state.logsThrow = false
  h.state.jobUpdates = []
  h.state.reports = []
  h.state.committed = new Set()
  h.state.jobStatusCas = []
  h.state.jobUpdateError = null
})

describe("sweepStaleSyncJob — metered LLM holds (R59 / R60 / D10)", () => {
  const failedWrites = () => h.state.jobUpdates.filter((u) => u.status === "failed")
  const attemptBumps = () => h.state.jobUpdates.filter((u) => u.reconcile_attempts !== undefined && u.status === undefined)

  it("R59: metered + billed → settled at its ACTUAL from the row (not the hold), before the terminal flip, never refunded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, llm_billing: { costUsd: 0.048, calls: 1 } }
    let failedBeforeCommit = false
    const commit = vi.spyOn(CreditsService, "commitCredits").mockImplementation(async (id, actual) => {
      failedBeforeCommit = h.state.jobUpdates.some((u) => u.status === "failed")
      h.state.committed.add(id)
      return { charged: actual as number, collectedOverHold: 0, shortfall: 0 }
    })
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob(job)
    // committed BEFORE the terminal flip (a failed commit must leave the job sweepable)
    expect(failedBeforeCommit).toBe(false)
    // $0.048 at 0 % markup = 24 credits (CREDIT_BASE_USD 0.002) — the actual, not the 368 hold.
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(LOG, 24, { collectOverHold: true })
    expect(refund).not.toHaveBeenCalled()
    expect(h.state.jobUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ status: "failed" }), expect.objectContaining({ credits_actual: 24 })]))
  })

  it("R59 + D1: an actual ABOVE the hold is charged at the actual (the metered commit collects the overrun)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 10 }]
    h.state.job = { provider_cost: 0.048, llm_billing: { costUsd: 0.048, calls: 2 } }
    const commit = vi.spyOn(CreditsService, "commitCredits").mockImplementation(async (id, actual) => (h.state.committed.add(id), { charged: actual as number, collectedOverHold: 14, shortfall: 0 }))
    await sweepStaleSyncJob(job)
    expect(commit).toHaveBeenCalledWith(LOG, 24, { collectOverHold: true })
  })

  it("R59: a settle at the actual that is not confirmed → retried (billed marker, attempts bumped), never refunded or failed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, llm_billing: { costUsd: 0.048, calls: 1 } }
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined)
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 1 })
    expect(failedWrites()).toEqual([])
    expect(refund).not.toHaveBeenCalled()
    expect(attemptBumps()).toEqual([expect.objectContaining({ reconcile_attempts: 2, reconcile_last_error: expect.stringMatching(/^metered_settle_retry:billed: /) })])
  })

  it("R60: a call that STARTED (stamped, no pre-call marker) with nothing billed recorded keeps its hold — retried, never refunded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: null, llm_billing: null, provider_call_started_at: "2026-10-20T10:00:00Z" }
    const commit = vi.spyOn(CreditsService, "commitCredits")
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 1 })
    expect(commit).not.toHaveBeenCalled()
    expect(refund).not.toHaveBeenCalled()
    expect(failedWrites()).toEqual([])
    expect(attemptBumps()).toEqual([expect.objectContaining({ reconcile_attempts: 2, reconcile_last_error: expect.stringMatching(/^metered_settle_retry:billed: /) })])
  })

  it("R60: …and at the D10 cap that hold is charged whole (plain commit, confirmed), the job failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: null, llm_billing: null, provider_call_started_at: "2026-10-20T10:00:00Z" }
    const commit = vi.spyOn(CreditsService, "commitCredits").mockImplementation(async (id, _actual, opts) => {
      if (opts?.collectOverHold) return undefined
      h.state.logStatus = "committed"
      h.state.logCharged = 368
      h.state.committed.add(id)
      return undefined
    })
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4 })
    expect(commit).toHaveBeenLastCalledWith(LOG, 368)
    expect(refund).not.toHaveBeenCalled()
    expect(failedWrites()).toHaveLength(1)
    expect(h.state.reports).toEqual([expect.objectContaining({ kind: "metered-hold-charged-at-cap", jobId: JOB })])
  })

  it("R60: a stamp still carrying the worker's PRE-CALL marker (nothing sent) → refunded as before", async () => {
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: null, llm_billing: { preCall: true, chargeId: "llm-chat:claude-fable-5" }, provider_call_started_at: "2026-10-20T10:00:00Z" }
    const commit = vi.spyOn(CreditsService, "commitCredits")
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob(job)
    expect(commit).not.toHaveBeenCalled()
    expect(refund).toHaveBeenCalledWith(LOG)
  })

  it("C: an earlier tick's billed confirmation is consulted BEFORE answering not-metered — a row that now reads unbilled is never refunded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: null, llm_billing: null }
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 2, reconcile_last_error: "metered_settle_retry:billed: confirmed metered + billed" })
    expect(refund).not.toHaveBeenCalled()
    expect(failedWrites()).toEqual([])
  })

  it("B: the billed-marker write's returned error is checked and logged", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, llm_billing: { costUsd: 0.048, calls: 1 } }
    h.state.jobUpdateError = { message: "permission denied" }
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 1 })
    expect(err.mock.calls.some((c) => String(c[0]).includes("could not persist the billed marker") && String(c[0]).includes("permission denied"))).toBe(true)
  })

  it("metered + billed by ledger only (an uncomputable cost) → committed too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:gemini-4-argon", credits_used: 50 }]
    h.state.job = { provider_cost: null, llm_billing: { costUsd: null, source: "uncomputable", calls: 1 } }
    const commit = vi.spyOn(CreditsService, "commitCredits").mockImplementation(async (id) => (h.state.committed.add(id), { charged: 50, collectedOverHold: 0, shortfall: 0 }))
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob(job)
    expect(commit).toHaveBeenCalledWith(LOG, 50, { collectOverHold: true })
    expect(refund).not.toHaveBeenCalled()
  })

  it("R38: run for a CANCELLED row (the cancelled-hold sweep), its billed marker and attempts bump touch `cancelled` — the counter advances", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048 }
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined)
    const { settleSweptMeteredLlmJob } = await import("../../llm-billing.js")
    expect(await settleSweptMeteredLlmJob({ id: JOB, reconcile_attempts: 1 }, { statuses: ["cancelled"] })).toBe("retry")
    expect(h.state.jobStatusCas.length).toBeGreaterThanOrEqual(2) // the billed marker, then the bump
    for (const cas of h.state.jobStatusCas) expect(cas).toEqual(["cancelled"])
    expect(h.state.jobUpdates.filter((u) => u.status !== undefined)).toEqual([]) // never flipped
  })

  it("the live sweep's own writes keep CAS-ing on the live statuses", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048 }
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 1 })
    expect(h.state.jobStatusCas.length).toBeGreaterThanOrEqual(2)
    for (const cas of h.state.jobStatusCas) expect(cas).not.toContain("cancelled")
  })

  it("metered + billed, no receipt → the job stays sweepable with attempts bumped; nothing failed or refunded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined)
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 1 })
    expect(failedWrites()).toEqual([])
    expect(attemptBumps()).toEqual([expect.objectContaining({ reconcile_attempts: 2 })])
    expect(refund).not.toHaveBeenCalled()
  })

  it("D10: at the cap the hold is charged through the plain commit, confirmed, and the job failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    const commit = vi.spyOn(CreditsService, "commitCredits").mockImplementation(async (_id, _actual, opts) => {
      if (opts?.collectOverHold) return undefined
      h.state.logStatus = "committed"
      h.state.logCharged = 368
      h.state.committed.add(_id)
      return undefined
    })
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4 })
    expect(commit).toHaveBeenCalledWith(LOG, 368, { collectOverHold: true })
    expect(commit).toHaveBeenLastCalledWith(LOG, 368)
    expect(failedWrites()).toHaveLength(1)
    expect(refund).not.toHaveBeenCalled()
    expect(h.state.jobUpdates).toEqual(expect.arrayContaining([{ credits_actual: 368 }]))
    expect(h.state.reports).toEqual([expect.objectContaining({ kind: "metered-hold-charged-at-cap", jobId: JOB })])
  })

  it("D10: a plain commit at the cap that cannot be confirmed keeps the job sweepable and alerts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined)
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4 })
    expect(failedWrites()).toEqual([])
    expect(attemptBumps()).toEqual([expect.objectContaining({ reconcile_attempts: 5 })])
    expect(refund).not.toHaveBeenCalled()
    expect(h.state.reports).toEqual([expect.objectContaining({ kind: "metered-hold-unsettled-at-cap" })])
  })

  it("a transient read error on the job's logs or its row → retry next tick, never a refund", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const commit = vi.spyOn(CreditsService, "commitCredits")
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    h.state.logsError = { message: "timeout" }
    await sweepStaleSyncJob(job)
    h.state.logsError = null
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.jobError = { message: "timeout" }
    await sweepStaleSyncJob(job)
    expect(failedWrites()).toEqual([])
    expect(attemptBumps()).toHaveLength(2)
    expect(commit).not.toHaveBeenCalled()
    expect(refund).not.toHaveBeenCalled()
  })

  it("a throw inside the metered settle → retry, never a refund", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    vi.spyOn(CreditsService, "commitCredits").mockRejectedValue(new Error("rpc down"))
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob(job)
    expect(failedWrites()).toEqual([])
    expect(refund).not.toHaveBeenCalled()
    // the throw counts toward the cap
    expect(attemptBumps()).toEqual([expect.objectContaining({ reconcile_attempts: 1 })])
  })

  it("a throw before classification (in the shim) still bumps the counter", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logsThrow = true
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 2 })
    expect(failedWrites()).toEqual([])
    expect(attemptBumps()).toEqual([expect.objectContaining({ reconcile_attempts: 3 })])
    expect(refund).not.toHaveBeenCalled()
  })

  it("at the cap, a job never confirmed metered + billed falls back to today's fail + refund", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:premium", credits_used: 6 }]
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    // the classifying read fails; the refund's own read then succeeds
    h.state.logsErrorReads = 1
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4 })
    expect(failedWrites()).toHaveLength(1)
    expect(refund).toHaveBeenCalledWith(LOG)
    expect(attemptBumps()).toEqual([])
  })

  it("at the cap, a jobs read that keeps failing on a metered job also falls back to fail + refund", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.jobError = { message: "timeout" }
    const commit = vi.spyOn(CreditsService, "commitCredits")
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4 })
    expect(commit).not.toHaveBeenCalled()
    expect(failedWrites()).toHaveLength(1)
    expect(refund).toHaveBeenCalledWith(LOG)
  })

  it("at the cap, a log another writer settled is not reported or re-written as our charge", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    // the route's late settle won the CAS: the log is committed at 27 before our plain commit
    vi.spyOn(CreditsService, "commitCredits").mockImplementation(async (id, _actual, opts) => {
      if (opts?.collectOverHold) {
        h.state.logStatus = "committed"
        h.state.logCharged = 27
        h.state.committed.add(id)
      }
      return undefined
    })
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4 })
    expect(h.state.reports).toEqual([])
    expect(h.state.jobUpdates.some((u) => "credits_actual" in u)).toBe(false)
    expect(failedWrites()).toHaveLength(1)
    expect(refund).not.toHaveBeenCalled()
  })

  it("at the cap, a metered commit that keeps THROWING still reaches D10 — charged, never refunded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    vi.spyOn(CreditsService, "commitCredits").mockImplementation(async (id, _actual, opts) => {
      if (opts?.collectOverHold) throw new Error("rpc down")
      h.state.logStatus = "committed"
      h.state.logCharged = 368
      h.state.committed.add(id)
      return undefined
    })
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4 })
    expect(h.state.reports).toEqual([expect.objectContaining({ kind: "metered-hold-charged-at-cap" })])
    expect(failedWrites()).toHaveLength(1)
    expect(refund).not.toHaveBeenCalled()
  })

  it("at the cap, an unreadable hold whose log another writer already settled is not claimed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: null }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    // the route already settled it (committed at 27); our plain commit then changes nothing
    h.state.logStatus = "committed"
    h.state.logCharged = 27
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4 })
    expect(h.state.reports).toEqual([])
    expect(h.state.jobUpdates.some((u) => "credits_actual" in u)).toBe(false)
  })

  it("at the cap, a plain commit that lands at another figure is not claimed as ours", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    vi.spyOn(CreditsService, "commitCredits").mockImplementation(async (id, _actual, opts) => {
      if (!opts?.collectOverHold) {
        // someone else's commit (at 27) landed between our read and our commit
        h.state.logStatus = "committed"
        h.state.logCharged = 27
        h.state.committed.add(id)
      }
      return undefined
    })
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4 })
    expect(h.state.reports).toEqual([])
    expect(h.state.jobUpdates.some((u) => "credits_actual" in u)).toBe(false)
    expect(failedWrites()).toHaveLength(1)
  })

  it("metered + NOT billed → refunded exactly as before", async () => {
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: null, output_data: {} }
    const commit = vi.spyOn(CreditsService, "commitCredits")
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob(job)
    expect(commit).not.toHaveBeenCalled()
    expect(refund).toHaveBeenCalledWith(LOG)
  })

  it("non-metered (a tier id), even with a provider cost → refunded, unchanged", async () => {
    h.state.logs = [{ id: LOG, action: "llm-chat:premium", credits_used: 6 }]
    h.state.job = { provider_cost: 0.05, llm_billing: { calls: 1 } }
    const commit = vi.spyOn(CreditsService, "commitCredits")
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob(job)
    expect(commit).not.toHaveBeenCalled()
    expect(refund).toHaveBeenCalledWith(LOG)
  })

  const BILLED = "metered_settle_retry:billed: confirmed metered + billed"
  const markerOf = (u: Record<string, unknown>) => u.reconcile_last_error as string | undefined

  it("our own TS-fallback commit at the cap (credits_charged left NULL) is still OUR charge", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    vi.spyOn(CreditsService, "commitCredits").mockImplementation(async (id, _actual, opts) => {
      if (opts?.collectOverHold) return undefined
      // an older fallback: status flipped, credits_charged never written
      h.state.logStatus = "committed"
      h.state.logCharged = null
      h.state.committed.add(id)
      return undefined
    })
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4 })
    expect(h.state.reports).toEqual([expect.objectContaining({ kind: "metered-hold-charged-at-cap" })])
    expect(h.state.jobUpdates).toEqual(expect.arrayContaining([{ credits_actual: 368 }]))
    expect(failedWrites()).toHaveLength(1)
  })

  it("the billed confirmation is PERSISTED: confirmed on ticks 1-4, a read error on tick 5 never refunds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined)
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    let marker: string | null = null
    for (let attempts = 0; attempts < 4; attempts++) {
      h.state.jobUpdates = []
      await sweepStaleSyncJob({ ...job, reconcile_attempts: attempts, reconcile_last_error: marker })
      const written = h.state.jobUpdates.map(markerOf).filter((m): m is string => typeof m === "string")
      marker = written[written.length - 1] ?? marker
      expect(marker?.startsWith("metered_settle_retry:billed: ")).toBe(true)
    }
    // tick 5 (the cap): every read fails
    h.state.jobUpdates = []
    h.state.logsError = { message: "timeout" }
    h.state.jobError = { message: "timeout" }
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4, reconcile_last_error: marker })
    expect(failedWrites()).toEqual([])
    expect(refund).not.toHaveBeenCalled()
    expect(attemptBumps()).toEqual([expect.objectContaining({ reconcile_attempts: 5, reconcile_last_error: expect.stringMatching(/^metered_settle_retry:billed: /) })])
  })

  it("a confirmed job whose jobs read fails at the cap stays sweepable (never refunded)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.jobError = { message: "timeout" }
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4, reconcile_last_error: BILLED })
    expect(failedWrites()).toEqual([])
    expect(refund).not.toHaveBeenCalled()
  })

  it("a throw caught by the shim at the cap keeps a confirmed job sweepable (never refunded)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logsThrow = true
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4, reconcile_last_error: BILLED })
    expect(failedWrites()).toEqual([])
    expect(refund).not.toHaveBeenCalled()
    expect(attemptBumps()).toEqual([expect.objectContaining({ reconcile_last_error: expect.stringMatching(/^metered_settle_retry:billed: /) })])
  })

  it("minor 3: a throw INSIDE the cap loop (post-classification) keeps the job sweepable, never refunded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined)
    const { insertAppReport } = await import("../../app-reports.js")
    vi.mocked(insertAppReport).mockRejectedValueOnce(new Error("boom"))
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    // the marker this same tick persisted before committing is what the next tick would read;
    // the shim's catch here still has the row's earlier marker
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4, reconcile_last_error: BILLED })
    expect(failedWrites()).toEqual([])
    expect(refund).not.toHaveBeenCalled()
  })

  it("the first confirming tick persists the billed marker before it commits", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:claude-fable-5", credits_used: 368 }]
    h.state.job = { provider_cost: 0.048, output_data: {} }
    let markerBeforeCommit: string | undefined
    vi.spyOn(CreditsService, "commitCredits").mockImplementation(async () => {
      markerBeforeCommit = h.state.jobUpdates.map(markerOf).find((m) => typeof m === "string")
      return undefined
    })
    await sweepStaleSyncJob(job)
    expect(markerBeforeCommit?.startsWith("metered_settle_retry:billed: ")).toBe(true)
  })

  it("a never-confirmed job still falls back at the cap (no marker)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.logs = [{ id: LOG, action: "llm-chat:premium", credits_used: 6 }]
    h.state.logsErrorReads = 1
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    await sweepStaleSyncJob({ ...job, reconcile_attempts: 4, reconcile_last_error: "metered_settle_retry: usage_logs read failed: timeout" })
    expect(failedWrites()).toHaveLength(1)
    expect(refund).toHaveBeenCalledWith(LOG)
  })
})
