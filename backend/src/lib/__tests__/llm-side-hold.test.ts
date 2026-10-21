// @test-reads-none an in-memory database double; reads no repo file
// @test-units-by-name names no node type: CreditsService only doubles the credit RPCs
/**
 * Metered LLM SIDE holds (migration 554): a metered hold for one LLM call a
 * job makes beside its own reservation (a UGC clip's frame check) — reserved,
 * started and settled from a worker, never touching the job's row.
 *
 * The SQL (`reserve_llm_side_hold`, `llm_side_hold_call_starting`) is
 * simulated here over an in-memory database; its own behaviour is proven by
 * `supabase/tests/llm-side-holds.behavior.sql`. The money paths are the real
 * metered settle (`settleLlmUsageLogImpl`) with `CreditsService` doubled.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  metered: true,
  credits: true,
  db: { jobs: [] as Row[], usage_logs: [] as Row[], llm_side_holds: [] as Row[] } as Record<string, Row[]>,
  /** Every write: [table, op, payload]. */
  writes: [] as Array<[string, string, unknown]>,
  rpcError: null as string | null,
  check: { allowed: true } as { allowed: boolean; balance?: number; error?: string; code?: string; subscriptionRequired?: boolean },
  reserveError: null as Error | null,
  commitFails: false,
  reserveCalls: [] as unknown[][],
  commits: [] as Array<[string, number | undefined, unknown]>,
  refunds: [] as string[],
  reports: [] as Row[],
  logSeq: 0,
  orders: [] as string[],
  unpriced: false,
  refundRpc: [] as string[],
  refundAnswer: "refunded" as string,
  /** This process confirmed the metered schema (R33). */
  schemaReady: true,
}))

vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  hasCredits: () => h.credits,
  llmMeteredPricing: () => h.metered && h.credits,
}))
vi.mock("../llm-metered-schema-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm-metered-schema-gate.js")>()),
  llmMeteredSchemaReady: () => h.schemaReady,
}))
vi.mock("../app-reports.js", () => ({ insertAppReport: async (r: Row) => (h.reports.push(r), true) }))
vi.mock("../app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 0, service_margin_percent: {} }) }))
// The settle's arithmetic, made legible: 1 credit per 0.001 USD, rounded up.
vi.mock("../../ee/billing/credit-anomaly.js", () => ({ computeActualCredits: async (usd: number) => Math.ceil(Math.round(usd * 1e6) / 1000) }))
vi.mock("../../ee/billing/llm-billing-impl.js", async (importOriginal) => {
  const { LlmUnpricedModelError } = await import("../../ee/billing/llm-metered.js")
  return {
    ...(await importOriginal<typeof import("../../ee/billing/llm-billing-impl.js")>()),
    llmHoldForCalls: async (feature: string, calls: Array<{ modelId: string }>) => {
      if (h.unpriced) throw new LlmUnpricedModelError(calls[0]!.modelId, "direct")
      return { chargeId: `${feature}:${calls[0]!.modelId}`, holdCredits: 4 }
    },
  }
})

/** `reserve_llm_side_hold` and the metered commit, as the SQL does them. */
vi.mock("../../ee/billing/credits.js", () => {
  class PriceNotConfiguredError extends Error {}
  const CreditsService = {
    checkCredits: vi.fn(async () => h.check),
    reserveCredits: vi.fn(async (userId: string, jobId: string, chargeId: string, _p: number, _d: number, opts: Row) => {
      h.reserveCalls.push([userId, jobId, chargeId, opts])
      if (h.reserveError) throw h.reserveError
      const job = h.db.jobs.find((j) => j.id === jobId)
      if (!job || job.user_id !== userId || !["pending", "processing"].includes(job.status as string)) {
        throw new Error("Credit reservation failed: SIDE_HOLD_INACTIVE: owned active job required")
      }
      const key = (opts.sideHold as { key?: string }).key
      const prior = key ? h.db.llm_side_holds.find((s) => s.job_id === jobId && s.hold_key === key) : undefined
      if (prior) {
        const log = h.db.usage_logs.find((l) => l.id === prior.usage_log_id)!
        if (prior.hold_credits !== opts.creditOverride) throw new Error("Credit reservation failed: SIDE_HOLD_CONFLICT: the key names another hold")
        if (log.status !== "reserved" || prior.closed_at) throw new Error("Credit reservation failed: SIDE_HOLD_KEY_SETTLED: the key names a settled hold (charged)")
        return { usageLogId: prior.usage_log_id, creditsReserved: opts.creditOverride, watermark: false, replayed: true, sideLedger: prior.ledger }
      }
      const id = `00000000-0000-4000-9000-${String(++h.logSeq).padStart(12, "0")}`
      h.db.usage_logs.push({ id, job_id: null, action: chargeId, status: "reserved", credits_used: opts.creditOverride, metadata: { reservation_mode: "side" } })
      h.db.llm_side_holds.push({
        usage_log_id: id, job_id: jobId, user_id: userId, charge_id: chargeId, hold_credits: opts.creditOverride, hold_key: key ?? null, pre_call: true,
        call_started_at: null, closed_at: null, ledger: null, settled_at: null, outcome: null, sweep_attempts: 0, sweep_billed: false,
        created_at: new Date().toISOString(),
      })
      return { usageLogId: id, creditsReserved: opts.creditOverride, watermark: false, replayed: false }
    }),
    commitCredits: vi.fn(async (id: string, actual?: number, opts?: unknown) => {
      h.commits.push([id, actual, opts])
      const log = h.db.usage_logs.find((l) => l.id === id)
      if (h.commitFails || !log || log.status !== "reserved") return undefined
      log.status = "committed"
      log.credits_charged = actual
      return opts ? { charged: actual, collectedOverHold: 0, shortfall: 0, payer: "personal" } : undefined
    }),
    refundCredits: vi.fn(async (id: string) => {
      h.refunds.push(id)
      const log = h.db.usage_logs.find((l) => l.id === id)
      if (log && log.status === "reserved") log.status = "refunded"
    }),
  }
  return { CreditsService, PriceNotConfiguredError }
})

/** A chainable PostgREST double over `h.db`. */
vi.mock("../supabase.js", () => {
  function query(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let op: "select" | "update" | "delete" = "select"
    let patch: Row = {}
    let cols = ""
    let limit: number | undefined
    const rows = () => (h.db[table] ?? []).filter((r) => filters.every((f) => f(r)))
    const embed = (r: Row): Row => {
      if (!cols.includes("usage_logs!inner")) return r
      const log = h.db.usage_logs.find((l) => l.id === r.usage_log_id)
      return { ...r, usage_logs: log ? { status: log.status, credits_used: log.credits_used } : null }
    }
    const run = () => {
      if (op === "update") {
        const hit = rows()
        h.writes.push([table, "update", patch])
        for (const r of hit) Object.assign(r, patch)
        return { data: hit.map((r) => ({ ...r })), error: null }
      }
      if (op === "delete") {
        h.writes.push([table, "delete", null])
        return { data: null, error: null }
      }
      let out = rows().map(embed)
      if (cols.includes("usage_logs!inner")) out = out.filter((r) => r.usage_logs)
      if (limit !== undefined) out = out.slice(0, limit)
      return { data: out, error: null }
    }
    const q: Record<string, unknown> = {
      select: (c?: string) => ((cols = c ?? cols), q),
      update: (p: Row) => ((op = "update"), (patch = p), q),
      delete: () => ((op = "delete"), q),
      eq: (c: string, v: unknown) => (
        filters.push((r) => (c.startsWith("usage_logs.") ? h.db.usage_logs.find((l) => l.id === r.usage_log_id)?.[c.slice(11)] === v : r[c] === v)), q
      ),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
      order: (c: string) => (h.orders.push(`${table}.${c}`), q),
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    return q
  }
  /** `llm_side_hold_call_starting`, as 554 writes it. */
  const rpc = async (fn: string, args: Row) => {
    if (fn === "refund_settled_side_hold") {
      h.refundRpc.push(args.p_usage_log_id as string)
      const log = h.db.usage_logs.find((l) => l.id === args.p_usage_log_id)
      if (h.refundAnswer === "refunded" && log?.status === "committed") log.status = "refunded"
      return { data: h.refundAnswer, error: null }
    }
    if (fn !== "llm_side_hold_call_starting") throw new Error(`unexpected rpc ${fn}`)
    if (h.rpcError) return { data: null, error: { message: h.rpcError } }
    const hold = h.db.llm_side_holds.find((s) => s.usage_log_id === args.p_usage_log_id)
    if (!hold) return { data: "closed", error: null }
    const job = h.db.jobs.find((j) => j.id === hold.job_id)
    if (hold.closed_at || hold.settled_at) return { data: "closed", error: null }
    if (h.db.usage_logs.find((l) => l.id === hold.usage_log_id)?.status !== "reserved") return { data: "closed", error: null }
    if (!job || !["pending", "processing"].includes(job.status as string)) return { data: "not-live", error: null }
    hold.pre_call = false
    hold.call_started_at = new Date().toISOString()
    return { data: "started", error: null }
  }
  return { supabase: { from: query, rpc } }
})

const { reserveLlmSideHold, settleSideHoldsAfterFlip, sideHoldsAvailable } = await import("../llm-side-hold.js")
const { LlmSpend } = await import("../llm-billing.js")
const { JobCancelledError } = await import("../job-cancellation.js")
const { sweepSideHoldsImpl, sideHoldPastGrace, SIDE_HOLD_CLOSED_GRACE_MS } = await import("../../ee/billing/llm-side-hold-impl.js")
const { METERED_SWEEP_MAX_ATTEMPTS } = await import("../reconcile/metered-sweep-attempts.js")

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const JOB = "00000000-0000-4000-8000-0000000000a1"
const MODEL = "claude-sonnet-5.5"
const CALL = { modelId: MODEL, request: { modelId: MODEL, system: "", messages: [] } }
const GRACE = 120 * 60_000

function billed(costUsd: number) {
  const spend = new LlmSpend()
  spend.add(MODEL, CALL.request, {
    output: { attempts: [{ lane: "direct-anthropic", modelId: MODEL, requestChars: 100, inputTokens: 1000, outputTokens: 100, providerCost: costUsd }] } as never,
  })
  return spend
}

const clipRow = () => ({ id: JOB, user_id: USER, status: "processing", usage_log_id: "managed-log", credits: 300, credits_actual: null, provider_cost: null, llm_billing: null })

let keySeq = 0
async function reserve(over: Partial<Parameters<typeof reserveLlmSideHold>[0]> = {}) {
  const r = await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: `take:${++keySeq}`, ...over })
  if (!r.ok) throw new Error(`refused: ${r.code}`)
  return r.hold
}
const hold = () => h.db.llm_side_holds[0]!
const log = () => h.db.usage_logs[0]!

