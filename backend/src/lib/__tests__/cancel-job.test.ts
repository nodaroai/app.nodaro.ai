/**
 * cancelOwnedJob — the single-job cancel body as a helper. The route tests
 * (routes/__tests__/cancel-jobs.test.ts) cover the HTTP envelope; this file
 * covers the decision table and the one new fact: a cancelled row reports its
 * analysis child so the caller can cancel that too.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { setLlmMeteredSchemaReadyForTesting } from "../llm-metered-schema-gate.js"

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  tryRemoveFromQueue: vi.fn(async () => {}),
  refundCredits: vi.fn(async () => {}),
  withdrawHeldJob: vi.fn(async () => ({ ok: true }) as { ok: boolean; reason?: string }),
}))
vi.mock("../supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../queue.js", () => ({ tryRemoveFromQueue: mocks.tryRemoveFromQueue }))
vi.mock("../../ee/billing/credits.js", () => ({ CreditsService: { refundCredits: mocks.refundCredits } }))
// The held-job resolver. Reached through a DYNAMIC import so this module's
// static graph (supabase + queue) is unchanged — job-policy-gate pulls storage
// and the credit lifecycle behind it.
vi.mock("../job-policy-gate.js", () => ({ withdrawHeldJob: mocks.withdrawHeldJob }))
// A use-case wrapper's hidden run (reached through a dynamic import).
const inner = vi.hoisted(() => ({ cancel: vi.fn(async (_exec: string, _owner: string, _reason: string) => {}) }))
vi.mock("../use-case/cancel-run.js", () => ({ cancelUseCaseInnerExecution: inner.cancel }))
const wrapperRun = vi.hoisted(() => ({ find: vi.fn(async (_wrapper: string, _owner: string): Promise<string | null> => null) }))
vi.mock("../execution-inline-graph.js", () => ({ findExecutionIdForWrapper: wrapperRun.find }))
// R45 (D14): a cancel with nothing in flight settles a metered hold at the
// ACTUAL — what the row recorded billed (`meteredSpendFromRow`), through the
// metered settle (`settleLlmUsageLog`); it never commits a hold whole. Both
// reached through dynamic imports. Default: the row recorded nothing billed.
const actual = vi.hoisted(() => {
  const st = { billed: false, readFailed: false, outcome: "charged" as "charged" | "refunded" | "unsettled" }
  return {
    st,
    rowSpend: vi.fn(async (_job: string, _charge: string) => ({ spend: { billedAnything: st.billed }, modelId: "m", fromRow: st.billed, readFailed: st.readFailed })),
    settle: vi.fn(async (..._a: unknown[]) => (st.outcome === "charged" ? { outcome: "charged", charged: 9, shortfall: 0 } : { outcome: st.outcome })),
  }
})
vi.mock("../llm-row-spend.js", () => ({ meteredSpendFromRow: actual.rowSpend }))
vi.mock("../llm-billing.js", () => ({ settleLlmUsageLog: actual.settle }))
// …and its ledger twin for a fixed-price hold carrying billed calls (a scrape's
// analyses). Default: no billed ledger. Its own behaviour: llm-cancel-settle.test.ts.
const ledgerCancel = vi.hoisted(() => ({
  verdict: vi.fn(async (_jobId: string) => "not-metered" as "not-metered" | "settled" | "retry"),
}))
vi.mock("../../ee/billing/llm-cancel-settle.js", () => ({
  settleBilledLedgerBeforeCancelImpl: ledgerCancel.verdict,
  ledgerBilled: (l: unknown) => !!l && typeof l === "object" && ((l as { calls?: number }).calls ?? 0) > 0,
  ledgerInFlight: (l: unknown) => !!l && typeof l === "object" && ((l as { inFlight?: number }).inFlight ?? 0) > 0,
}))
const pricing = vi.hoisted(() => ({ rollback: false }))
vi.mock("../config.js", () => ({ hasCredits: () => true, llmMeteredPricing: () => !pricing.rollback }))
const reports = vi.hoisted(() => ({ insert: vi.fn(async (_r: unknown) => true) }))
/** R36: the job's `provider_call_started_at` as every maybeSingle() read of the row answers it (`fail`: that read errors). */
const callStart = vi.hoisted(() => ({
  at: null as string | null,
  fail: false,
  /** R38: whether each successive read of the row finds the worker's pre-call marker (the last value repeats). */
  preCall: [] as boolean[],
}))
/** The ledger column as the next read of the row answers it: the pre-call marker while `callStart.preCall` says so. */
function ledgerColumn(ledger: unknown): unknown {
  const marked = callStart.preCall.length > 1 ? callStart.preCall.shift()! : (callStart.preCall[0] ?? false)
  return marked ? { preCall: true, chargeId: "generate-script:claude-sonnet-5.5" } : (ledger ?? null)
}
vi.mock("../app-reports.js", () => ({ insertAppReport: reports.insert }))
// 554: the jobs' metered SIDE holds settle on their own markers after the
// flip (their own behaviour: llm-side-hold.test.ts).
const side = vi.hoisted(() => ({ settle: vi.fn(async (_ids: readonly string[]) => {}) }))
vi.mock("../llm-side-hold.js", () => ({ settleSideHoldsAfterFlip: side.settle }))

import { cancelOwnedJob, refundReservedHolds, settleMeteredHoldsBeforeCancel, settleMeteredHoldAfterFlip } from "../cancel-job.js"

const USER = "00000000-0000-4000-8000-000000000001"
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

/**
 * jobs: select().eq().single() for the lookup; update().eq().eq().in().select()
 * for the CAS. `reread` is what the SECOND single() answers — the status
 * re-read that tells a lost race apart from a row that got parked while we were
 * scanning the BullMQ queue.
 */
