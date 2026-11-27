import { beforeEach, describe, expect, it, vi } from "vitest"
const h = vi.hoisted(() => ({ upsert: vi.fn(), readBack: vi.fn(), table: null as null | (() => unknown) }))
vi.mock("../supabase.js", () => ({
  supabase: { from: () => {
    // (A test can put a whole table in place: the settle row below.)
    if (h.table) return h.table()
    const chain = { eq: () => chain, select: () => chain, maybeSingle: h.readBack }
    return { update: () => chain, upsert: h.upsert }
  } },
}))
const { decideRouteSettleHold, holdRouteSettle, patchRouteSettle, recordRouteStartRef, recordRouteSettle, recordRouteTask, routeBillingAtOf, routeCostBasisOf, verifiedReportedUsd, verifiedTaskUsd } = await import("../video-route-ledger.js")
const { getRuntimeEnv } = await import("../runtime-env.js")
const { createFakeTables } = await import("../../ee/billing/__tests__/helpers/fake-tables.js")
beforeEach(() => {
  vi.resetAllMocks()
  h.table = null
})

describe("routed task evidence", () => {
  it("records a bill with its basis, an estimate beside it, and a bill of zero as no bill", async () => {
    const db = createFakeTables()
    h.table = () => db.client.from("video_route_ledger")
    const row = () => db.rows("video_route_ledger")[0]!
    await recordRouteTask("job", 1, "task", 0.5, "segment", 0.4)
    expect(row()).toMatchObject({ billed_usd: 0.5, estimated_usd: 0.4, cost_basis: "receipt" })
    // Zero (or less) is not a bill: it never overwrites a row that has one (the settlement is pending, never a free run).
    await recordRouteTask("job", 1, "task", 0, "segment", 0.4)
    expect(row()).toMatchObject({ billed_usd: 0.5 })
    // Billed seconds at the agreed rate: a verified bill, recorded with its basis.
    await recordRouteTask("job", 1, "task", 0.4, "segment", undefined, "billed-seconds")
    expect(row()).toMatchObject({ billed_usd: 0.4, cost_basis: "billed-seconds" })
    // An estimate alone is recorded as an estimate: no bill, no basis.
    await recordRouteTask("job", 2, "task2", null, "segment", 0.4, "billed-seconds")
    expect(db.rows("video_route_ledger", { send: 2 })[0]).toMatchObject({ billed_usd: null, estimated_usd: 0.4 })
    expect(db.rows("video_route_ledger", { send: 2 })[0]).not.toHaveProperty("cost_basis")
    await recordRouteTask("job", 3, "task3", 0, "segment")
    expect(db.rows("video_route_ledger", { send: 3 })[0]).toMatchObject({ billed_usd: null })
  })

  it("a bill that arrives on a row written without one never drops what another writer kept on it meanwhile (a send marked as our own loss)", async () => {
    const at = "2026-11-27T10:00:00.000+00:00"
    const db = createFakeTables({ video_route_ledger: [{ id: 1, job_id: "job", env: getRuntimeEnv(), kind: "task", send: 1, key: "", ref: "t", billed_usd: null, detail: null, created_at: at, updated_at: at }] })
    let raced = false
    h.table = () => {
      const b = db.client.from("video_route_ledger") as Record<string, (...a: never[]) => unknown>
      const select = b.select!
      b.select = ((cols: string, o?: unknown) => {
        const out = (select as (c: string, o?: unknown) => unknown)(cols, o)
        // The bill's writer reads the row; before its write lands, another writer marks the send as our own loss.
        if (!raced && cols === "id, billed_usd, detail, updated_at") {
          raced = true
          const then = b.then as (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise<unknown>
          b.then = ((ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => then((v) => {
            Object.assign(db.rows("video_route_ledger")[0]!, { detail: { ownLoss: true }, updated_at: "2026-11-27T10:00:01.000+00:00" })
            return ok(v)
          }, bad)) as never
        }
        return out
      }) as never
      return b
    }
    expect(await recordRouteTask("job", 1, "t", 0.5)).toBe(true)
    expect(db.rows("video_route_ledger")[0]).toMatchObject({ billed_usd: 0.5, detail: { ownLoss: true, billedAt: expect.any(String) } })
  })

  it("keeps the time the route's own record says a task finished, and the reconciliation's day follows it", async () => {
    const db = createFakeTables()
    h.table = () => db.client.from("video_route_ledger")
    await recordRouteTask("job", 1, "t", null, "", undefined, undefined, { completedAt: "2026-11-26T23:59:00Z" })
    // The bill arrives later on the same row: the route's own time is what the day is counted on.
    await recordRouteTask("job", 1, "t", 0.5)
    const row = db.rows("video_route_ledger")[0]!
    expect(row.detail).toMatchObject({ completedAt: "2026-11-26T23:59:00.000Z", billedAt: expect.any(String) })
    expect(routeBillingAtOf(row)).toBe("2026-11-26T23:59:00.000Z")
  })

  it("a finish time in the future is taken as now", async () => {
    const db = createFakeTables()
    h.table = () => db.client.from("video_route_ledger")
    const before = Date.now()
    await recordRouteTask("job", 1, "t", 0.5, "", undefined, undefined, { completedAt: "2099-01-01T00:00:00Z" })
    const kept = Date.parse(String((db.rows("video_route_ledger")[0]!.detail as Record<string, unknown>).completedAt))
    expect(kept).toBeGreaterThanOrEqual(before)
    expect(kept).toBeLessThanOrEqual(Date.now())
  })

  it("without the route's own time, a bill counts on the day the task was first read done", () => {
    const created = "2026-11-26T10:00:00.000+00:00"
    const billedAt = "2026-11-28T09:00:00.000Z"
    // Written by a done read: its row's own time, however late its bill arrived.
    expect(routeBillingAtOf({ created_at: created, outcome: null, detail: { billedAt } })).toBe(created)
    // Written by a read that did not find it done (given up on): the read that brought its bill.
    expect(routeBillingAtOf({ created_at: created, outcome: "unresolved", detail: { billedAt } })).toBe(billedAt)
    expect(routeBillingAtOf({ created_at: "not a time", detail: null })).toBeUndefined()
  })

  it("only a reported bill is a verified cost, whatever its basis; an estimate never is", () => {
    expect(routeCostBasisOf({ providerCostUsd: 0.5, costBasis: "receipt" })).toBe("receipt")
    expect(routeCostBasisOf({ providerCostUsd: 0.5, costBasis: "billed-seconds" })).toBe("billed-seconds")
    // A route that predates the field: a reported bill reads as a receipt.
    expect(routeCostBasisOf({ providerCostUsd: 0.5 })).toBe("receipt")
    expect(routeCostBasisOf({ costBasis: "billed-seconds" })).toBeUndefined()
    expect(routeCostBasisOf({ estimatedCostUsd: 0.4, billedSec: 8 } as never)).toBeUndefined()
    expect(verifiedReportedUsd({ providerCostUsd: 0.5 })).toBe(0.5)
    for (const none of [{ providerCostUsd: 0 }, {}, { estimatedCostUsd: 0.4 }, { estimatedCostUsd: 0.4, billedSec: 8 }, { providerCostUsd: NaN, estimatedCostUsd: 0.4 }, { providerCostUsd: -1, estimatedCostUsd: 0.4 }]) {
      expect(verifiedReportedUsd(none as never)).toBeNull()
    }
    // As stored: the bill column alone decides; the estimate column is never read.
    expect(verifiedTaskUsd({ billed_usd: "0.500000", estimated_usd: "0.400000" } as never)).toBe(0.5)
    expect(verifiedTaskUsd({ billed_usd: 0, estimated_usd: 0.4 } as never)).toBeNull()
    expect(verifiedTaskUsd({ billed_usd: "0.000000" })).toBeNull()
    expect(verifiedTaskUsd({ billed_usd: null, estimated_usd: "0.400000", cost_basis: "billed-seconds" } as never)).toBeNull()
  })

  it("refuses to publish a completed task when neither ledger write succeeded", async () => {
    const db = createFakeTables()
    h.table = () => db.client.from("video_route_ledger")
    db.failNextWrite("video_route_ledger")
    // The first write fails, the retry lands.
    await expect(recordRouteTask("job", 1, "task", 1)).resolves.toBe(true)
    db.failNextWrite("video_route_ledger")
    const again = createFakeTables()
    h.table = () => ({ ...again.client.from("video_route_ledger") as object, insert: async () => ({ error: { message: "unavailable" } }) })
    await expect(recordRouteTask("job", 1, "task", 1)).rejects.toThrow(/could not record/)
  })

  it("cannot acknowledge a missing start or a failed settlement write", async () => {
    h.readBack.mockResolvedValue({ data: null, error: null })
    await expect(recordRouteStartRef("job", 1, "k", "t")).rejects.toThrow(/task reference/)
    expect(h.readBack).toHaveBeenCalledTimes(2)
    h.upsert.mockResolvedValue({ error: { message: "unavailable" } })
    await expect(recordRouteSettle("job", "retry")).rejects.toThrow(/unavailable/)
  })
})

describe("a settlement that ends", () => {
  it("drops the time its retry backoff left, so the late-bill pass never reads it as a watch", async () => {
    const at = "2026-11-27T10:00:00.000+00:00"
    const db = createFakeTables({ video_route_ledger: [{ id: 1, job_id: "job", env: getRuntimeEnv(), kind: "settle", send: 1, key: "", state: "retry", next_attempt_at: "2026-11-27T11:00:00.000Z", detail: { firstAttemptAt: at }, created_at: at, updated_at: at }] })
    h.table = () => db.client.from("video_route_ledger")
    await recordRouteSettle("job", "done", { credits: 5 })
    expect(db.rows("video_route_ledger")[0]).toMatchObject({ state: "done", credits: 5, next_attempt_at: null, detail: { firstAttemptAt: at } })
    // A retry mark keeps its backoff (and is never written over a row that is there).
    db.rows("video_route_ledger")[0]!.next_attempt_at = "2026-11-27T12:00:00.000Z"
    await recordRouteSettle("job", "retry", { note: "again" })
    expect(db.rows("video_route_ledger")[0]).toMatchObject({ state: "done", next_attempt_at: "2026-11-27T12:00:00.000Z" })
  })
})

describe("a settle row written only while it holds what the writer read", () => {
  it("is not written when its condition no longer holds on the row's current read (a watch started meanwhile keeps its next read)", async () => {
    const at = "2026-11-27T10:00:00.000+00:00"
    const db = createFakeTables({ video_route_ledger: [{ id: 1, job_id: "job", env: getRuntimeEnv(), kind: "settle", send: 1, key: "", state: "done", next_attempt_at: "2026-11-28T10:00:00.000Z", detail: { watchUntil: "2026-12-04T10:00:00.000Z" }, created_at: at, updated_at: at }] })
    h.table = () => db.client.from("video_route_ledger")
    expect(await patchRouteSettle("job", {}, { next_attempt_at: null }, { onlyStates: ["done"], onlyIf: (row) => typeof row.detail.watchUntil !== "string" })).toBe(false)
    expect(db.rows("video_route_ledger")[0]!.next_attempt_at).toBe("2026-11-28T10:00:00.000Z")
    db.rows("video_route_ledger")[0]!.detail = {}
    expect(await patchRouteSettle("job", {}, { next_attempt_at: null }, { onlyStates: ["done"], onlyIf: (row) => typeof row.detail.watchUntil !== "string" })).toBe(true)
    expect(db.rows("video_route_ledger")[0]!.next_attempt_at).toBeNull()
  })
})

describe("the settle row's kept detail", () => {
  type Row = Record<string, unknown> & { id: number; detail: Record<string, unknown> | null; updated_at: string }
  /** One settle row, written as the store writes it: an update lands only on the rows every filter matches. */
  function settleRow(row: Row | null, opts: { beforeWrite?: (row: Row, attempt: number) => void; insertError?: { code: string; message: string }; readError?: { message: string }; updateError?: { message: string } } = {}) {
    const state = { row, reads: 0, writes: 0, updates: [] as Array<Record<string, unknown>> }
    h.table = () => {
      const where: Array<[string, unknown]> = []
      const anyOf: Array<[string, unknown[]]> = []
      let patch: Record<string, unknown> | null = null
      const hit = () => (state.row && where.every(([c, v]) => (state.row![c] ?? null) === v) && anyOf.every(([c, vs]) => vs.includes(state.row![c] ?? null)) ? [state.row] : [])
      const write = () => {
        state.updates.push(patch!)
        const rows = hit()
        for (const r of rows) Object.assign(r, patch)
        return rows
      }
      const q: Record<string, unknown> = {}
      q.eq = (c: string, v: unknown) => (where.push([c, v]), q)
      q.is = (c: string, v: unknown) => (where.push([c, v]), q)
      q.in = (c: string, vs: unknown[]) => (anyOf.push([c, vs]), q)
      q.insert = async () => ({ error: opts.insertError ?? null })
      q.update = (p: Record<string, unknown>) => ((patch = p), q)
      q.limit = async () => (state.reads++, opts.readError ? { data: null, error: opts.readError } : { data: hit().map((r) => structuredClone(r)), error: null })
      q.select = () => {
        if (!patch) return q
        if (opts.updateError) return Promise.resolve({ data: null, error: opts.updateError })
        if (state.row && "detail" in patch) opts.beforeWrite?.(state.row, ++state.writes)
        return Promise.resolve({ data: write().map((r) => ({ id: r.id })), error: null })
      }
      q.then = (ok: (v: unknown) => unknown) => (patch ? write() : undefined, Promise.resolve({ error: null }).then(ok))
      return q
    }
    return state
  }
  const row = (over: Record<string, unknown> = {}): Row => ({ id: 7, job_id: "job", env: getRuntimeEnv(), kind: "settle", state: "hold", decision: null, detail: { watchUntil: "w" }, updated_at: "2026-11-25T00:00:00.000Z", ...over })

  it("merges into what is kept, sets the columns beside it, and moves the row's stamp", async () => {
    const t = settleRow(row())
    expect(await patchRouteSettle("job", { firstAttemptAt: "a" }, { next_attempt_at: "n" })).toBe(true)
    expect(t.row).toMatchObject({ detail: { watchUntil: "w", firstAttemptAt: "a" }, next_attempt_at: "n" })
    expect(t.row!.updated_at).not.toBe("2026-11-25T00:00:00.000Z")
    expect(t.reads).toBe(1)
  })

  it("never loses what another writer kept meanwhile: a write over a stale read does not land, and is tried again on a fresh read", async () => {
    // Between this call's read and its write, another writer keeps a late bill on the row.
    const t = settleRow(row(), { beforeWrite: (r, attempt) => { if (attempt === 1) Object.assign(r, { detail: { ...r.detail, lateBill: { knownCredits: 260 } }, updated_at: "2026-11-25T00:00:01.000Z" }) } })
    expect(await patchRouteSettle("job", { firstAttemptAt: "a" })).toBe(true)
    expect(t.row!.detail).toEqual({ watchUntil: "w", lateBill: { knownCredits: 260 }, firstAttemptAt: "a" })
    expect(t.reads).toBe(2)
  })

  it("gives up after a few tries, and says so; a row that is not there is not written", async () => {
    let n = 0
    const t = settleRow(row(), { beforeWrite: (r) => { r.updated_at = `moved-${++n}` } })
    expect(await patchRouteSettle("job", { firstAttemptAt: "a" })).toBe(false)
    expect(t.reads).toBe(4)
    expect(t.row!.detail).toEqual({ watchUntil: "w" })
    const none = settleRow(null)
    expect(await patchRouteSettle("job", { firstAttemptAt: "a" })).toBe(false)
    expect(none.updates).toEqual([])
  })

  it("a decision keeps the total it was made for beside it (and that a quote was chosen), in the one write that decides", async () => {
    const t = settleRow(row())
    expect(await decideRouteSettleHold("job", "confirmed", "admin-1", "anomaly", 905)).toBe(true)
    expect(t.row).toMatchObject({ state: "retry", decision: "confirmed", decided_by: "admin-1", detail: { watchUntil: "w", decidedForCredits: 905 } })
    // One write: the decision and what it was made for land together, or not at all.
    expect(t.updates).toHaveLength(1)
    const u = settleRow(row({ state: "unbilled" }))
    expect(await decideRouteSettleHold("job", "quote", "admin-1", "unbilled", 100)).toBe(true)
    expect(u.row).toMatchObject({ state: "retry", decision: "quote", detail: { watchUntil: "w", atQuote: true, decidedForCredits: 100 } })
    // A release names no total: what was kept stays as it was.
    const r = settleRow(row())
    expect(await decideRouteSettleHold("job", "rejected", "admin-1")).toBe(true)
    expect(r.row).toMatchObject({ decision: "rejected" })
    expect(r.row!.detail).toEqual({ watchUntil: "w" })
  })

  it("a click that loses the race changes nothing: the winner's decision and its kept total stay", async () => {
    // Decided already, for 900.
    const decided = settleRow(row({ state: "retry", decision: "confirmed", decided_by: "admin-1", detail: { decidedForCredits: 900 } }))
    expect(await decideRouteSettleHold("job", "confirmed", "admin-2", "anomaly", 1500)).toBe(false)
    expect(await decideRouteSettleHold("job", "rejected", "admin-2")).toBe(false)
    expect(decided.row).toMatchObject({ state: "retry", decision: "confirmed", decided_by: "admin-1", detail: { decidedForCredits: 900 } })
    // Decided by another click between this one's read and its write.
    const racing = settleRow(row(), { beforeWrite: (r) => { Object.assign(r, { state: "retry", decision: "confirmed", decided_by: "admin-1", detail: { ...r.detail, decidedForCredits: 900 } }) } })
    expect(await decideRouteSettleHold("job", "confirmed", "admin-2", "anomaly", 1500)).toBe(false)
    expect(racing.row).toMatchObject({ state: "retry", decision: "confirmed", decided_by: "admin-1", detail: { watchUntil: "w", decidedForCredits: 900 } })
    // A row that changed kind since the admin looked is not decided by this click either.
    const moved = settleRow(row({ state: "unbilled" }))
    expect(await decideRouteSettleHold("job", "confirmed", "admin-2", "anomaly", 1500)).toBe(false)
    expect(moved.row).toMatchObject({ state: "unbilled", decision: null, detail: { watchUntil: "w" } })
  })

  it("a decision is not made when the row cannot be read or written, and says so", async () => {
    const unread = settleRow(row(), { readError: { message: "unavailable" } })
    await expect(decideRouteSettleHold("job", "confirmed", "admin-1", "anomaly", 905)).rejects.toThrow(/could not read its held settlement/)
    expect(unread.updates).toEqual([])
    expect(unread.row).toMatchObject({ state: "hold", decision: null })
    settleRow(row(), { updateError: { message: "unavailable" } })
    await expect(decideRouteSettleHold("job", "confirmed", "admin-1", "anomaly", 905)).rejects.toThrow(/could not record the decision/)
  })

  it.each(["quote", "confirmed"] as const)("a %s decision whose total is then held is spent: the hold waits for a decision of its own", async (decision) => {
    const t = settleRow(row({ state: "retry", decision, detail: { decidedForCredits: 900 } }), { insertError: { code: "23505", message: "duplicate" } })
    expect(await holdRouteSettle("job", { credits: 1500, billedUsd: 3, quotedUsd: 0.2, note: "15x" })).toBe(true)
    expect(t.row).toMatchObject({ state: "hold", decision: null, credits: 1500 })
    // A release is never spent: its settlement is not held over it.
    const rejected = settleRow(row({ state: "retry", decision: "rejected" }), { insertError: { code: "23505", message: "duplicate" } })
    expect(await holdRouteSettle("job", { credits: 1500, billedUsd: 3, quotedUsd: 0.2, note: "15x" })).toBe(false)
    expect(rejected.row).toMatchObject({ state: "retry", decision: "rejected" })
  })
})
