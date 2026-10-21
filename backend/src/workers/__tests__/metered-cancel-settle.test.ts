/**
 * R38: a metered LLM worker job and a cancel.
 *
 *  - Pre-call marker: the row is marked "pre-call" from the moment the job's
 *    metered billing opens until immediately before its first LLM call, so a
 *    cancel in between refunds at once (a picked-up job is stamped long before
 *    its call). `callStarting()` clears it and stamps the call's start, CAS on
 *    a live status — a row cancelled first never gets its call.
 *  - Settle on cancel: a job whose row was cancelled while it ran still
 *    settles — billed actual charged, an unbilled hold refunded — and the row
 *    stays cancelled. Gated on a metered spend: a tier job's error costs no
 *    read (the rollback is byte-identical).
 *
 * Drives the REAL `workerLlmBilling` / `settleCancelledMeteredJob` against an
 * in-memory jobs row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = {
  id: string
  status: string
  provider_call_started_at: string | null
  provider_cost: number | null
  llm_billing: Record<string, unknown> | null
}

const h = vi.hoisted(() => ({
  row: null as unknown as Row,
  action: "generate-script:claude-sonnet-5.5",
  /** The reservation's usage log cannot be read (m1: an "unknown" reservation). */
  logReadFails: false,
  /** The usage log's status. */
  logStatus: "reserved",
  /** Metered pricing live (false: the rollback). */
  meteredPricing: true,
  /** Every jobs query: "select:<cols>" or "update:<keys>". */
  jobsQueries: [] as string[],
  settle: vi.fn(async (_log: string, _job: string, _charge: string, spend: { billedAnything: boolean }) =>
    spend.billedAnything ? { outcome: "charged", charged: 7, shortfall: 0 } : { outcome: "refunded" }),
  reports: vi.fn(async (_r: unknown) => true),
}))

/** A tiny PostgREST stand-in over ONE jobs row: eq / in / or(is.null, eq, lt) filters, select and update. */
function jobsQuery() {
  const filters: Array<(r: Row) => boolean> = []
  let patch: Record<string, unknown> | null = null
  let cols = ""
  const field = (r: Row, col: string): unknown => {
    const json = col.match(/^(\w+)->>(\w+)$/)
    if (json) {
      const v = (r as unknown as Record<string, Record<string, unknown> | null>)[json[1]!]?.[json[2]!]
      return v === undefined || v === null ? null : String(v)
    }
    return (r as unknown as Record<string, unknown>)[col]
  }
  const clause = (c: string): ((r: Row) => boolean) => {
    const m = c.match(/^(.+?)\.(is|eq|lt)\.(.+)$/)!
    const [, col, op, val] = m
    if (op === "is") return (r) => field(r, col!) === null
    if (op === "lt") return (r) => { const v = field(r, col!); return typeof v === "number" && v < Number(val) }
    return (r) => String(field(r, col!)) === val
  }
  const run = async () => {
    const r = h.row
    if (patch) {
      h.jobsQueries.push(`update:${Object.keys(patch).sort().join(",")}`)
      const hit = filters.every((f) => f(r))
      if (hit) Object.assign(r, patch)
      return { data: hit ? [{ id: r.id }] : [], error: null }
    }
    h.jobsQueries.push(`select:${cols}`)
    return { data: { ...r }, error: null }
  }
  const b: Record<string, unknown> = {
    select: (c: string) => { if (!patch) cols = c; return b },
    update: (p: Record<string, unknown>) => { patch = p; return b },
    eq: (col: string, val: unknown) => { filters.push((r) => field(r, col) === val || String(field(r, col)) === String(val)); return b },
    in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(field(r, col))); return b },
    or: (expr: string) => { const parts = expr.split(",").map(clause); filters.push((r) => parts.some((p) => p(r))); return b },
    maybeSingle: run,
    single: run,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
  }
  return b
}

vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasCredits: () => true,
  llmMeteredPricing: () => h.meteredPricing,
}))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "usage_logs") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => (h.logReadFails ? { data: null, error: { message: "timeout" } } : { data: { action: h.action, status: h.logStatus }, error: null }) }) }) }
      }
      if (table === "jobs") return jobsQuery()
      throw new Error(`unexpected table ${table}`)
    },
  },
}))
vi.mock("../../lib/llm-billing.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/llm-billing.js")>()),
  settleLlmUsageLog: h.settle,
}))
vi.mock("../../lib/app-reports.js", () => ({ insertAppReport: h.reports }))