function jobsTable(
  lookup: Record<string, unknown> | null,
  flipped: Array<{ id: string }> = [{ id: JOB }],
  reread?: Record<string, unknown> | null,
  /** The row's billing ledger, for the D10 evidence read. */
  ledger?: unknown,
) {
  const answer = (row: Record<string, unknown> | null | undefined) =>
    row ? { data: row, error: null } : { data: null, error: { message: "not found" } }
  let reads = 0
  const single = vi.fn().mockImplementation(async () => {
    reads += 1
    return answer(reads === 1 || reread === undefined ? lookup : reread)
  })
  // …and the D10 evidence read of the job's billing ledger (select().eq().maybeSingle()): none.
  const select = vi.fn().mockReturnValue({
    // The post-flip batch's ledger read (`readLlmBillingLedgers`: select().in()).
    in: vi.fn(async () => ({ data: ledger === undefined ? [] : [{ id: JOB, llm_billing: ledgerColumn(ledger) }], error: null })),
    eq: vi.fn().mockReturnValue({
      single,
      maybeSingle: async () => {
        if (callStart.fail) return { data: null, error: { message: "timeout" } }
        if (ledger === undefined && callStart.at === null) return { data: null, error: null }
        return { data: { llm_billing: ledgerColumn(ledger), reconcile_attempts: 0, reconcile_last_error: null, provider_call_started_at: callStart.at }, error: null }
      },
    }),
  })
  const updateSelect = vi.fn().mockResolvedValue({ data: flipped, error: null })
  const inFn = vi.fn().mockReturnValue({ select: updateSelect })
  const eq2 = vi.fn().mockReturnValue({ in: inFn })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const update = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, update, _update: update, _in: inFn }
}
/** usage_logs: select().in().eq() → reserved rows (the refund), and select().eq().eq() (the D10 evidence read). */
function usageLogsTable(rows: Array<{ id: string; job_id?: string; action?: string }>, opts: { evidenceReadFails?: boolean } = {}) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error: null })
  const evidenceEq = vi.fn().mockResolvedValue(opts.evidenceReadFails ? { data: null, error: { message: "timeout" } } : { data: rows, error: null })
  const evidenceRead = vi.fn().mockReturnValue({ eq: evidenceEq })
  return { select: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue({ eq }), eq: evidenceRead }), _evidenceRead: evidenceRead }
}
function tables(jobs: ReturnType<typeof jobsTable>, logs = usageLogsTable([])) {
  mocks.from.mockImplementation((table: string) => {
    if (table === "jobs") return jobs
    if (table === "usage_logs") return logs
    throw new Error(`unexpected table ${table}`)
  })
}
const live = (extra: Record<string, unknown> = {}) => ({
  id: JOB, status: "pending", user_id: USER, input_data: {}, provider_task_id: null, reconcile_attempts: 0, ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.withdrawHeldJob.mockResolvedValue({ ok: true })
  actual.st.billed = false
  actual.st.readFailed = false
  actual.st.outcome = "charged"
  ledgerCancel.verdict.mockResolvedValue("not-metered")
  pricing.rollback = false
  // The metered schema is present (R33): the default once a release migrated.
  setLlmMeteredSchemaReadyForTesting(true)
  callStart.at = null
  callStart.fail = false
  callStart.preCall = []
})

