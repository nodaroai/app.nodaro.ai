// @test-watches backend/src/lib/queue.ts
/**
 * R38: the reconcile sweep settles a CANCELLED job's reserved metered LLM hold
 * — the one a cancel kept because the job's call had started (R36) and whose
 * worker or route never came back to settle it. After the same grace the live
 * sweep gives the row's kind: settled from the job's ledger (billed actual
 * charged, nothing billed refunded), the row never flipped; an unconfirmed
 * settle retries with the attempts counter advancing ON the cancelled row; at
 * the D10 cap the live sweep's cap rule charges a billed hold whole. A tier
 * hold never reaches it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const MIN = 60_000

const h = vi.hoisted(() => ({
  credits: true,
  metered: true,
  rows: [] as Array<Record<string, unknown>>,
  queryError: null as { message: string } | null,
  /** The chain the sweep built: [method, ...args] per call. */
  chain: [] as unknown[][],
  fromRow: vi.fn(async (_job: string, _charge: string) => ({ spend: { billedAnything: true }, modelId: "m", fromRow: true, readFailed: false }) as unknown),
  settle: vi.fn(async (..._a: unknown[]) => ({ outcome: "charged", charged: 9, shortfall: 0 }) as { outcome: string; charged?: number; shortfall?: number }),
  sweptRule: vi.fn(async (..._a: unknown[]) => "settled" as "settled" | "not-metered" | "retry"),
  bump: vi.fn(async (..._a: unknown[]) => {}),
  refund: vi.fn(async (_id: string) => {}),
  /** R62: whether the job's call started (stamped, no pre-call marker). */
  callStart: vi.fn(async (_job: string) => "not-started" as "started" | "not-started" | "unknown"),
}))

vi.mock("../../config.js", () => ({ hasCredits: () => h.credits, llmMeteredPricing: () => h.metered }))
vi.mock("../../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "usage_logs") throw new Error(`unexpected table ${table}`)
      const b: Record<string, unknown> = {}
      for (const m of ["select", "eq", "lt", "gte", "or", "order", "not"]) {
        b[m] = (...args: unknown[]) => { h.chain.push([m, ...args]); return b }
      }
      b.limit = async (...args: unknown[]) => {
        h.chain.push(["limit", ...args])
        return { data: h.queryError ? null : h.rows, error: h.queryError }
      }
      return b
    },
  },
}))
vi.mock("../../llm-row-spend.js", () => ({ meteredSpendFromRow: h.fromRow }))
vi.mock("../../llm-billing-ledger.js", () => ({ readLlmCallStart: h.callStart }))
vi.mock("../../llm-billing.js", () => ({ settleLlmUsageLog: h.settle, settleSweptMeteredLlmJob: h.sweptRule }))
vi.mock("../metered-sweep-attempts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../metered-sweep-attempts.js")>()),
  bumpMeteredSweepAttempts: h.bump,
}))
vi.mock("../../../ee/billing/credits.js", () => ({ CreditsService: { refundCredits: h.refund } }))
// The scrapes' fixed + calls hold (its own pass): the cancel's ledger rule, the refund, the report.
const ledgerHold = vi.hoisted(() => ({
  settle: vi.fn(async (_job: string, _opts?: unknown) => "settled" as "settled" | "not-metered" | "retry"),
  refundJob: vi.fn(async (_job: string) => 1),
  report: vi.fn(async (_r: unknown) => true),
}))
vi.mock("../../../ee/billing/llm-cancel-settle.js", () => ({ settleBilledLedgerBeforeCancelImpl: ledgerHold.settle }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: ledgerHold.refundJob }))
vi.mock("../../app-reports.js", () => ({ insertAppReport: ledgerHold.report }))