import { attachLlmSpend, settleCancelledMeteredJob, settleDiscardedCancelledMeteredHold, workerLlmBilling } from "../shared.js"
import { JobCancelledError } from "../../lib/job-cancellation.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../lib/llm-metered-schema-gate.js"
import type { LlmRequest, LlmResponse } from "../../lib/llm/types.js"

const ctx = { jobId: "job-1", usageLogId: "usage-1" }
const job = { attemptsMade: 0, opts: { attempts: 3 } }
const MODEL = "claude-sonnet-5.5"
const PICKUP = "2026-10-20T10:00:00.000Z"
const request: LlmRequest = { modelId: MODEL, system: "S".repeat(1200), messages: [{ role: "user", content: "write a heist" }] }
const answer = (creditsUsd: number): LlmResponse =>
  ({ text: "…", usage: { inputTokens: 900, outputTokens: 700 }, creditsUsd, lane: "kie" }) as LlmResponse

beforeEach(() => {
  vi.clearAllMocks()
  h.action = "generate-script:claude-sonnet-5.5"
  h.logReadFails = false
  h.logStatus = "reserved"
  h.meteredPricing = true
  setLlmMeteredSchemaReadyForTesting(true)
  h.jobsQueries = []
  // Picked up: processing, stamped by the video worker's pickup (the crash backstop).
  h.row = { id: "job-1", status: "processing", provider_call_started_at: PICKUP, provider_cost: null, llm_billing: null }
})

describe("R38: the pre-call marker", () => {
  it("opening a metered job's billing marks the row pre-call; callStarting clears it and stamps the call's start, once", async () => {
    const billing = await workerLlmBilling(ctx, job)
    expect(h.row.llm_billing).toEqual({ preCall: true, chargeId: "generate-script:claude-sonnet-5.5" })
    await billing.callStarting()
    expect(h.row.llm_billing).toBeNull()
    expect(h.row.provider_call_started_at).not.toBe(PICKUP)
    const writes = h.jobsQueries.filter((q) => q.startsWith("update")).length
    await billing.callStarting()
    expect(h.jobsQueries.filter((q) => q.startsWith("update"))).toHaveLength(writes)
  })

  it("a billed earlier attempt's ledger is never replaced by the marker (the cancel then keeps the hold)", async () => {
    const ledger = { costUsd: 0.02, source: "kie-stated", calls: 1, lanes: ["kie"], chargeId: "generate-script:claude-sonnet-5.5", attempts: [] }
    h.row.llm_billing = ledger
    const billing = await workerLlmBilling(ctx, job)
    expect(h.row.llm_billing).toEqual(ledger)
    await billing.callStarting()
    expect(h.row.llm_billing).toEqual(ledger)
  })

  it("a crashed earlier attempt's marker is taken over (and cleared before this attempt's call)", async () => {
    h.row.llm_billing = { preCall: true, chargeId: "generate-script:claude-sonnet-5.5" }
    const billing = await workerLlmBilling(ctx, job)
    await billing.callStarting()
    expect(h.row.llm_billing).toBeNull()
  })

  it("cancelled before the first call: callStarting throws JobCancelledError and sends nothing; the settle refunds the hold (row stays cancelled)", async () => {
    const billing = await workerLlmBilling(ctx, job)
    h.row.status = "cancelled" // the user cancels during the pre-call window
    const err = await billing.callStarting().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JobCancelledError)
    // The marker stays: a later read by the cancel or the sweep still says "not started".
    expect(h.row.llm_billing).toMatchObject({ preCall: true })
    expect(await settleCancelledMeteredJob(ctx.usageLogId, ctx.jobId, attachLlmSpend(err, billing.spend))).toBe(true)
    expect(h.settle).toHaveBeenCalledTimes(1)
    expect((h.settle.mock.calls[0]![3] as { billedAnything: boolean }).billedAnything).toBe(false)
    expect(h.row.status).toBe("cancelled")
  })

  it("an unmarked row already cancelled is not sent its call either", async () => {
    h.row.status = "cancelled" // cancelled before billing opened: the marker write misses
    const billing = await workerLlmBilling(ctx, job)
    expect(h.row.llm_billing).toBeNull()
    await expect(billing.callStarting()).rejects.toBeInstanceOf(JobCancelledError)
  })

  it("a tier hold (rollback) writes no marker and its callStarting is a no-op", async () => {
    h.action = "generate-script:economy"
    const billing = await workerLlmBilling(ctx, job)
    await billing.callStarting()
    expect(h.jobsQueries.filter((q) => q.startsWith("update"))).toEqual([])
    expect(h.row.llm_billing).toBeNull()
  })
})