beforeEach(() => {
  h.metered = true
  h.schemaReady = true
  h.credits = true
  h.db.jobs = [clipRow()]
  h.db.usage_logs = []
  h.db.llm_side_holds = []
  h.writes = []
  h.rpcError = null
  h.check = { allowed: true }
  h.reserveError = null
  h.commitFails = false
  h.reserveCalls = []
  h.commits = []
  h.refunds = []
  h.reports = []
  h.orders = []
  h.unpriced = false
  h.refundRpc = []
  h.refundAnswer = "refunded"
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("reserve", () => {
  it("reserves the 1-attempt hold under <feature>:<model> on the side-hold lane, paid by the job's payer, and never writes the job", async () => {
    const payer = { billingContext: { payer: "user" as const, userId: USER }, isAppRun: true, webFreeMode: true, skipAutoRecharge: true }
    const sideHold = await reserve({ payer, key: "take:1" })
    expect(sideHold).toMatchObject({ jobId: JOB, chargeId: `image-to-text:${MODEL}`, holdCredits: 4, replayed: false })
    const [userId, jobId, chargeId, opts] = h.reserveCalls[0]!
    expect([userId, jobId, chargeId]).toEqual([USER, JOB, `image-to-text:${MODEL}`])
    expect(opts).toMatchObject({ creditOverride: 4, isAppRun: true, webFreeMode: true, skipAutoRecharge: true, sideHold: { key: "take:1" }, billingContext: payer.billingContext })
    expect(log()).toMatchObject({ job_id: null, status: "reserved" })
    expect(h.writes.filter(([t]) => t === "jobs")).toEqual([])
    expect(h.db.jobs[0]).toEqual(clipRow())
  })

  it("under the rollback (or without credits) it is unavailable and reserves nothing", async () => {
    h.metered = false
    expect(sideHoldsAvailable()).toBe(false)
    expect(await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:x" })).toMatchObject({ ok: false, code: "unavailable" })
    expect(h.reserveCalls).toEqual([])
  })

  it("a short balance is refused with the hold named — before any reservation, the job untouched", async () => {
    h.check = { allowed: false, balance: 2 }
    expect(await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:x" })).toEqual({
      ok: false, code: "insufficient_credits", message: "Needs up to 4 credits", required: 4, balance: 2,
    })
    expect(h.reserveCalls).toEqual([])
    expect(h.writes).toEqual([])
  })

  it("a payer context of another user is refused (never someone else's pocket)", async () => {
    const r = await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:x", payer: { billingContext: { payer: "user", userId: OTHER } } })
    expect(r).toMatchObject({ ok: false, code: "conflict" })
    expect(h.reserveCalls).toEqual([])
  })

  it("a job no longer live is refused as job_not_live — and the job row is never deleted", async () => {
    h.db.jobs[0]!.status = "cancelled"
    expect(await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:x" })).toMatchObject({ ok: false, code: "job_not_live" })
    expect(h.writes.filter(([t, op]) => t === "jobs" && op === "delete")).toEqual([])
    expect(h.db.jobs).toHaveLength(1)
  })

  it("a reserve RPC refusal keeps its stable code (a workspace budget)", async () => {
    const { ReserveRpcError } = await import("../reserve-errors.js")
    h.reserveError = new ReserveRpcError("BUDGET_EXCEEDED", "BUDGET_EXCEEDED: …")
    expect(await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:x" })).toMatchObject({ ok: false, code: "budget_exceeded" })
  })

  it("a key whose hold is already settled answers key_settled (a retried attempt reserves under a new key) — never conflict", async () => {
    const first = await reserve({ key: "take:3" })
    await first.callStarting()
    await first.settle(billed(0.004))
    expect(await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:3" })).toMatchObject({ ok: false, code: "key_settled" })
    const fresh = await reserve({ key: "take:3:r2" })
    expect(fresh.usageLogId).not.toBe(first.usageLogId)
  })

  it("a replay with the same key returns the same open hold, and its recorded spend is carried into the settle", async () => {
    const first = await reserve({ key: "take:1" })
    await first.callStarting()
    await first.noteSpend(billed(0.004))
    // The process dies; the job's retried attempt reserves with the same key.
    const again = await reserve({ key: "take:1" })
    expect(again.usageLogId).toBe(first.usageLogId)
    expect(again.replayed).toBe(true)
    expect(h.db.usage_logs).toHaveLength(1)
    await again.callStarting()
    expect(await again.settle(billed(0.003))).toMatchObject({ outcome: "charged", charged: 7 })
  })
})

describe("round 3 — the reserve's replay, its key, a concurrent same-key reserve", () => {
  it("a key replay is answered BEFORE the credit check: replaying an open hold is never refused insufficient_credits", async () => {
    const first = await reserve({ key: "take:9" })
    h.check = { allowed: false, balance: 0 }
    const again = await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:9" })
    expect(again).toMatchObject({ ok: true, hold: { usageLogId: first.usageLogId, replayed: true } })
    expect(h.reserveCalls).toHaveLength(1)
  })

  it("a model that lost its price since still replays its open hold (the replay is read before any pricing)", async () => {
    const first = await reserve({ key: "take:30" })
    h.unpriced = true
    expect(await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:30" }))
      .toMatchObject({ ok: true, hold: { usageLogId: first.usageLogId, replayed: true } })
    // A NEW reading on that model is refused, as before.
    expect(await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:31" })).toMatchObject({ ok: false, code: "llm_model_unpriced" })
  })

  it("only the job owner's own hold is replayed: another user naming the same job and key gets none", async () => {
    await reserve({ key: "take:32" })
    const r = await reserveLlmSideHold({ jobId: JOB, userId: OTHER, feature: "image-to-text", calls: [CALL], key: "take:32" })
    expect(r.ok).toBe(false)
    expect(r).not.toMatchObject({ hold: expect.anything() })
  })

  it("a reprice between the attempts replays the hold already reserved (its own amount), never a conflict", async () => {
    const first = await reserve({ key: "take:10" })
    h.db.llm_side_holds[0]!.hold_credits = 3 // reserved at another price
    const again = await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:10" })
    expect(again).toMatchObject({ ok: true, hold: { usageLogId: first.usageLogId, holdCredits: 3, replayed: true } })
  })

  it("the same key under another charge id is a conflict", async () => {
    await reserve({ key: "take:11" })
    h.db.llm_side_holds[0]!.charge_id = "image-to-text:gpt-6"
    expect(await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:11" })).toMatchObject({ ok: false, code: "conflict" })
  })

  it.each([
    ["no calls", undefined],
    ["not a list", "claude-sonnet-5.5"],
    ["an empty list", []],
    ["a call without a model", [{ request: {} }]],
    ["a call whose model is not a string", [{ modelId: 5, request: {} }]],
  ])("malformed planned calls (%s) are refused invalid_request — never a throw, nothing reserved", async (_what, calls) => {
    const r = await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls, key: "take:40" } as never)
    expect(r).toMatchObject({ ok: false, code: "invalid_request" })
    expect(h.reserveCalls).toEqual([])
  })

  it("a reserve without a key is refused (invalid_request), nothing reserved", async () => {
    expect(await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL] } as never)).toMatchObject({ ok: false, code: "invalid_request" })
    expect(h.reserveCalls).toEqual([])
  })

  it("a concurrent same-key reserve losing the unique index (23505) replays the winner's hold", async () => {
    const svc = (await import("../../ee/billing/credits.js")).CreditsService
    vi.mocked(svc.reserveCredits).mockImplementationOnce(async (_u, jobId, chargeId, _p, _d, opts) => {
      // The other attempt committed its hold first.
      const id = "00000000-0000-4000-9000-0000000000ff"
      h.db.usage_logs.push({ id, job_id: null, action: chargeId, status: "reserved", credits_used: 4, metadata: { reservation_mode: "side" } })
      h.db.llm_side_holds.push({ usage_log_id: id, job_id: jobId, user_id: USER, charge_id: chargeId, hold_credits: 4, hold_key: (opts as Row & { sideHold: { key: string } }).sideHold.key, pre_call: true, call_started_at: null, closed_at: null, ledger: null, settled_at: null, outcome: null, sweep_attempts: 0, sweep_billed: false, created_at: new Date().toISOString() })
      throw new Error('Credit reservation failed: duplicate key value violates unique constraint "llm_side_holds_job_key"')
    })
    const r = await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:12" })
    expect(r).toMatchObject({ ok: true, hold: { usageLogId: "00000000-0000-4000-9000-0000000000ff", replayed: true } })
  })

  it("a 23505 whose winner is not visible yet answers the retryable key_in_use", async () => {
    const svc = (await import("../../ee/billing/credits.js")).CreditsService
    vi.mocked(svc.reserveCredits).mockImplementationOnce(async () => {
      throw new Error('Credit reservation failed: duplicate key value violates unique constraint "llm_side_holds_job_key"')
    })
    expect(await reserveLlmSideHold({ jobId: JOB, userId: USER, feature: "image-to-text", calls: [CALL], key: "take:13" })).toMatchObject({ ok: false, code: "key_in_use" })
  })
})

describe("round 3 — a refund is settled only once the log moved", () => {
  it("a refund that did nothing leaves the hold OPEN; the next sweep tick settles it", async () => {
    const sideHold = await reserve()
    const svc = (await import("../../ee/billing/credits.js")).CreditsService
    vi.mocked(svc.refundCredits).mockImplementationOnce(async () => {}) // a no-op refund
    expect(await sideHold.settle(new LlmSpend())).toEqual({ outcome: "refunded" })
    expect(log().status).toBe("reserved")
    expect(hold().settled_at).toBeNull()
    // The sweep (past the closed grace) refunds it for real and records it settled.
    hold().closed_at = new Date(Date.now() - SIDE_HOLD_CLOSED_GRACE_MS - 1000).toISOString()
    await sweepSideHoldsImpl({ scanned: 0, settled: 0, notStale: 0, retried: 0, errors: 0 }, { graceMs: GRACE, limit: 500 })
    expect(log().status).toBe("refunded")
    expect(hold()).toMatchObject({ outcome: "refunded" })
  })

  it("at the cap, a never-billed hold whose refund does not land is NOT reported settled: its counter advances", async () => {
    await reserve()
    hold().created_at = new Date(Date.now() - GRACE - 60_000).toISOString()
    hold().sweep_attempts = METERED_SWEEP_MAX_ATTEMPTS - 1
    const svc = (await import("../../ee/billing/credits.js")).CreditsService
    vi.mocked(svc.refundCredits).mockImplementation(async () => {}) // never lands
    try {
      await sweepSideHoldsImpl({ scanned: 0, settled: 0, notStale: 0, retried: 0, errors: 0 }, { graceMs: GRACE, limit: 500 })
    } finally {
      vi.mocked(svc.refundCredits).mockReset()
    }
    expect(h.reports).toEqual([])
    expect(hold()).toMatchObject({ settled_at: null, sweep_attempts: METERED_SWEEP_MAX_ATTEMPTS })
  })

  it("head of line: the sweep reads fewest attempts first, then oldest", async () => {
    await sweepSideHoldsImpl({ scanned: 0, settled: 0, notStale: 0, retried: 0, errors: 0 }, { graceMs: GRACE, limit: 500 })
    expect(h.orders.filter((o) => o.startsWith("llm_side_holds."))).toEqual(["llm_side_holds.sweep_attempts", "llm_side_holds.created_at"])
  })
})

describe("R57 — a withdraw's platform refund of charged side holds", () => {
  it("refunds every charged side hold of the job; an unsupported one is reported, never silent", async () => {
    const { refundSettledSideHolds } = await import("../llm-side-hold.js")
    const a = await reserve()
    await a.callStarting()
    await a.settle(billed(0.004))
    expect(log().status).toBe("committed")
    await refundSettledSideHolds(JOB)
    expect(h.refundRpc).toEqual([a.usageLogId])
    expect(log().status).toBe("refunded")
    // An external-wallet row: not reversed here — reported.
    const b = await reserve()
    await b.callStarting()
    await b.settle(billed(0.004))
    h.refundAnswer = "unsupported"
    await refundSettledSideHolds(JOB)
    expect(h.reports).toEqual([expect.objectContaining({ kind: "side-hold-withdraw-refund-not-applied", jobId: JOB })])
  })
})

describe("callStarting — the per-hold call-start CAS", () => {
  it("stamps the hold (never the job) when the job is live", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    expect(hold()).toMatchObject({ pre_call: false })
    expect(hold().call_started_at).toEqual(expect.any(String))
    expect(h.db.jobs[0]).toEqual(clipRow())
  })

  it("a cancelled job: the call is NOT sent (JobCancelledError) and the hold is refunded", async () => {
    const sideHold = await reserve()
    h.db.jobs[0]!.status = "cancelled"
    await expect(sideHold.callStarting()).rejects.toBeInstanceOf(JobCancelledError)
    expect(log().status).toBe("refunded")
    expect(hold()).toMatchObject({ outcome: "refunded" })
    expect(hold().settled_at).toEqual(expect.any(String))
  })

  it("a hold already closed by someone else: not sent, and not released twice", async () => {
    const sideHold = await reserve()
    hold().closed_at = new Date().toISOString()
    await expect(sideHold.callStarting()).rejects.toThrow(/closed/)
    expect(h.refunds).toEqual([])
  })

  it("the stamp cannot be written: not sent, the hold released", async () => {
    const sideHold = await reserve()
    h.rpcError = "connection reset"
    await expect(sideHold.callStarting()).rejects.toThrow(/could not be recorded/)
    expect(log().status).toBe("refunded")
  })
})

describe("settle — the actual, on the hold's own row", () => {
  it("a billed reading is charged its actual through the metered commit; the job row is byte-unchanged", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    expect(await sideHold.settle(billed(0.006))).toEqual({ outcome: "charged", charged: 6, shortfall: 0 })
    expect(h.commits).toEqual([[sideHold.usageLogId, 6, { collectOverHold: true }]])
    expect(hold()).toMatchObject({ outcome: "charged", ledger: expect.objectContaining({ costUsd: 0.006, chargeId: `image-to-text:${MODEL}`, calls: 1 }) })
    expect(hold().closed_at).toEqual(expect.any(String))
    // Never provider_cost / credits_actual / llm_billing on the clip's row.
    expect(h.writes.filter(([t]) => t === "jobs")).toEqual([])
    expect(h.db.jobs[0]).toEqual(clipRow())
  })

  it("an actual above the hold is still charged (D1: the overrun is collected by the metered commit)", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    expect(await sideHold.settle(billed(0.0095))).toMatchObject({ outcome: "charged", charged: 10 })
  })

  it("nothing billed (a transport failure) is refunded", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    expect(await sideHold.settle(new LlmSpend())).toEqual({ outcome: "refunded" })
    expect(log().status).toBe("refunded")
    expect(hold()).toMatchObject({ outcome: "refunded" })
  })

  it("a late noteSpend never rewrites a settled hold's ledger (what was charged stays what is audited)", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    await sideHold.settle(billed(0.006))
    const charged = JSON.stringify(hold().ledger)
    await sideHold.noteSpend(billed(0.009))
    expect(JSON.stringify(hold().ledger)).toBe(charged)
  })

  it("an unconfirmed commit is `unsettled`: left reserved and closed with its ledger, for the sweep — never refunded", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    h.commitFails = true
    expect(await sideHold.settle(billed(0.006))).toEqual({ outcome: "unsettled" })
    expect(log().status).toBe("reserved")
    expect(hold()).toMatchObject({ settled_at: null, ledger: expect.objectContaining({ calls: 1, attempts: expect.any(Array) }) })
    expect(hold().closed_at).toEqual(expect.any(String))
    expect(h.refunds).toEqual([])
  })
})

