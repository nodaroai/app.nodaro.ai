import { describe, it, expect, vi, beforeEach } from "vitest"
import { FakeDb } from "./helpers/fake-jobs-db.js"

/**
 * The sweep behind the deferred child settlement: the person pays for ONE
 * engine run. A completed run keeps one take charged; a failed, cancelled or
 * gone run's held takes are released; a run going implausibly long releases
 * its held take; nothing moves inside the grace period; a release scheduled
 * while a take ran is carried out; and no look-back window can strand a hold.
 */

const db = vi.hoisted(() => ({ current: null as unknown as { from: (t: string) => unknown } }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => db.current.from(t) } }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCredits: () => true,
}))
const money = vi.hoisted(() => ({ commitJobCredits: vi.fn(), refundLoopTrimAddon: vi.fn(), refundCredits: vi.fn() }))
vi.mock("@/workers/shared.js", () => ({ commitJobCredits: money.commitJobCredits, refundLoopTrimAddon: money.refundLoopTrimAddon }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { refundCredits: money.refundCredits } }))

import { DEFERRED_CHILD_SWEEP, planCompletedRun, sweepDeferredChildSettlements } from "../deferred-child-settlement-sweep.js"

const NOW = Date.parse("2026-11-23T12:00:00.000Z")
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000