import {
  sweepCancelledMeteredHolds,
  cancelledHoldPastGrace,
  CANCELLED_HOLD_HORIZON_MS,
  CANCELLED_HOLD_WINDOW_MS,
  RECONCILE_TICK_MS,
  VIDEO_QUEUE_ATTEMPTS,
} from "../cancelled-metered-holds.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { STALE_THRESHOLD_MS } from "../types.js"
import { NODE_TIMEOUT_MS } from "../../../services/workflow-engine/types.js"
import { METERED_SWEEP_MAX_ATTEMPTS } from "../metered-sweep-attempts.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../llm-metered-schema-gate.js"

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const METERED = "generate-script:claude-sonnet-5.5"
function log(over: { id?: string; job_id?: string; action?: string; job?: Record<string, unknown> } = {}) {
  return {
    id: over.id ?? "log-1",
    job_id: over.job_id ?? "job-1",
    action: over.action ?? METERED,
    jobs: {
      status: "cancelled",
      provider_kind: "pre-task",
      provider_call_started_at: ago(31 * MIN + NODE_TIMEOUT_MS),
      created_at: ago(40 * MIN + NODE_TIMEOUT_MS),
      reconcile_attempts: 0,
      reconcile_last_error: null,
      ...over.job,
    },
  }
}
const result = () => ({ scanned: 0, swept: 0, notStale: 0, errors: 0 })

beforeEach(() => {
  vi.clearAllMocks()
  h.credits = true
  h.metered = true
  setLlmMeteredSchemaReadyForTesting(true)
  h.rows = []
  h.queryError = null
  h.chain = []
  h.fromRow.mockResolvedValue({ spend: { billedAnything: true }, modelId: "m", fromRow: true, readFailed: false })
  h.settle.mockResolvedValue({ outcome: "charged", charged: 9, shortfall: 0 })
  h.sweptRule.mockResolvedValue("settled")
  h.callStart.mockResolvedValue("not-started")
})

describe("N1 for the scrapes: a fixed + calls hold left on a cancelled row", () => {
  const SCRAPE = { id: "scrape-log", job_id: "scrape-job", action: "meta-ads-scrape:100" }

  it("reads holds on cancelled rows that carry a ledger, and past the grace settles them from it — a call still marked in flight counted dead", async () => {
    ledgerHold.settle.mockResolvedValue("settled")
    h.rows = [log(SCRAPE)]
    const r = result()
    await sweepCancelledMeteredHolds(r)
    expect(h.chain).toContainEqual(["not", "jobs.llm_billing", "is", null])
    expect(ledgerHold.settle).toHaveBeenCalledWith("scrape-job", { ignoreInFlight: true })
    // What is still reserved after the ledger's commit (a second log) is refunded.
    expect(ledgerHold.refundJob).toHaveBeenCalledWith("scrape-job")
    expect(r.swept).toBe(1)
    // The metered pass never touched it.
    expect(h.settle).not.toHaveBeenCalled()
  })

  it("within the grace it is left (the scrape may still settle it itself)", async () => {
    h.rows = [log({ ...SCRAPE, job: { created_at: ago(5 * MIN), provider_call_started_at: null } })]
    await sweepCancelledMeteredHolds(result())
    expect(ledgerHold.settle).not.toHaveBeenCalled()
  })

  it("nothing billed → refunded; not confirmed → the row's attempts advance (never refunded), reported at the D10 cap", async () => {
    ledgerHold.settle.mockResolvedValue("not-metered")
    h.rows = [log(SCRAPE)]
    await sweepCancelledMeteredHolds(result())
    expect(ledgerHold.refundJob).toHaveBeenCalledWith("scrape-job")

    vi.clearAllMocks()
    ledgerHold.settle.mockResolvedValue("retry")
    h.rows = [log({ ...SCRAPE, job: { reconcile_attempts: METERED_SWEEP_MAX_ATTEMPTS - 1 } })]
    await sweepCancelledMeteredHolds(result())
    expect(ledgerHold.refundJob).not.toHaveBeenCalled()
    expect(h.bump).toHaveBeenCalledWith("scrape-job", METERED_SWEEP_MAX_ATTEMPTS, expect.any(String), false, ["cancelled"])
    expect(ledgerHold.report).toHaveBeenCalledWith(expect.objectContaining({ kind: "metered-ledger-hold-unsettled-at-cap", severity: "error" }))
  })
})