describe("a cancel of the job — after its flip, per hold", () => {
  it("not started → refunded (nothing noted); the job's own holds are none of its business", async () => {
    await reserve()
    h.db.jobs[0]!.status = "cancelled"
    await settleSideHoldsAfterFlip([JOB])
    expect(log().status).toBe("refunded")
  })

  it("started → kept for the worker's settle at the actual (D10: never refunded on a guess)", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    h.db.jobs[0]!.status = "cancelled"
    await settleSideHoldsAfterFlip([JOB])
    expect(log().status).toBe("reserved")
    expect(h.refunds).toEqual([])
    expect(h.commits).toEqual([])
    // The worker's own settle then charges what the call billed.
    expect(await sideHold.settle(billed(0.005))).toMatchObject({ outcome: "charged", charged: 5 })
  })

  it("never before the flip: a job still live is not touched", async () => {
    await reserve()
    await settleSideHoldsAfterFlip([JOB])
    expect(log().status).toBe("reserved")
    expect(hold().closed_at).toBeNull()
  })

  it("R15: under the ROLLBACK a side hold reserved before the flip is still settled at the cancel — keyed off the hold, never the switch", async () => {
    await reserve()
    h.db.jobs[0]!.status = "cancelled"
    h.metered = false
    await settleSideHoldsAfterFlip([JOB])
    expect(log().status).toBe("refunded")
  })

  it("R33: before this process confirmed the metered schema a cancel reads nothing; the sweep settles the hold once it has", async () => {
    await reserve()
    h.db.jobs[0]!.status = "cancelled"
    h.schemaReady = false
    h.writes = []
    await settleSideHoldsAfterFlip([JOB])
    expect(log().status).toBe("reserved")
    expect(h.writes).toEqual([])
    h.schemaReady = true
    h.metered = false
    hold().created_at = new Date(Date.now() - GRACE - 60_000).toISOString()
    const { sweepSideLlmHolds } = await import("../reconcile/side-llm-holds.js")
    const counts = { scanned: 0, swept: 0, notStale: 0, errors: 0 }
    await sweepSideLlmHolds(counts)
    expect(counts).toMatchObject({ scanned: 1, swept: 1 })
    expect(log().status).toBe("refunded")
  })

  it("closed but unconfirmed (the worker's settle failed) → settled from its ledger", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    h.commitFails = true
    await sideHold.settle(billed(0.006))
    h.commitFails = false
    h.db.jobs[0]!.status = "cancelled"
    // Race: right after the worker closed it (its own settle under way, final ledger written), the
    // cancel leaves it to that settle…
    await settleSideHoldsAfterFlip([JOB])
    expect(log().status).toBe("reserved")
    // …past the closed grace, it settles from the ledger the close wrote: the same actual.
    hold().closed_at = new Date(Date.now() - SIDE_HOLD_CLOSED_GRACE_MS - 1000).toISOString()
    await settleSideHoldsAfterFlip([JOB])
    expect(log()).toMatchObject({ status: "committed", credits_charged: 6 })
    // The worker's own (late) settle of the same spend then dedupes: charged the same, no second commit moved.
    expect(await sideHold.settle(billed(0.006))).toMatchObject({ outcome: "charged", charged: 6 })
  })

  it("the close carries the FINAL ledger in the same write (a concurrent settle reads the spend being charged)", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    h.commitFails = true
    await sideHold.settle(billed(0.004))
    const closeWrite = h.writes.find(([t, op, patch]) => t === "llm_side_holds" && op === "update" && typeof (patch as Row).closed_at === "string")
    expect(closeWrite?.[2]).toMatchObject({ ledger: expect.objectContaining({ costUsd: 0.004, calls: 1 }) })
  })
})