let fake: FakeDb
let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`

function parent(status: string, completedAgoMs: number | null): string {
  const pid = id()
  fake.tables.jobs!.push({ id: pid, status, completed_at: completedAgoMs === null ? null : ago(completedAgoMs), parent_job_id: null })
  return pid
}

function child(parentId: string, completedAgoMs: number, opts: { state?: string; open?: boolean; logStatus?: string; scheduled?: string } = {}): string {
  const cid = id()
  fake.tables.jobs!.push({
    id: cid,
    status: "completed",
    input_data: { __deferSettlement: true, ...(opts.scheduled ? { __deferredRelease: { reason: opts.scheduled } } : {}) },
    user_id: "u",
    parent_job_id: parentId,
    workflow_id: null,
    workflow_execution_id: null,
    completed_at: ago(completedAgoMs),
    credits_actual: 40,
    billing_force_refund: false,
    held_completion_fields: { deferredSettlement: { version: 1, state: opts.state ?? "held", open: opts.open ?? true, commit: {}, providerCost: 0.5, deferredAt: ago(completedAgoMs) } },
  })
  fake.tables.usage_logs!.push({ id: id(), job_id: cid, status: opts.logStatus ?? "reserved", credits_used: 40 })
  return cid
}

const logOf = (jobId: string) => fake.tables.usage_logs!.find((l) => l.job_id === jobId)!.status
const recOf = (jobId: string) => (fake.row("jobs", jobId)!.held_completion_fields as Record<string, Record<string, unknown>>).deferredSettlement!

beforeEach(() => {
  vi.clearAllMocks()
  fake = new FakeDb()
  db.current = fake
  money.commitJobCredits.mockImplementation(async (usageLogId: string) => {
    const l = fake.row("usage_logs", usageLogId)
    if (l?.status === "reserved") l.status = "committed"
  })
  money.refundCredits.mockImplementation(async (usageLogId: string) => {
    const l = fake.row("usage_logs", usageLogId)
    if (l?.status === "reserved") l.status = "refunded"
  })
})

const run = () => sweepDeferredChildSettlements(new Date(NOW))
const alerts = () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined)
  return { count: () => spy.mock.calls.filter(([m]) => String(m).startsWith("[ALERT]")).length, restore: () => spy.mockRestore() }
}

describe("a COMPLETED run keeps one take charged", () => {
  it("its only held take (whose settle did not land) is settled, quietly", async () => {
    const a = alerts()
    const c = child(parent("completed", 15 * MIN), 20 * MIN)
    expect((await run()).settled).toBe(1)
    expect(logOf(c)).toBe("committed")
    expect(recOf(c)).toMatchObject({ state: "settled", open: false, decidedBy: "sweep" })
    expect(a.count()).toBe(0)
    a.restore()
  })

  it("a sibling already settled: every take still held is released (the discards), with an alert", async () => {
    const a = alerts()
    const p = parent("completed", 15 * MIN)
    const delivered = child(p, 18 * MIN, { state: "settled", open: false, logStatus: "committed" })
    const discarded = child(p, 25 * MIN)
    const r = await run()
    expect(r.released).toBe(1)
    expect(r.settled).toBe(0)
    expect(logOf(discarded)).toBe("refunded")
    expect(logOf(delivered)).toBe("committed")
    expect(a.count()).toBe(1)
    a.restore()
  })

  it("the reported case — take A's release never landed, B settled — the user pays once", async () => {
    const p = parent("completed", 15 * MIN)
    const takeA = child(p, 40 * MIN)
    child(p, 20 * MIN, { state: "settled", open: false, logStatus: "committed" })
    const a = alerts()
    await run()
    a.restore()
    expect(logOf(takeA)).toBe("refunded")
    expect(money.commitJobCredits).not.toHaveBeenCalled()
  })

  it("none settled, several held: the latest is settled, the rest released, with one alert", async () => {
    const a = alerts()
    const p = parent("completed", 15 * MIN)
    const older = child(p, 40 * MIN)
    const latest = child(p, 20 * MIN)
    const r = await run()
    expect(r).toMatchObject({ settled: 1, released: 1 })
    expect(logOf(latest)).toBe("committed")
    expect(logOf(older)).toBe("refunded")
    expect(a.count()).toBe(1)
    a.restore()
  })

  it("an earlier released take plus one held: the held one is settled, with an alert (more than one deferred child)", async () => {
    const a = alerts()
    const p = parent("completed", 15 * MIN)
    child(p, 40 * MIN, { state: "released", open: false, logStatus: "refunded" })
    const held = child(p, 20 * MIN)
    await run()
    expect(logOf(held)).toBe("committed")
    expect(a.count()).toBe(1)
    a.restore()
  })

  it("waits out the grace period", async () => {
    const c = child(parent("completed", 2 * MIN), 5 * MIN)
    await run()
    expect(logOf(c)).toBe("reserved")
  })
})

describe("planCompletedRun", () => {
  it("settles the latest held take when none is settled", () => {
    expect(planCompletedRun([{ id: "a", completed_at: "2026-01-01T00:00:00Z", state: "held" }, { id: "b", completed_at: "2026-01-01T00:05:00Z", state: "held" }], ["a", "b"]))
      .toEqual({ settle: ["b"], release: ["a"], alert: true })
  })
  it("releases every held take once one is settled", () => {
    expect(planCompletedRun([{ id: "a", completed_at: null, state: "settled" }, { id: "b", completed_at: null, state: "held" }], ["b"]))
      .toEqual({ settle: [], release: ["b"], alert: true })
  })
  it("one held take alone: settled, no alert", () => {
    expect(planCompletedRun([{ id: "a", completed_at: null, state: "held" }], ["a"])).toEqual({ settle: ["a"], release: [], alert: false })
  })
})

describe("other runs", () => {
  it.each(["failed", "cancelled"])("a run that %s: its held takes are released", async (status) => {
    const c = child(parent(status, 15 * MIN), 20 * MIN)
    expect((await run()).released).toBe(1)
    expect(logOf(c)).toBe("refunded")
    expect(fake.row("jobs", c)!.credits_actual).toBe(0)
  })

  it("a run still going: left alone, then released with an alert after 12 hours", async () => {
    const a = alerts()
    const p = parent("processing", null)
    const young = child(p, 3 * 3_600_000)
    const old = child(p, DEFERRED_CHILD_SWEEP.longParentMs + MIN)
    await run()
    expect(logOf(young)).toBe("reserved")
    expect(logOf(old)).toBe("refunded")
    expect(a.count()).toBe(1)
    a.restore()
  })

  it("no look-back window: a take held for days is still resolved", async () => {
    const c = child(parent("completed", 5 * 24 * 3_600_000), 5 * 24 * 3_600_000 + 10 * MIN)
    await run()
    expect(logOf(c)).toBe("committed")
  })
})

describe("recovery", () => {
  it("a release scheduled while the take ran, not carried out at completion: released whatever the run's state", async () => {
    const c = child(parent("processing", null), 2 * MIN, { scheduled: "the run failed" })
    expect((await run()).released).toBe(1)
    expect(logOf(c)).toBe("refunded")
    expect(recOf(c)).toMatchObject({ state: "released", reason: "the run failed" })
  })

  it("a decision recorded before a crash (hold still open) is finished", async () => {
    const c = child(parent("processing", null), 5 * MIN, { state: "released" })
    await run()
    expect(logOf(c)).toBe("refunded")
    expect(recOf(c).open).toBe(false)
  })

  it("a hold another path refunded: the row is closed as released, no money moved", async () => {
    const c = child(parent("processing", null), 5 * MIN, { logStatus: "refunded" })
    const r = await run()
    expect(r.healed).toBe(1)
    expect(recOf(c)).toMatchObject({ state: "released", open: false })
    expect(fake.row("jobs", c)!.credits_actual).toBe(0)
    expect(money.refundCredits).not.toHaveBeenCalled()
  })

  it("a closed record is never read again", async () => {
    child(parent("completed", 60 * MIN), 70 * MIN, { state: "settled", open: false, logStatus: "committed" })
    expect((await run()).scanned).toBe(0)
  })

  it("the 12-hour bound sits below the First Remake offer's 24-hour auto-end", () => {
    expect(DEFERRED_CHILD_SWEEP.longParentMs).toBeLessThan(24 * 3_600_000)
  })
})