describe("R38: a metered job whose row was cancelled while it ran still settles", () => {
  it("cancelled after a billed call (JobCancelledError): the billed actual is charged, the row stays cancelled", async () => {
    const billing = await workerLlmBilling(ctx, job)
    await billing.callStarting()
    billing.recorder.add(MODEL, request, { response: answer(0.02) })
    await billing.noteSpend()
    h.row.status = "cancelled"
    const handled = await settleCancelledMeteredJob(ctx.usageLogId, ctx.jobId, attachLlmSpend(new JobCancelledError(ctx.jobId), billing.spend))
    expect(handled).toBe(true)
    const spend = h.settle.mock.calls[0]![3] as unknown as { billedAnything: boolean; costUsd: number }
    expect(spend.billedAnything).toBe(true)
    expect(spend.costUsd).toBeCloseTo(0.02, 10)
    expect(h.row.status).toBe("cancelled")
  })

  it("a failure after the cancel (markJobFailed's CAS would lose): the billed actual is charged", async () => {
    const billing = await workerLlmBilling(ctx, job)
    await billing.callStarting()
    billing.recorder.add(MODEL, request, { response: answer(0.03) })
    h.row.status = "cancelled"
    expect(await settleCancelledMeteredJob(ctx.usageLogId, ctx.jobId, attachLlmSpend(new Error("parse failed"), billing.spend))).toBe(true)
    expect((h.settle.mock.calls[0]![3] as unknown as { costUsd: number }).costUsd).toBeCloseTo(0.03, 10)
  })

  it("a row that is NOT cancelled is left to the ordinary failure path (false, nothing settled)", async () => {
    const billing = await workerLlmBilling(ctx, job)
    billing.recorder.add(MODEL, request, { response: answer(0.03) })
    expect(await settleCancelledMeteredJob(ctx.usageLogId, ctx.jobId, attachLlmSpend(new Error("boom"), billing.spend))).toBe(false)
    expect(h.settle).not.toHaveBeenCalled()
  })

  it("a tier job's error (rollback) is never considered: false, and not a single read", async () => {
    h.action = "generate-script:economy"
    const billing = await workerLlmBilling(ctx, job)
    h.row.status = "cancelled"
    h.jobsQueries = []
    expect(await settleCancelledMeteredJob(ctx.usageLogId, ctx.jobId, attachLlmSpend(new JobCancelledError(ctx.jobId), billing.spend))).toBe(false)
    expect(h.jobsQueries).toEqual([])
    expect(h.settle).not.toHaveBeenCalled()
  })

  it("an error with no spend at all is never considered", async () => {
    h.row.status = "cancelled"
    expect(await settleCancelledMeteredJob(ctx.usageLogId, ctx.jobId, new JobCancelledError(ctx.jobId))).toBe(false)
    expect(h.jobsQueries).toEqual([])
  })
})