describe("the side-hold sweep", () => {
  const counts = () => ({ scanned: 0, settled: 0, notStale: 0, retried: 0, errors: 0 })
  const age = (ms: number) => new Date(Date.now() - ms).toISOString()

  it("within the grace it is left (its worker may still be calling)", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    const r = counts()
    await sweepSideHoldsImpl(r, { graceMs: GRACE, limit: 500 })
    expect(r).toMatchObject({ scanned: 1, notStale: 1 })
    expect(log().status).toBe("reserved")
  })

  it("past the grace: a started hold whose worker died is charged its noted actual", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    await sideHold.noteSpend(billed(0.004))
    hold().call_started_at = age(GRACE + 60_000)
    const r = counts()
    await sweepSideHoldsImpl(r, { graceMs: GRACE, limit: 500 })
    expect(r).toMatchObject({ settled: 1 })
    expect(log()).toMatchObject({ status: "committed", credits_charged: 4 })
    expect(h.db.jobs[0]).toEqual(clipRow())
  })

  it("past the grace with nothing noted (never started, or an unnoted bill from a dead process) → refunded", async () => {
    await reserve()
    hold().created_at = age(GRACE + 60_000)
    await sweepSideHoldsImpl(counts(), { graceMs: GRACE, limit: 500 })
    expect(log().status).toBe("refunded")
  })

  it("a call that started since the read is left (the close is a CAS on the stamp)", async () => {
    await reserve()
    hold().created_at = age(GRACE + 60_000)
    const before = hold().call_started_at
    // The worker stamps between the sweep's read and its close.
    const { supabase } = await import("../supabase.js")
    const realFrom = supabase.from
    let first = true
    ;(supabase as { from: unknown }).from = (t: string) => {
      if (t === "llm_side_holds" && first) {
        first = false
        const q = realFrom(t) as unknown as { then: (res: (v: { data: Row[] }) => unknown) => unknown }
        const then = q.then
        q.then = (res) => then.call(q, (v: { data: Row[] }) => {
          const snapshot = v.data.map((r) => ({ ...r }))
          hold().pre_call = false
          hold().call_started_at = new Date().toISOString()
          return res({ ...v, data: snapshot })
        })
        return q
      }
      return realFrom(t)
    }
    const r = counts()
    try {
      await sweepSideHoldsImpl(r, { graceMs: GRACE, limit: 500 })
    } finally {
      ;(supabase as { from: unknown }).from = realFrom
    }
    expect(before).toBeNull()
    expect(r.notStale).toBe(1)
    expect(log().status).toBe("reserved")
    expect(hold().closed_at).toBeNull()
  })

  it("an unconfirmed settle advances the HOLD's own counter (never the job's); at the D10 cap a billed hold is charged whole and reported", async () => {
    const sideHold = await reserve()
    await sideHold.callStarting()
    await sideHold.noteSpend(billed(0.006))
    hold().call_started_at = age(GRACE + 60_000)
    h.commitFails = true
    for (let i = 1; i < METERED_SWEEP_MAX_ATTEMPTS; i++) {
      if (hold().closed_at) hold().closed_at = age(SIDE_HOLD_CLOSED_GRACE_MS + 1000)
      await sweepSideHoldsImpl(counts(), { graceMs: GRACE, limit: 500 })
      expect(hold()).toMatchObject({ sweep_attempts: i, sweep_billed: true })
    }
    expect(log().status).toBe("reserved")
    h.commitFails = false
    // At the cap the plain commit (no collectOverHold) charges the hold whole.
    const plain = vi.mocked((await import("../../ee/billing/credits.js")).CreditsService.commitCredits)
    plain.mockImplementationOnce(async () => undefined) // the metered commit still fails this tick
    hold().closed_at = age(SIDE_HOLD_CLOSED_GRACE_MS + 1000)
    await sweepSideHoldsImpl(counts(), { graceMs: GRACE, limit: 500 })
    expect(log()).toMatchObject({ status: "committed", credits_charged: 4 })
    expect(hold()).toMatchObject({ outcome: "charged" })
    expect(h.reports).toEqual([expect.objectContaining({ kind: "metered-side-hold-charged-at-cap", severity: "error", jobId: JOB })])
    expect(h.db.jobs[0]).toEqual(clipRow())
  })

  it("at the cap a hold never confirmed billed is refunded and reported", async () => {
    await reserve()
    hold().created_at = age(GRACE + 60_000)
    hold().sweep_attempts = METERED_SWEEP_MAX_ATTEMPTS - 1
    // The refund of an empty spend fails to land this tick: the cap refunds it.
    const svc = (await import("../../ee/billing/credits.js")).CreditsService
    vi.mocked(svc.refundCredits).mockImplementationOnce(async () => { throw new Error("rpc down") })
    await sweepSideHoldsImpl(counts(), { graceMs: GRACE, limit: 500 })
    expect(log().status).toBe("refunded")
    expect(h.reports).toEqual([expect.objectContaining({ kind: "metered-side-hold-refunded-at-cap" })])
  })

  it("a log another writer already settled is recorded as settled", async () => {
    await reserve()
    log().status = "committed"
    const r = counts()
    await sweepSideHoldsImpl(r, { graceMs: GRACE, limit: 500 })
    expect(hold()).toMatchObject({ outcome: "charged" })
    expect(r.settled).toBe(1)
  })

  it("grace: from the call's start, else the reservation; a closed hold has none", () => {
    const now = Date.now()
    expect(sideHoldPastGrace({ call_started_at: null, created_at: new Date(now - GRACE - 1).toISOString(), closed_at: null }, now, GRACE)).toBe(true)
    expect(sideHoldPastGrace({ call_started_at: new Date(now - 1000).toISOString(), created_at: new Date(now - GRACE - 1).toISOString(), closed_at: null }, now, GRACE)).toBe(false)
    // A closed hold: only past the short closed grace (its closer's settle is under way).
    expect(sideHoldPastGrace({ call_started_at: new Date(now).toISOString(), created_at: new Date(now).toISOString(), closed_at: new Date(now).toISOString() }, now, GRACE)).toBe(false)
    expect(sideHoldPastGrace({ call_started_at: null, created_at: new Date(now).toISOString(), closed_at: new Date(now - SIDE_HOLD_CLOSED_GRACE_MS - 1).toISOString() }, now, GRACE)).toBe(true)
  })
})