describe("cancelOwnedJob", () => {
  it("not_found when the row is missing", async () => {
    tables(jobsTable(null))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "not_found" })
  })
  it("forbidden when another user owns it — nothing touched", async () => {
    const jobs = jobsTable(live({ user_id: "someone-else" }))
    tables(jobs)
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "forbidden" })
    expect(jobs._update).not.toHaveBeenCalled()
    expect(mocks.tryRemoveFromQueue).not.toHaveBeenCalled()
  })
  it("invalid_status for a terminal row", async () => {
    tables(jobsTable(live({ status: "completed" })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "invalid_status", status: "completed" })
  })
  it("in_flight when the provider task is out and the row is not in recovery", async () => {
    tables(jobsTable(live({ status: "processing", provider_task_id: "task-1" })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "in_flight" })
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })
  it("cancels an in-recovery row despite provider_task_id (audit D2)", async () => {
    tables(jobsTable(live({ status: "processing", provider_task_id: "task-1", reconcile_attempts: 2 })), usageLogsTable([{ id: "log-1" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.refundCredits).toHaveBeenCalledWith("log-1")
  })
  it("removes from the queue, CAS-flips, refunds every reserved log, and reports the analysis child", async () => {
    const child = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    tables(jobsTable(live({ input_data: { type: "llm-structured", analysisJobId: child } })), usageLogsTable([{ id: "log-1" }, { id: "log-2" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: child })
    expect(mocks.tryRemoveFromQueue).toHaveBeenCalledWith(JOB)
    expect(mocks.refundCredits).toHaveBeenCalledTimes(2)
  })
  it("a use-case wrapper: refunds its fee hold and stops its hidden run", async () => {
    tables(jobsTable(live({ status: "processing", provider: "use-case", input_data: { type: "tighten-episode", _executionId: "exec-in", _feeCredits: 10 } })), usageLogsTable([{ id: "fee-log" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.refundCredits).toHaveBeenCalledWith("fee-log")
    expect(inner.cancel).toHaveBeenCalledTimes(1)
    expect(inner.cancel).toHaveBeenCalledWith("exec-in", USER, expect.any(String))
  })
  it("a use-case wrapper whose stamp never landed: its run is found by the run's pointer and stopped", async () => {
    wrapperRun.find.mockResolvedValueOnce("exec-unstamped")
    tables(jobsTable(live({ status: "processing", provider: "use-case", input_data: { type: "tighten-episode", _feeCredits: 10 } })), usageLogsTable([{ id: "fee-log" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(wrapperRun.find).toHaveBeenCalledWith(JOB, USER)
    expect(inner.cancel).toHaveBeenCalledWith("exec-unstamped", USER, expect.any(String))
  })
  it("a use-case wrapper with no run anywhere (it never started): cancelled, nothing to stop", async () => {
    tables(jobsTable(live({ status: "processing", provider: "use-case", input_data: { type: "tighten-episode" } })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(inner.cancel).not.toHaveBeenCalled()
  })
  it("a use-case wrapper whose hidden run cannot be stopped is still cancelled", async () => {
    inner.cancel.mockRejectedValueOnce(new Error("db down"))
    tables(jobsTable(live({ status: "processing", provider: "use-case", input_data: { _executionId: "exec-in" } })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
  })
  it("a component wrapper, or a use-case wrapper whose CAS was lost, never stops a run here", async () => {
    tables(jobsTable(live({ status: "processing", provider: "component", input_data: { _executionId: "exec-in" } })))
    await cancelOwnedJob(JOB, USER)
    tables(jobsTable(live({ status: "processing", provider: "use-case", input_data: { _executionId: "exec-in" } }), []))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
    expect(inner.cancel).not.toHaveBeenCalled()
  })
  it("lost_race when the CAS flips no row — no refund (the terminal writer owns the credits)", async () => {
    tables(jobsTable(live(), []), usageLogsTable([{ id: "log-1" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// D17 — user cancel WINS over a held job.
//
// Two things stood in the way and both had to go. `CANCELLABLE_STATUSES`
// omitted `pending_review`, so the API answered 400 "cannot be cancelled" —
// while `node-executor.ts`'s DAG cancel flipped the same row anyway, which is
// the two halves of one product disagreeing. And even with the status added,
// a held job normally HAS a `provider_task_id` (the provider delivered; it is
// the PLATFORM holding the result), so the `provider_task_id && !inRecovery →
// in_flight` branch would have refused it forever.
//
// A reservation must not be strandable behind a reviewer's SLA.
// ---------------------------------------------------------------------------
describe("cancelOwnedJob — a job under review", () => {
  const held = (extra: Record<string, unknown> = {}) =>
    live({ status: "pending_review", provider_task_id: "task-out-at-the-provider", ...extra })

  it("cancels a held row instead of answering invalid_status", async () => {
    tables(jobsTable(held()))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.withdrawHeldJob).toHaveBeenCalledWith(JOB)
  })

  it("never routes a held row through in_flight, even with a provider task out", async () => {
    tables(jobsTable(held({ reconcile_attempts: 0 })))
    expect(await cancelOwnedJob(JOB, USER)).not.toEqual({ kind: "in_flight" })
  })

  it("skips the queue removal: the BullMQ entry is long gone by the time a job is held", async () => {
    tables(jobsTable(held()))
    await cancelOwnedJob(JOB, USER)
    expect(mocks.tryRemoveFromQueue).not.toHaveBeenCalled()
  })

  it("does not use the generic refund path — the withdrawal owns the refund, the object deletion and the audit row", async () => {
    tables(jobsTable(held()), usageLogsTable([{ id: "log-1" }]))
    await cancelOwnedJob(JOB, USER)
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })

  it("a lost race (a reviewer resolved it first) reports lost_race, not a false success", async () => {
    mocks.withdrawHeldJob.mockResolvedValue({ ok: false, reason: "lost_race" })
    tables(jobsTable(held()))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
  })

  it("still reports the analysis child so the caller can take it along", async () => {
    const child = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    tables(jobsTable(held({ input_data: { analysisJobId: child } })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: child })
  })

  it("ownership is still checked first — another user's held job is forbidden, not withdrawn", async () => {
    tables(jobsTable(held({ user_id: "someone-else" })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "forbidden" })
    expect(mocks.withdrawHeldJob).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The generic CAS and the eligibility check are NOT the same status set.
//
// `CANCELLABLE_STATUSES` is deliberately wide (D17: a parked row IS cancellable,
// through the withdrawal). The CAS is a different question — "which statuses may
// this UPDATE flip straight to `cancelled`?" — and `pending_review` is not one of
// them: the queue scan between the SELECT and the UPDATE is real work (two
// BullMQ getJobs sweeps plus a dynamic import), long enough for the result gate
// to park the row underneath us. Flipping it there loses everything the
// withdrawal exists to do: the withheld R2 objects are never deleted, the
// `held_*` columns stay populated on a cancelled row, and no `withdrawn`
// decision is ever recorded.
// ---------------------------------------------------------------------------
describe("cancelOwnedJob — a job parked between the read and the flip", () => {
  it("never lets the generic CAS flip a parked row", async () => {
    const jobs = jobsTable(live({ status: "processing" }))
    tables(jobs)
    await cancelOwnedJob(JOB, USER)
    expect(jobs._in).toHaveBeenCalledTimes(1)
    const statuses = jobs._in.mock.calls[0]![1] as string[]
    expect(statuses).not.toContain("pending_review")
    expect(statuses).toEqual(expect.arrayContaining(["pending", "queued", "processing"]))
  })

  it("routes a now-parked row through the withdrawal instead of answering lost_race", async () => {
    tables(jobsTable(live({ status: "processing" }), [], { status: "pending_review" }), usageLogsTable([{ id: "log-1" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.withdrawHeldJob).toHaveBeenCalledWith(JOB)
    // The withdrawal owns the refund (plus the object deletion and the audit row).
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })

  it("a withdrawal that itself loses the race is reported, not swallowed", async () => {
    mocks.withdrawHeldJob.mockResolvedValue({ ok: false, reason: "lost_race" })
    tables(jobsTable(live({ status: "processing" }), [], { status: "pending_review" }))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
  })

  it("a genuine terminal race is still lost_race — no withdrawal attempted", async () => {
    tables(jobsTable(live({ status: "processing" }), [], { status: "failed" }))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
    expect(mocks.withdrawHeldJob).not.toHaveBeenCalled()
  })

  it("a row that vanished between the read and the flip is lost_race, not a crash", async () => {
    tables(jobsTable(live({ status: "processing" }), [], null))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
    expect(mocks.withdrawHeldJob).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// D10 (metered LLM billing): a cancel never refunds a billed metered call. A
// metered hold whose job recorded a billed cost — e.g. one whose settle was
// not confirmed and now waits in the reconcile sweep's retry window — is
// committed by the sweep's own rule (`settleSweptMeteredLlmJob`), reused here.
// ---------------------------------------------------------------------------
describe("cancelOwnedJob — R45 (D14): a billed metered hold is settled at its ACTUAL, never committed whole", () => {
  const METERED = [{ id: "metered-log", job_id: JOB, action: "generate-script:claude-sonnet-5.5" }]

  it("nothing in flight (still pre-call) and an earlier BullMQ attempt billed: charged at the actual AFTER the flip (N1: nothing is committed while the row is live), once", async () => {
    callStart.at = "2026-10-20T10:00:00Z"
    callStart.preCall = [true]
    actual.st.billed = true
    const jobs = jobsTable(live({ status: "processing" }))
    tables(jobs, usageLogsTable(METERED))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(actual.rowSpend).toHaveBeenCalledWith(JOB, "generate-script:claude-sonnet-5.5")
    expect(actual.settle).toHaveBeenCalledTimes(1)
    expect(actual.settle).toHaveBeenCalledWith("metered-log", JOB, "generate-script:claude-sonnet-5.5", expect.objectContaining({ billedAnything: true }))
    expect(jobs._update.mock.invocationCallOrder[0]).toBeLessThan(actual.settle.mock.invocationCallOrder[0]!)
  })

  it("N1 race: pre-call at the verdict, the worker clears its marker and sends its call before the flip → nothing committed at the cancel (nothing free, nothing double): kept for the worker's own settle", async () => {
    callStart.at = "2026-10-20T10:00:00Z"
    callStart.preCall = [true, false] // pre-flip: marked; after the flip: the call started
    actual.st.billed = true
    const jobs = jobsTable(live({ status: "processing" }))
    tables(jobs, usageLogsTable(METERED))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(actual.settle).not.toHaveBeenCalled()
    expect(mocks.refundCredits).not.toHaveBeenCalled()
    expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-hold-unsettled-on-cancel", jobId: JOB }))
  })

  it("N1: the pre-flip verdict never settles — settleMeteredHoldsBeforeCancel on a live row with a billed earlier attempt answers not-started, no commit", async () => {
    callStart.at = "2026-10-20T10:00:00Z"
    callStart.preCall = [true]
    actual.st.billed = true
    tables(jobsTable(live({ status: "processing" })), usageLogsTable(METERED))
    expect(await settleMeteredHoldsBeforeCancel(JOB)).toBe("not-started")
    expect(actual.settle).not.toHaveBeenCalled()
    // …and after the flip the same read settles it at the actual.
    expect(await settleMeteredHoldsBeforeCancel(JOB, { afterFlip: true })).toBe("settled")
    expect(actual.settle).toHaveBeenCalledTimes(1)
  })

  it("a call in flight with something already billed (a lottie repair, a scene3d revision): nothing is committed — in_flight, the job finishes and settles at its actual", async () => {
    callStart.at = "2026-10-20T10:00:00Z"
    actual.st.billed = true
    const jobs = jobsTable(live({ status: "processing" }), [{ id: JOB }])
    tables(jobs, usageLogsTable(METERED))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "in_flight" })
    expect(actual.settle).not.toHaveBeenCalled()
    expect(jobs._update).not.toHaveBeenCalled()
    expect(mocks.refundCredits).not.toHaveBeenCalled()
    expect(mocks.tryRemoveFromQueue).not.toHaveBeenCalled()
  })

  it("an actual settle (after the flip) that is not confirmed keeps the hold reserved and reported — never refunded", async () => {
    callStart.preCall = [true]
    callStart.at = "2026-10-20T10:00:00Z"
    actual.st.billed = true
    actual.st.outcome = "unsettled"
    const jobs = jobsTable(live({ status: "processing" }), [{ id: JOB }])
    tables(jobs, usageLogsTable(METERED))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.refundCredits).not.toHaveBeenCalled()
    expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-hold-unsettled-on-cancel", jobId: JOB }))
  })

  it("the row's billing cannot be read after the flip: never settled or refunded on a guess — kept and reported", async () => {
    callStart.preCall = [true]
    callStart.at = "2026-10-20T10:00:00Z"
    actual.st.readFailed = true
    const jobs = jobsTable(live({ status: "processing" }), [{ id: JOB }])
    tables(jobs, usageLogsTable(METERED))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(actual.settle).not.toHaveBeenCalled()
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })

  it("a scrape-shaped job (fixed-id hold) whose analyses billed: the ledger rule commits them only AFTER the flip (N1)", async () => {
    ledgerCancel.verdict.mockResolvedValue("settled")
    const jobs = jobsTable(live({ input_data: { type: "meta-ads-scrape" } }), undefined, undefined, { costUsd: 0.05, calls: 3, lanes: ["kie"], chargeId: "meta-ads-analysis:claude-sonnet-5.5" })
    tables(jobs, usageLogsTable([{ id: "scrape-log", job_id: JOB, action: "meta-ads-scrape:100" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(ledgerCancel.verdict).toHaveBeenCalledTimes(1)
    expect(ledgerCancel.verdict).toHaveBeenCalledWith(JOB)
    expect(ledgerCancel.verdict.mock.invocationCallOrder[0]).toBeGreaterThan(jobs._update.mock.invocationCallOrder[0]!)
  })

  it("N1 race: an analysis billed between the pre-flip read and the flip is in the commit — nothing was committed while the row was live", async () => {
    // The scrape's ledger as the settle would read it when called: 2 calls at
    // the pre-flip read, 3 once the in-flight analysis lands (before the flip).
    const ledger = { calls: 2 }
    const seen: number[] = []
    ledgerCancel.verdict.mockImplementation(async () => (seen.push(ledger.calls), "settled"))
    const jobs = jobsTable(live({ input_data: { type: "meta-ads-scrape" } }), undefined, undefined, { costUsd: 0.05, calls: 2, lanes: ["kie"], chargeId: "meta-ads-analysis:claude-sonnet-5.5" })
    const flip = jobs._update.getMockImplementation()!
    jobs._update.mockImplementation((...a: unknown[]) => ((ledger.calls = 3), flip(...a)))
    tables(jobs, usageLogsTable([{ id: "scrape-log", job_id: JOB, action: "meta-ads-scrape:100" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(seen).toEqual([3])
  })

  it("the DAG / resume shape: before the flip the billed ledger answers not-started and commits nothing; after it, it settles", async () => {
    ledgerCancel.verdict.mockResolvedValue("settled")
    tables(jobsTable(live(), undefined, undefined, { costUsd: 0.05, calls: 3, lanes: ["kie"], chargeId: "meta-ads-analysis:claude-sonnet-5.5" }), usageLogsTable([{ id: "scrape-log", job_id: JOB, action: "meta-ads-scrape:100" }]))
    expect(await settleMeteredHoldsBeforeCancel(JOB)).toBe("not-started")
    expect(ledgerCancel.verdict).not.toHaveBeenCalled()
    expect(await settleMeteredHoldAfterFlip(JOB)).toBe("settled")
    expect(ledgerCancel.verdict).toHaveBeenCalledTimes(1)
  })
})

describe("N1 for the scrapes: an analysis call in flight is evidence — never refunded on a guess", () => {
  it("a ledger with only a call in flight (nothing billed yet) answers billed-ledger before the flip (nothing committed), and the after-flip rule decides", async () => {
    ledgerCancel.verdict.mockResolvedValue("retry")
    const inFlight = { costUsd: 0, source: "floor", calls: 0, lanes: [], chargeId: "meta-ads-analysis:claude-sonnet-5.5", inFlight: 1 }
    tables(jobsTable(live(), undefined, undefined, inFlight), usageLogsTable([{ id: "scrape-log", job_id: JOB, action: "meta-ads-scrape:100" }]))
    expect(await settleMeteredHoldsBeforeCancel(JOB)).toBe("not-started")
    expect(ledgerCancel.verdict).not.toHaveBeenCalled()
    // After the flip the ledger rule keeps it (the call is in flight): kept, never refunded.
    expect(await settleMeteredHoldAfterFlip(JOB)).toBe("kept")
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })

  it("the post-flip batch keeps the hold of a job whose call is in flight", async () => {
    ledgerCancel.verdict.mockResolvedValue("retry")
    const inFlight = { costUsd: 0, source: "floor", calls: 0, lanes: [], chargeId: "meta-ads-analysis:claude-sonnet-5.5", inFlight: 1 }
    tables(jobsTable(live(), undefined, undefined, inFlight), usageLogsTable([{ id: "scrape-log", job_id: JOB, action: "meta-ads-scrape:100" }]))
    await refundReservedHolds([JOB])
    expect(ledgerCancel.verdict).toHaveBeenCalledWith(JOB)
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })
})

describe("554: metered SIDE holds — settled on their own markers after the flip, never part of the job's decision", () => {
  it("a single cancel settles the job's side holds after its flip", async () => {
    const jobs = jobsTable(live())
    tables(jobs)
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(side.settle).toHaveBeenCalledWith([JOB])
    expect(side.settle.mock.invocationCallOrder[0]).toBeGreaterThan(jobs._update.mock.invocationCallOrder[0]!)
  })

  it("a cancel that did not flip the row (in flight, lost race) never touches them", async () => {
    tables(jobsTable(live({ provider_task_id: "task-1" })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "in_flight" })
    tables(jobsTable(live(), [], { status: "completed" }))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
    expect(side.settle).not.toHaveBeenCalled()
  })

  it("the batch refund (cancel-all, a workflow cancel) settles every flipped job's side holds — even one with no hold of its own", async () => {
    tables(jobsTable(live()), usageLogsTable([]))
    await refundReservedHolds([JOB, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"])
    expect(side.settle).toHaveBeenCalledWith([JOB, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"])
  })
})

// R36: a metered hold with no billed cost recorded whose provider call has
// STARTED is billed-unknown (the call may still bill) — never refunded.
describe("R36: a started provider call on a metered hold with no ledger yet is billed-unknown — kept, never refunded", () => {
  const METERED = [{ id: "metered-log", job_id: JOB, action: "generate-script:claude-sonnet-5.5" }]

  it("single cancel: nothing billed recorded, but the call started → in_flight (no flip, no refund)", async () => {
    callStart.at = "2026-10-20T10:00:00Z"
    const jobs = jobsTable(live())
    tables(jobs, usageLogsTable(METERED))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "in_flight" })
    expect(actual.settle).not.toHaveBeenCalled()
    expect(jobs._update).not.toHaveBeenCalled()
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })

  it("single cancel: the call never started → today's cancel (flip + refund)", async () => {
    tables(jobsTable(live()), usageLogsTable(METERED))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.refundCredits).toHaveBeenCalledWith("metered-log")
  })

  it("single cancel: whether the call started cannot be read → kept (in_flight), never refunded on a guess", async () => {
    callStart.fail = true
    const jobs = jobsTable(live())
    tables(jobs, usageLogsTable(METERED))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "in_flight" })
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })

  it("a started call on a TIER hold is never asked (rollback byte-identical): flip + refund", async () => {
    callStart.at = "2026-10-20T10:00:00Z"
    tables(jobsTable(live()), usageLogsTable([{ id: "tier-log", job_id: JOB, action: "generate-script:economy" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(actual.rowSpend).not.toHaveBeenCalled()
    expect(mocks.refundCredits).toHaveBeenCalledWith("tier-log")
  })
})

// R38: a metered WORKER job is stamped at pickup, long before its first call;
// the worker marks it pre-call until that call. A cancel that finds the marker
// refunds at once — nothing was sent. A worker that wins the race to its call
// between the pre-flip read and the flip is caught by the read AFTER the flip.
describe("R38: a metered worker job cancelled before its first call (pre-call marker) is refunded at once", () => {
  const METERED = [{ id: "metered-log", job_id: JOB, action: "generate-script:claude-sonnet-5.5" }]

  it("single cancel: stamped at pickup but still pre-call → flip + refund", async () => {
    callStart.at = "2026-10-20T10:00:00Z"
    callStart.preCall = [true]
    const jobs = jobsTable(live({ status: "processing" }))
    tables(jobs, usageLogsTable(METERED))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.refundCredits).toHaveBeenCalledWith("metered-log")
    expect(reports.insert).not.toHaveBeenCalled()
  })

  it("single cancel: pre-call before the flip, but the worker's call started before the flip landed → kept after the flip, reported (never refunded)", async () => {
    callStart.at = "2026-10-20T10:00:00Z"
    callStart.preCall = [true, false]
    const jobs = jobsTable(live({ status: "processing" }))
    tables(jobs, usageLogsTable(METERED))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.refundCredits).not.toHaveBeenCalled()
    expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-hold-unsettled-on-cancel", jobId: JOB }))
  })

  it("settleMeteredHoldAfterFlip (the DAG and resume cancels' post-flip re-read): started meanwhile → kept + reported; still pre-call → refund", async () => {
    callStart.at = "2026-10-20T10:00:00Z"
    tables(jobsTable(live({ status: "cancelled" })), usageLogsTable(METERED))
    expect(await settleMeteredHoldAfterFlip(JOB)).toBe("kept")
    // m3: a warning — the hold is not stranded (the worker or the sweep settles it).
    expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({
      kind: "metered-hold-unsettled-on-cancel",
      jobId: JOB,
      severity: "warning",
      title: expect.stringContaining("kept — settled by the worker or sweep"),
    }))
    reports.insert.mockClear()
    callStart.preCall = [true]
    expect(await settleMeteredHoldAfterFlip(JOB)).toBe("refund")
    expect(reports.insert).not.toHaveBeenCalled()
    // An earlier attempt billed: settled at the actual (after the flip — the worker's CAS can no longer win).
    actual.st.billed = true
    expect(await settleMeteredHoldAfterFlip(JOB)).toBe("settled")
    expect(actual.settle).toHaveBeenCalledTimes(1)
  })

  it("batch (post-flip): a pre-call job is refunded, no report", async () => {
    callStart.at = "2026-10-20T10:00:00Z"
    callStart.preCall = [true]
    mocks.from.mockImplementation((table: string) => {
      if (table === "usage_logs") return usageLogsTable(METERED)
      if (table === "jobs") return jobsTable(live())
      throw new Error(`unexpected table ${table}`)
    })
    await refundReservedHolds([JOB])
    expect(mocks.refundCredits).toHaveBeenCalledWith("metered-log")
    expect(reports.insert).not.toHaveBeenCalled()
  })
})

describe("refundReservedHolds — cancel-all's batch, per job (D10)", () => {
  const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  // jobs: the batch's ledger read (select().in()) and one job's sweep counters (select().eq().maybeSingle()).
  let ledgers: Array<{ id: string; llm_billing?: unknown }> = []
  const jobsCounters = () => ({
    select: vi.fn().mockReturnValue({
      in: vi.fn(async () => ({ data: ledgers, error: null })),
      eq: vi.fn().mockReturnValue({
        maybeSingle: async () => ({
          data: { reconcile_attempts: 0, reconcile_last_error: null, llm_billing: ledgerColumn(ledgers[0]?.llm_billing), provider_call_started_at: callStart.at },
          error: null,
        }),
      }),
    }),
  })
  beforeEach(() => { ledgers = [] })
  function batch(rows: Array<{ id: string; job_id: string; action: string }>) {
    mocks.from.mockImplementation((table: string) => {
      if (table === "usage_logs") return usageLogsTable(rows)
      if (table === "jobs") return jobsCounters()
      throw new Error(`unexpected table ${table}`)
    })
  }

  it("a job whose billed metered hold cannot be settled keeps it reserved; the rest of the batch is refunded", async () => {
    batch([
      { id: "metered-log", job_id: JOB, action: "generate-script:claude-sonnet-5.5" },
      { id: "tier-log", job_id: OTHER, action: "nano-banana" },
    ])
    // Nothing in flight, billed by an earlier attempt, and its settle not confirmed.
    callStart.at = "2026-10-20T10:00:00Z"
    callStart.preCall = [true]
    actual.st.billed = true
    actual.st.outcome = "unsettled"
    await refundReservedHolds([JOB, OTHER])
    // Only the job holding a metered reservation is asked.
    expect(actual.rowSpend).toHaveBeenCalledTimes(1)
    expect(actual.rowSpend.mock.calls[0]![0]).toBe(JOB)
    expect(mocks.refundCredits).toHaveBeenCalledTimes(1)
    expect(mocks.refundCredits).toHaveBeenCalledWith("tier-log")
  })

  it("an unbilled metered hold is refunded like any other", async () => {
    batch([{ id: "metered-log", job_id: JOB, action: "llm-structured:claude-opus-5.5" }])
    await refundReservedHolds([JOB])
    expect(mocks.refundCredits).toHaveBeenCalledWith("metered-log")
  })

  it("a scrape-shaped job (one FIXED-id hold, billed analyses in its server-only ledger) is checked by its ledger: committed, never refunded", async () => {
    batch([{ id: "scrape-log", job_id: JOB, action: "meta-ads-scrape:100" }])
    ledgers = [{ id: JOB, llm_billing: { costUsd: 0.05, source: "kie-stated", calls: 3, lanes: ["kie"], chargeId: "meta-ads-analysis:claude-sonnet-5.5" } }]
    // Not a metered usage-log id: the sweep's rule is never asked (no reconcile bump); the ledger commits what was billed.
    ledgerCancel.verdict.mockResolvedValue("settled")
    await refundReservedHolds([JOB])
    expect(actual.rowSpend).not.toHaveBeenCalled()
    expect(ledgerCancel.verdict).toHaveBeenCalledWith(JOB)
  })

  it("a scrape whose billed ledger could not be committed keeps its hold reserved (never refunded)", async () => {
    batch([{ id: "scrape-log", job_id: JOB, action: "instagram-scrape:50" }])
    ledgers = [{ id: JOB, llm_billing: { costUsd: 0.02, calls: 1, lanes: ["kie"], chargeId: "instagram-analysis:claude-sonnet-5.5" } }]
    ledgerCancel.verdict.mockResolvedValue("retry")
    await refundReservedHolds([JOB])
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })

  it("R36: a batch job whose metered call started but recorded nothing billed keeps its hold, reported; the rest is refunded", async () => {
    batch([
      { id: "metered-log", job_id: JOB, action: "generate-script:claude-sonnet-5.5" },
      { id: "tier-log", job_id: OTHER, action: "nano-banana" },
    ])
    callStart.at = "2026-10-20T10:00:00Z"
    await refundReservedHolds([JOB, OTHER])
    expect(mocks.refundCredits).toHaveBeenCalledTimes(1)
    expect(mocks.refundCredits).toHaveBeenCalledWith("tier-log")
    expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-hold-unsettled-on-cancel", jobId: JOB }))
  })

  it("no metered hold in the batch: no metered check at all (today's refund)", async () => {
    batch([{ id: "tier-log", job_id: OTHER, action: "generate-script:economy" }])
    await refundReservedHolds([OTHER])
    expect(actual.rowSpend).not.toHaveBeenCalled()
    expect(mocks.refundCredits).toHaveBeenCalledWith("tier-log")
  })
})

// MINOR 5 (rollback byte-identity): a job with no metered billing evidence —
// every job under the rollback — never reaches the sweep's rule, so a read
// error there can neither answer `retry` nor bump reconcile_attempts.
describe("settleMeteredHoldsBeforeCancel — no metered evidence keeps today's path untouched", () => {
  it("a tier hold (rollback) and no ledger: not-metered, the sweep's rule never asked, cancel proceeds", async () => {
    const jobs = jobsTable(live())
    tables(jobs, usageLogsTable([{ id: "tier-log", job_id: JOB, action: "generate-script:economy" }]))
    callStart.at = "2026-10-20T10:00:00Z" // would turn the cancel into in_flight if it were asked
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(actual.rowSpend).not.toHaveBeenCalled()
    expect(ledgerCancel.verdict).not.toHaveBeenCalled()
    expect(mocks.refundCredits).toHaveBeenCalledWith("tier-log")
  })

  it("a job with no reserved hold at all: nothing asked", async () => {
    tables(jobsTable(live()), usageLogsTable([]))
    callStart.at = "2026-10-20T10:00:00Z"
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(actual.rowSpend).not.toHaveBeenCalled()
  })
})

// I-1 (D10): an evidence READ FAILURE is never a refund wherever a metered hold
// can exist — the metered schema is present, whatever the pricing switch says
// (R15: a hold reserved before a rollback flip is still metered). Only a
// database without the schema keeps today's cancel.
describe("an evidence read failure never refunds on a guess (D10)", () => {
  it("single cancel: the holds cannot be read → retry → in_flight (not flipped, nothing refunded) and reported", async () => {
    const jobs = jobsTable(live())
    tables(jobs, usageLogsTable([{ id: "log-1", job_id: JOB, action: "generate-script:claude-sonnet-5.5" }], { evidenceReadFails: true }))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "in_flight" })
    expect(jobs._update).not.toHaveBeenCalled()
    expect(mocks.refundCredits).not.toHaveBeenCalled()
    expect(actual.rowSpend).not.toHaveBeenCalled()
    expect(reports.insert).toHaveBeenCalledTimes(1)
    expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-cancel-evidence-unreadable", jobId: JOB }))
  })

  it("single cancel under the ROLLBACK: a metered hold reserved before the flip may be behind the failed read — kept, never refunded (R15)", async () => {
    pricing.rollback = true
    const jobs = jobsTable(live())
    tables(jobs, usageLogsTable([{ id: "log-1", job_id: JOB, action: "generate-script:claude-sonnet-5.5" }], { evidenceReadFails: true }))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "in_flight" })
    expect(jobs._update).not.toHaveBeenCalled()
    expect(mocks.refundCredits).not.toHaveBeenCalled()
    expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-cancel-evidence-unreadable", jobId: JOB }))
  })

  it("single cancel BEFORE this process's R33 probe answered: the database is asked now — a present schema keeps the hold", async () => {
    // A fresh process: the cached gate says "not ready", the database has the schema.
    const probe = vi.fn(async () => true)
    setLlmMeteredSchemaReadyForTesting(false, probe)
    const jobs = jobsTable(live())
    tables(jobs, usageLogsTable([{ id: "log-1", job_id: JOB, action: "generate-script:claude-sonnet-5.5" }], { evidenceReadFails: true }))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "in_flight" })
    expect(probe).toHaveBeenCalled()
    expect(jobs._update).not.toHaveBeenCalled()
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })

  it("single cancel on a database WITHOUT the metered schema (no metered hold can exist): the read failure is today's cancel (flip + refund)", async () => {
    setLlmMeteredSchemaReadyForTesting(false, async () => false)
    tables(jobsTable(live()), usageLogsTable([{ id: "log-1", job_id: JOB, action: "generate-script:economy" }], { evidenceReadFails: true }))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.refundCredits).toHaveBeenCalledWith("log-1")
    expect(reports.insert).not.toHaveBeenCalled()
  })

  it("batch: a metered hold the batch already read is settled WITHOUT a re-read (a failing re-read cannot refund it)", async () => {
    const logs = usageLogsTable([{ id: "metered-log", job_id: JOB, action: "generate-script:claude-sonnet-5.5" }], { evidenceReadFails: true })
    mocks.from.mockImplementation((table: string) => {
      if (table === "usage_logs") return logs
      return { select: vi.fn().mockReturnValue({ in: vi.fn(async () => ({ data: [], error: null })), eq: vi.fn().mockReturnValue({ maybeSingle: async () => ({ data: { reconcile_attempts: 0, reconcile_last_error: null, provider_call_started_at: callStart.at }, error: null }) }) }) }
    })
    // The call started (the row read below says so): kept — and the batch's
    // own hold read is not repeated by the evidence read.
    callStart.at = "2026-10-20T10:00:00Z"
    await refundReservedHolds([JOB])
    expect(logs._evidenceRead).not.toHaveBeenCalled()
    expect(mocks.refundCredits).not.toHaveBeenCalled()
    expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-hold-unsettled-on-cancel", jobId: JOB }))
  })

  it("batch: the batch's ledger read fails → every unread job keeps its hold and is reported (never refunded on a guess)", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "usage_logs") return usageLogsTable([{ id: "scrape-log", job_id: JOB, action: "meta-ads-scrape:100" }])
      return { select: vi.fn().mockReturnValue({ in: vi.fn(async () => ({ data: null, error: { message: "timeout" } })) }) }
    })
    await refundReservedHolds([JOB])
    expect(mocks.refundCredits).not.toHaveBeenCalled()
    expect(reports.insert).toHaveBeenCalledTimes(1)
    expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-hold-unsettled-on-cancel", jobId: JOB }))
    expect(ledgerCancel.verdict).not.toHaveBeenCalled()
  })

  it("batch under the rollback: the same failed ledger read keeps the hold (a billed ledger from before the flip may be behind it)", async () => {
    pricing.rollback = true
    mocks.from.mockImplementation((table: string) => {
      if (table === "usage_logs") return usageLogsTable([{ id: "scrape-log", job_id: JOB, action: "meta-ads-scrape:100" }])
      return { select: vi.fn().mockReturnValue({ in: vi.fn(async () => ({ data: null, error: { message: "timeout" } })) }) }
    })
    await refundReservedHolds([JOB])
    expect(mocks.refundCredits).not.toHaveBeenCalled()
    expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-hold-unsettled-on-cancel", jobId: JOB }))
  })

  it("batch on a database without the metered schema: the same failed ledger read refunds as today", async () => {
    setLlmMeteredSchemaReadyForTesting(false, async () => false)
    mocks.from.mockImplementation((table: string) => {
      if (table === "usage_logs") return usageLogsTable([{ id: "tier-log", job_id: JOB, action: "generate-script:economy" }])
      return { select: vi.fn().mockReturnValue({ in: vi.fn(async () => ({ data: null, error: { message: "timeout" } })) }) }
    })
    await refundReservedHolds([JOB])
    expect(mocks.refundCredits).toHaveBeenCalledWith("tier-log")
    expect(reports.insert).not.toHaveBeenCalled()
  })
})

// R63: only a hold that can carry a ledger (a metered LLM id, a fixed + calls
// scrape id) consults the job's billing evidence. Every other hold refunds as
// before, with no ledger read — so a failed ledger read never keeps an image's
// hold, nor leaves its job live / in flight.
describe("R63: a ledger read failure never keeps a hold that cannot carry a ledger", () => {
  const J_IMG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const J_LLM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  const ROWS = [
    { id: "image-log", job_id: J_IMG, action: "generate-image:flux-2-pro" },
    { id: "scrape-log", job_id: JOB, action: "meta-ads-scrape:100" },
    { id: "metered-log", job_id: J_LLM, action: "generate-script:claude-sonnet-5.5" },
  ]
  /** usage_logs: the batch read (select().in().eq()) and a per-job evidence read (select().eq(job_id).eq(status)) filtered by job. */
  function logs(rows = ROWS) {
    return {
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ data: rows, error: null })) }),
        eq: vi.fn((_c: string, jobId: string) => ({ eq: vi.fn(async () => ({ data: rows.filter((r) => r.job_id === jobId), error: null })) })),
      }),
    }
  }
  /** jobs: the batch ledger read (select().in()) answers `batch` in turn (the last repeats); every per-row read fails. */
  function jobs(batch: Array<{ data: unknown; error: unknown }>) {
    const inRead = vi.fn(async (_c: string, _ids: string[]) => (batch.length > 1 ? batch.shift()! : batch[0]!))
    return {
      inRead,
      select: vi.fn().mockReturnValue({
        in: inRead,
        eq: vi.fn().mockReturnValue({ maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) }),
      }),
    }
  }

  it("batch: a failing ledger read refunds the IMAGE job's hold, keeps the scrape's and the metered job's; the ledger is asked only for the scrape", async () => {
    const j = jobs([{ data: null, error: { message: "timeout" } }])
    mocks.from.mockImplementation((t: string) => (t === "usage_logs" ? logs() : j))
    await refundReservedHolds([J_IMG, JOB, J_LLM])
    expect(mocks.refundCredits).toHaveBeenCalledWith("image-log")
    expect(mocks.refundCredits).not.toHaveBeenCalledWith("scrape-log")
    expect(mocks.refundCredits).not.toHaveBeenCalledWith("metered-log")
    for (const [, ids] of j.inRead.mock.calls) expect(ids).toEqual([JOB])
    expect(reports.insert).not.toHaveBeenCalledWith(expect.objectContaining({ jobId: J_IMG }))
  })

  it("batch: the ledger read is retried once before anything is declared unknown", async () => {
    const j = jobs([{ data: null, error: { message: "timeout" } }, { data: [{ id: JOB, llm_billing: { calls: 2 } }], error: null }])
    mocks.from.mockImplementation((t: string) => (t === "usage_logs" ? logs(ROWS.slice(1, 2)) : j))
    ledgerCancel.verdict.mockResolvedValue("settled")
    await refundReservedHolds([JOB])
    expect(j.inRead).toHaveBeenCalledTimes(2)
    expect(ledgerCancel.verdict).toHaveBeenCalledWith(JOB)
    expect(reports.insert).not.toHaveBeenCalled()
  })

  it("single cancel of an IMAGE job whose row reads fail: cancelled and refunded, never in_flight", async () => {
    callStart.fail = true
    const jobsT = jobsTable(live(), [{ id: JOB }], undefined, { calls: 1 })
    tables(jobsT, usageLogsTable([{ id: "image-log", job_id: JOB, action: "generate-image:flux-2-pro" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.refundCredits).toHaveBeenCalledWith("image-log")
  })

  it("DAG / resume (settleMeteredHoldsBeforeCancel): a tier or image job is not-metered with no ledger read, whatever the rollback says", async () => {
    pricing.rollback = true
    callStart.fail = true
    tables(jobsTable(live(), [{ id: JOB }], undefined, { calls: 1 }), usageLogsTable([{ id: "tier-log", job_id: JOB, action: "generate-script:economy" }]))
    expect(await settleMeteredHoldsBeforeCancel(JOB)).toBe("not-metered")
  })

  it("DAG / resume: a scrape hold whose ledger cannot be read is still never refunded on a guess", async () => {
    callStart.fail = true
    tables(jobsTable(live(), [{ id: JOB }], undefined, { calls: 1 }), usageLogsTable([{ id: "scrape-log", job_id: JOB, action: "meta-ads-scrape:100" }]))
    expect(await settleMeteredHoldsBeforeCancel(JOB)).toBe("retry")
  })
})