describe("R45: a call in flight at the cancel — the worker's own settle charges the ACTUAL (the cancel committed nothing)", () => {
  it("a lottie repair: the first answer was noted, the repair was in flight at the cancel — both calls charged at their actual, nothing more", async () => {
    h.action = "motion-graphics-lottie:claude-sonnet-5.5"
    const billing = await workerLlmBilling(ctx, job)
    await billing.callStarting()
    billing.recorder.add(MODEL, request, { response: answer(0.002) })
    await billing.noteSpend()
    h.row.status = "cancelled" // the cancel keeps the hold: the repair is in flight
    billing.recorder.add(MODEL, request, { response: answer(0.008) })
    // authorAndFinish's cancelled branch settles before it returns.
    const settled = await billing.settle()
    expect(settled).toMatchObject({ metered: true, outcome: "charged" })
    const spend = h.settle.mock.calls[0]![3] as unknown as { attempts: unknown[]; costUsd: number }
    expect(spend.attempts).toHaveLength(2)
    expect(spend.costUsd).toBeCloseTo(0.01, 10)
    expect(h.row.status).toBe("cancelled")
  })

  it("a scene3d revision: every planner call noted (afterCall), the failure after the cancel carries all of them", async () => {
    h.action = "3d-scene:claude-sonnet-5.5"
    const billing = await workerLlmBilling(ctx, job)
    await billing.callStarting()
    for (const usd of [0.01, 0.02, 0.005]) {
      billing.recorder.add(MODEL, request, { response: answer(usd) })
      await billing.noteSpend()
    }
    h.row.status = "cancelled"
    expect(await settleCancelledMeteredJob(ctx.usageLogId, ctx.jobId, attachLlmSpend(new Error("revision rejected"), billing.spend))).toBe(true)
    const spend = h.settle.mock.calls[0]![3] as unknown as { attempts: unknown[]; costUsd: number }
    expect(spend.attempts).toHaveLength(3)
    expect(spend.costUsd).toBeCloseTo(0.035, 10)
  })
})

describe("m1: a reservation that could not be read (possibly metered)", () => {
  it("its callStarting refuses a row already cancelled (no call sent)", async () => {
    h.logReadFails = true
    const billing = await workerLlmBilling(ctx, job)
    expect(billing.metered).toBe(false)
    h.row.status = "cancelled"
    await expect(billing.callStarting()).rejects.toBeInstanceOf(JobCancelledError)
  })

  it("its noteSpend raises the row's cumulative provider_cost (monotone) so a cancel sees it billed", async () => {
    h.logReadFails = true
    const billing = await workerLlmBilling(ctx, job)
    billing.recorder.add(MODEL, request, { response: answer(0.02) })
    await billing.noteSpend()
    expect(h.row.provider_cost).toBeCloseTo(0.02, 10)
    h.row.provider_cost = 0.5 // a higher figure already on the row is never lowered
    await billing.noteSpend()
    expect(h.row.provider_cost).toBe(0.5)
    expect(h.row.llm_billing).toBeNull() // never the ledger (no charge id)
  })

  it("a live row: callStarting lets the call go", async () => {
    h.logReadFails = true
    const billing = await workerLlmBilling(ctx, job)
    await expect(billing.callStarting()).resolves.toBeUndefined()
  })
})

describe("m3: the cancelled run's own report", () => {
  it("an unconfirmed settle of a cancelled run files a cancel-specific WARNING (the sweep settles it), never the failure net's error", async () => {
    const billing = await workerLlmBilling(ctx, job)
    await billing.callStarting()
    billing.recorder.add(MODEL, request, { response: answer(0.02) })
    h.row.status = "cancelled"
    h.settle.mockResolvedValueOnce({ outcome: "unsettled" } as never)
    expect(await settleCancelledMeteredJob(ctx.usageLogId, ctx.jobId, attachLlmSpend(new JobCancelledError(ctx.jobId), billing.spend))).toBe(true)
    expect(h.reports).toHaveBeenCalledTimes(1)
    expect(h.reports.mock.calls[0]![0]).toMatchObject({ kind: "metered-hold-unsettled-on-cancelled-run", severity: "warning" })
    expect((h.reports.mock.calls[0]![0] as { title: string }).title).not.toMatch(/failed/)
  })
})