describe("R38: the cancelled-hold sweep", () => {
  it("reads reserved logs on CANCELLED jobs (driven from the holds, oldest first, bounded)", async () => {
    await sweepCancelledMeteredHolds(result())
    expect(h.chain).toContainEqual(["eq", "status", "reserved"])
    expect(h.chain).toContainEqual(["eq", "jobs.status", "cancelled"])
    expect(h.chain).toContainEqual(["order", "created_at", { ascending: true }])
    expect(h.chain.find((c) => c[0] === "limit")).toBeDefined()
  })

  it("R46: never a scan of usage_logs — a created_at window (lower AND upper bound) and the metered-id prefixes in SQL", async () => {
    const before = Date.now()
    await sweepCancelledMeteredHolds(result())
    const gte = h.chain.find((c) => c[0] === "gte" && c[1] === "created_at")
    expect(gte).toBeDefined()
    const from = Date.parse(gte![2] as string)
    expect(before - from).toBeGreaterThanOrEqual(CANCELLED_HOLD_WINDOW_MS - 1000)
    expect(before - from).toBeLessThanOrEqual(CANCELLED_HOLD_WINDOW_MS + 5000)
    expect(h.chain.find((c) => c[0] === "lt" && c[1] === "created_at")).toBeDefined()
    const or = h.chain.find((c) => c[0] === "or")
    expect(or?.[1]).toContain("action.like.generate-script:*")
    expect(or?.[1]).toContain("action.like.llm-chat:*")
    expect(or?.[1]).toContain("action.like.reduce:pick-best-llm:*")
  })

  it("R46: the window covers the D10 cap horizon (with margin) — every BullMQ attempt, the grace, the cap's ticks", () => {
    expect(CANCELLED_HOLD_HORIZON_MS).toBeGreaterThanOrEqual(
      30 * MIN + VIDEO_QUEUE_ATTEMPTS * NODE_TIMEOUT_MS + STALE_THRESHOLD_MS["pre-task"] + NODE_TIMEOUT_MS + 6 * RECONCILE_TICK_MS,
    )
    expect(CANCELLED_HOLD_HORIZON_MS).toBe(450 * MIN) // 7.5 hours
    expect(CANCELLED_HOLD_WINDOW_MS).toBe(24 * 60 * MIN)
    expect(CANCELLED_HOLD_WINDOW_MS).toBeGreaterThanOrEqual(3 * CANCELLED_HOLD_HORIZON_MS)
  })

  it("VIDEO_QUEUE_ATTEMPTS is the video queue's own attempts", () => {
    const queue = readFileSync(join(__dirname, "..", "..", "queue.ts"), "utf8")
    const videoQueue = queue.slice(queue.indexOf("export const videoQueue"))
    expect(/attempts:\s*(\d+)/.exec(videoQueue)?.[1]).toBe(String(VIDEO_QUEUE_ATTEMPTS))
  })

  it("R15: under the ROLLBACK a metered hold kept before the flip is still settled — keyed off the reservation, never the switch", async () => {
    h.metered = false // LLM_TIER_PRICING_ROLLBACK on
    h.rows = [log()]
    await sweepCancelledMeteredHolds(result())
    expect(h.settle).toHaveBeenCalledWith("log-1", "job-1", METERED, expect.objectContaining({ billedAnything: true }))
  })

  it("R15: under the rollback a tier hold on a cancelled row is still never touched", async () => {
    h.metered = false
    h.rows = [log({ action: "generate-script:economy" })]
    await sweepCancelledMeteredHolds(result())
    expect(h.fromRow).not.toHaveBeenCalled()
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("R33: before the metered schema is confirmed the query is not run (no tick refunds; a later tick settles)", async () => {
    setLlmMeteredSchemaReadyForTesting(false)
    h.rows = [log()]
    await sweepCancelledMeteredHolds(result())
    expect(h.chain).toEqual([])
    expect(h.refund).not.toHaveBeenCalled()
    setLlmMeteredSchemaReadyForTesting(true)
    await sweepCancelledMeteredHolds(result())
    expect(h.settle).toHaveBeenCalledTimes(1)
  })

  it("a billed stranded hold past the grace is settled from the job's ledger at its actual — the row is never flipped", async () => {
    h.rows = [log()]
    const r = result()
    await sweepCancelledMeteredHolds(r)
    expect(h.fromRow).toHaveBeenCalledWith("job-1", METERED)
    expect(h.settle).toHaveBeenCalledWith("log-1", "job-1", METERED, expect.objectContaining({ billedAnything: true }))
    expect(h.bump).not.toHaveBeenCalled()
    expect(r).toMatchObject({ scanned: 1, swept: 1, errors: 0 })
  })

  it("an unbilled stranded hold past the grace goes through the same settle, which refunds it", async () => {
    h.rows = [log()]
    h.fromRow.mockResolvedValue({ spend: { billedAnything: false }, modelId: "m", fromRow: false, readFailed: false })
    h.settle.mockResolvedValue({ outcome: "refunded" })
    await sweepCancelledMeteredHolds(result())
    expect(h.settle).toHaveBeenCalledWith("log-1", "job-1", METERED, expect.objectContaining({ billedAnything: false }))
  })

  it("R62: a call that STARTED with nothing billed recorded is billed-unknown — kept (billed marker, attempts advance), never refunded", async () => {
    h.rows = [log({ job: { reconcile_attempts: 1 } })]
    h.fromRow.mockResolvedValue({ spend: { billedAnything: false }, modelId: "m", fromRow: false, readFailed: false })
    h.callStart.mockResolvedValue("started")
    await sweepCancelledMeteredHolds(result())
    expect(h.callStart).toHaveBeenCalledWith("job-1")
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.refund).not.toHaveBeenCalled()
    expect(h.bump).toHaveBeenCalledWith("job-1", 2, expect.stringContaining("call started"), true, ["cancelled"])
  })

  it("R62: an unreadable call start is retried unconfirmed, never refunded", async () => {
    h.rows = [log()]
    h.fromRow.mockResolvedValue({ spend: { billedAnything: false }, modelId: "m", fromRow: false, readFailed: false })
    h.callStart.mockResolvedValue("unknown")
    await sweepCancelledMeteredHolds(result())
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.bump).toHaveBeenCalledWith("job-1", 1, expect.any(String), false, ["cancelled"])
  })

  it("R62: an earlier tick's billed confirmation keeps an unbilled-reading hold too (no call-start read needed)", async () => {
    h.rows = [log({ job: { reconcile_last_error: "metered_settle_retry:billed: confirmed metered + billed" } })]
    h.fromRow.mockResolvedValue({ spend: { billedAnything: false }, modelId: "m", fromRow: false, readFailed: false })
    await sweepCancelledMeteredHolds(result())
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.bump).toHaveBeenCalledWith("job-1", 1, expect.any(String), true, ["cancelled"])
  })

  it("R62: at the D10 cap the live sweep's cap rule runs (which charges a started call's hold whole)", async () => {
    h.rows = [log({ job: { reconcile_attempts: METERED_SWEEP_MAX_ATTEMPTS - 1 } })]
    h.fromRow.mockResolvedValue({ spend: { billedAnything: false }, modelId: "m", fromRow: false, readFailed: false })
    h.callStart.mockResolvedValue("started")
    await sweepCancelledMeteredHolds(result())
    expect(h.sweptRule).toHaveBeenCalledWith(expect.objectContaining({ id: "job-1" }), { statuses: ["cancelled"] })
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("within the grace (a call that may still be running) nothing is touched", async () => {
    h.rows = [log({ job: { provider_call_started_at: ago(10 * MIN) } })]
    const r = result()
    await sweepCancelledMeteredHolds(r)
    expect(h.fromRow).not.toHaveBeenCalled()
    expect(h.settle).not.toHaveBeenCalled()
    expect(r.notStale).toBe(1)
  })

  it("a tier hold on a cancelled job is never touched (rollback byte-identical)", async () => {
    h.rows = [log({ action: "generate-script:economy" })]
    await sweepCancelledMeteredHolds(result())
    expect(h.fromRow).not.toHaveBeenCalled()
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("an unconfirmed settle is retried: the attempts counter advances ON the cancelled row (else the cap never comes)", async () => {
    h.rows = [log({ job: { reconcile_attempts: 1 } })]
    h.settle.mockResolvedValue({ outcome: "unsettled" })
    await sweepCancelledMeteredHolds(result())
    expect(h.bump).toHaveBeenCalledWith("job-1", 2, expect.any(String), true, ["cancelled"])
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("a ledger that cannot be read is never settled or refunded on a guess: retried", async () => {
    h.rows = [log()]
    h.fromRow.mockResolvedValue({ spend: { billedAnything: false }, modelId: "m", fromRow: false, readFailed: true })
    await sweepCancelledMeteredHolds(result())
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.bump).toHaveBeenCalledWith("job-1", 1, expect.any(String), false, ["cancelled"])
  })

  it("at the D10 cap the live sweep's cap rule runs on the cancelled row (a billed hold charged whole)", async () => {
    h.rows = [log({ job: { reconcile_attempts: METERED_SWEEP_MAX_ATTEMPTS - 1, reconcile_last_error: "metered_settle_retry:billed: x" } })]
    await sweepCancelledMeteredHolds(result())
    expect(h.sweptRule).toHaveBeenCalledWith(
      { id: "job-1", reconcile_attempts: METERED_SWEEP_MAX_ATTEMPTS - 1, reconcile_last_error: "metered_settle_retry:billed: x" },
      { statuses: ["cancelled"] },
    )
    expect(h.settle).not.toHaveBeenCalled()
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("at the cap, a hold never confirmed billed is refunded (never left reserved)", async () => {
    h.rows = [log({ job: { reconcile_attempts: METERED_SWEEP_MAX_ATTEMPTS - 1 } })]
    h.sweptRule.mockResolvedValue("not-metered")
    await sweepCancelledMeteredHolds(result())
    expect(h.refund).toHaveBeenCalledWith("log-1")
  })

  it("no credits (community): no query at all", async () => {
    h.credits = false
    await sweepCancelledMeteredHolds(result())
    expect(h.chain).toEqual([])
  })

  it("a failed query is counted, never thrown", async () => {
    h.queryError = { message: "timeout" }
    const r = result()
    await expect(sweepCancelledMeteredHolds(r)).resolves.toBeUndefined()
    expect(r.errors).toBe(1)
  })
})

describe("cancelledHoldPastGrace — the live sweep's per-kind threshold", () => {
  const now = Date.now()
  it("a sync route's stamp (anthropic-sync) waits its 40 minutes", () => {
    expect(cancelledHoldPastGrace({ provider_kind: "anthropic-sync", provider_call_started_at: ago(35 * MIN) }, now)).toBe(false)
    expect(cancelledHoldPastGrace({ provider_kind: "anthropic-sync", provider_call_started_at: ago(41 * MIN) }, now)).toBe(true)
  })
  it("m2: a worker's pre-task stamp waits its 30 minutes PLUS the longest the worker may still run (its in-flight call is never refunded first)", () => {
    // A lottie / generate-script job cancelled mid-call: the heartbeat stopped beating the cancelled row.
    expect(cancelledHoldPastGrace({ provider_kind: "pre-task", provider_call_started_at: ago(35 * MIN), job_type: "motion-graphics-lottie" }, now)).toBe(false)
    expect(cancelledHoldPastGrace({ provider_kind: "pre-task", provider_call_started_at: ago(30 * MIN + NODE_TIMEOUT_MS - MIN) }, now)).toBe(false)
    expect(cancelledHoldPastGrace({ provider_kind: "pre-task", provider_call_started_at: ago(30 * MIN + NODE_TIMEOUT_MS + MIN) }, now)).toBe(true)
  })
  it("no stamp and no kind: anchored on the row's creation, as a worker row", () => {
    expect(cancelledHoldPastGrace({ provider_kind: null, provider_call_started_at: null, created_at: ago(31 * MIN) }, now)).toBe(false)
    expect(cancelledHoldPastGrace({ provider_kind: null, provider_call_started_at: null, created_at: ago(31 * MIN + NODE_TIMEOUT_MS) }, now)).toBe(true)
  })
})