describe("m5: a cancelled job discarded at pickup (a retry in backoff, a drain hand-back) settles its hold there", () => {
  const ledger = (usd: number) => ({
    costUsd: usd, source: "kie-stated", calls: 1, lanes: ["kie"], chargeId: "generate-script:claude-sonnet-5.5",
    attempts: [{ lane: "kie", modelId: MODEL, requestChars: 1200, inputTokens: 900, outputTokens: 700, creditsUsd: usd }],
  })
  /** The row's last stamp, past the cancelled-hold grace (pre-task: 30 min + the 90-min per-node ceiling). */
  const pastGrace = () => new Date(Date.now() - 3 * 60 * 60_000).toISOString()

  it("N2: within the grace (a stalled-but-alive processor may still be mid-call) nothing is settled or refunded — left to the sweep", async () => {
    h.row.status = "cancelled"
    h.row.provider_call_started_at = new Date(Date.now() - 6 * 60_000).toISOString()
    await settleDiscardedCancelledMeteredHold(ctx.usageLogId, ctx.jobId)
    h.row.llm_billing = ledger(0.02)
    h.row.provider_cost = 0.02
    await settleDiscardedCancelledMeteredHold(ctx.usageLogId, ctx.jobId)
    expect(h.settle).not.toHaveBeenCalled()
  })

  it("an earlier attempt billed, past the grace: charged at its actual from the row, the row stays cancelled", async () => {
    h.row.status = "cancelled"
    h.row.provider_call_started_at = pastGrace()
    h.row.llm_billing = ledger(0.02)
    h.row.provider_cost = 0.02
    await settleDiscardedCancelledMeteredHold(ctx.usageLogId, ctx.jobId)
    expect(h.settle).toHaveBeenCalledTimes(1)
    const spend = h.settle.mock.calls[0]![3] as unknown as { billedAnything: boolean; costUsd: number }
    expect(spend.billedAnything).toBe(true)
    expect(spend.costUsd).toBeCloseTo(0.02, 10)
    expect(h.row.status).toBe("cancelled")
  })
  it("nothing billed, past the grace: the same settle refunds it", async () => {
    h.row.status = "cancelled"
    h.row.provider_call_started_at = pastGrace()
    await settleDiscardedCancelledMeteredHold(ctx.usageLogId, ctx.jobId)
    expect((h.settle.mock.calls[0]![3] as unknown as { billedAnything: boolean }).billedAnything).toBe(false)
  })
  it("a row that is not cancelled (completed / failed elsewhere), a hold no longer reserved, or a tier hold: untouched", async () => {
    h.row.provider_call_started_at = pastGrace()
    h.row.status = "completed"
    await settleDiscardedCancelledMeteredHold(ctx.usageLogId, ctx.jobId)
    h.row.status = "cancelled"
    h.logStatus = "refunded"
    await settleDiscardedCancelledMeteredHold(ctx.usageLogId, ctx.jobId)
    h.logStatus = "reserved"
    h.action = "generate-script:economy"
    await settleDiscardedCancelledMeteredHold(ctx.usageLogId, ctx.jobId)
    expect(h.settle).not.toHaveBeenCalled()
  })
  it("R15: under the ROLLBACK a metered hold reserved before the flip still settles at pickup — keyed off the reservation", async () => {
    h.meteredPricing = false
    h.row.status = "cancelled"
    h.row.provider_call_started_at = pastGrace()
    h.row.llm_billing = ledger(0.02)
    h.row.provider_cost = 0.02
    await settleDiscardedCancelledMeteredHold(ctx.usageLogId, ctx.jobId)
    expect(h.settle).toHaveBeenCalledTimes(1)
    expect((h.settle.mock.calls[0]![3] as unknown as { billedAnything: boolean }).billedAnything).toBe(true)
  })
  it("under the rollback a TIER hold: no jobs read, nothing settled", async () => {
    h.meteredPricing = false
    h.action = "generate-script:economy"
    h.row.status = "cancelled"
    h.row.provider_call_started_at = pastGrace()
    h.jobsQueries = []
    await settleDiscardedCancelledMeteredHold(ctx.usageLogId, ctx.jobId)
    expect(h.jobsQueries).toEqual([])
    expect(h.settle).not.toHaveBeenCalled()
  })
  it("R33: before this process confirmed the metered schema: not a single read (the cancelled-hold sweep settles it later, never a refund here)", async () => {
    setLlmMeteredSchemaReadyForTesting(false)
    h.row.status = "cancelled"
    h.row.provider_call_started_at = pastGrace()
    h.jobsQueries = []
    await settleDiscardedCancelledMeteredHold(ctx.usageLogId, ctx.jobId)
    expect(h.jobsQueries).toEqual([])
    expect(h.settle).not.toHaveBeenCalled()
  })
})
