import { describe, it, expect, vi, beforeEach } from "vitest"
import { FakeDb } from "./helpers/fake-jobs-db.js"

/**
 * The "delivered" rule (lib/deferred-child-request.ts): a held step whose file
 * the run may or may not deliver (Video Remake's upscale) is charged only when
 * its run COMPLETED and the completion lists it under
 * `__deliveredHeldChildren`; released when the list leaves it out, or the run
 * failed, was cancelled, is gone or ran 12 h; charged (with an [ALERT]) when
 * the completion has no list at all. It is never pooled with the run's engine
 * takes in either direction, and a delete of a completed run decides it the
 * same way.
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

import { sweepDeferredChildSettlements } from "../deferred-child-settlement-sweep.js"
import { deferredCompletionFields, planDeliveredChildren, resolveDeferredChild } from "../deferred-child-settlement.js"
import { releaseHeldChildrenBeforeDelete } from "../deferred-child-delete.js"
import { DELIVERED_HELD_CHILDREN_OUTPUT_KEY, storedDeferRule } from "../deferred-child-request.js"

const NOW = Date.parse("2026-11-24T12:00:00.000Z")
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000

let fake: FakeDb
let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`

function parent(status: string, completedAgoMs: number | null, output?: Record<string, unknown>): string {
  const pid = id()
  fake.tables.jobs!.push({
    id: pid, status, user_id: "u", workflow_id: null, completed_at: completedAgoMs === null ? null : ago(completedAgoMs), parent_job_id: null,
    output_data: output ?? null,
  })
  return pid
}

/** A held child: an upscale (`rule: "delivered"`, on its request and its record) or an engine take. */
function child(parentId: string, completedAgoMs: number, opts: { upscale?: boolean; state?: string; open?: boolean; logStatus?: string; ruleOnRecord?: boolean } = {}): string {
  const cid = id()
  const rule = opts.upscale ? { __deferSettlementRule: "delivered" } : {}
  fake.tables.jobs!.push({
    id: cid,
    status: "completed",
    input_data: { __deferSettlement: true, ...rule },
    user_id: "u",
    parent_job_id: parentId,
    workflow_id: null,
    workflow_execution_id: null,
    completed_at: ago(completedAgoMs),
    credits_actual: 40,
    billing_force_refund: false,
    held_completion_fields: {
      deferredSettlement: {
        version: 1, state: opts.state ?? "held", open: opts.open ?? true, commit: {}, providerCost: 0.5, deferredAt: ago(completedAgoMs),
        ...(opts.upscale && opts.ruleOnRecord !== false ? { rule: "delivered" } : {}),
      },
    },
  })
  fake.tables.usage_logs!.push({ id: id(), job_id: cid, status: opts.logStatus ?? "reserved", credits_used: 40 })
  return cid
}

const logOf = (jobId: string) => fake.tables.usage_logs!.find((l) => l.job_id === jobId)!.status
const delivered = (...ids: string[]) => ({ videoUrl: "https://x/v.mp4", [DELIVERED_HELD_CHILDREN_OUTPUT_KEY]: ids })

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

describe("planDeliveredChildren", () => {
  const held = [{ id: "a", completed_at: "2026-11-24T10:00:00Z" }, { id: "b", completed_at: "2026-11-24T11:00:00Z" }]
  it("settles exactly the listed children and releases the rest", () => {
    expect(planDeliveredChildren({ [DELIVERED_HELD_CHILDREN_OUTPUT_KEY]: ["a"] }, held)).toEqual({ settle: ["a"], release: ["b"], listMissing: false })
  })
  it("an empty list releases every one", () => {
    expect(planDeliveredChildren({ [DELIVERED_HELD_CHILDREN_OUTPUT_KEY]: [] }, held)).toEqual({ settle: [], release: ["a", "b"], listMissing: false })
  })
  it("no list: charged (the latest), never given away, and flagged", () => {
    expect(planDeliveredChildren({ videoUrl: "x" }, held)).toEqual({ settle: ["b"], release: ["a"], listMissing: true })
    expect(planDeliveredChildren(null, [held[0]!])).toEqual({ settle: ["a"], release: [], listMissing: true })
  })
})

describe("the rule's request and record", () => {
  it("storedDeferRule reads only the route's own value", () => {
    expect(storedDeferRule({ __deferSettlementRule: "delivered" })).toBe("delivered")
    expect(storedDeferRule({ __deferSettlementRule: "anything" })).toBeNull()
    expect(storedDeferRule({})).toBeNull()
    expect(storedDeferRule(null)).toBeNull()
  })
  it("the completion copies the rule into the record (and an engine take carries none)", async () => {
    fake.tables.usage_logs!.push({ id: "log-r", job_id: "j", status: "reserved", credits_used: 40, action: "topaz-video" })
    const upscale = await deferredCompletionFields({ usageLogId: "log-r", commit: { metered: false }, providerCost: null, workflowExecutionId: null, rule: "delivered" })
    expect((upscale.held_completion_fields as Record<string, Record<string, unknown>>).deferredSettlement).toMatchObject({ state: "held", open: true, rule: "delivered" })
    const take = await deferredCompletionFields({ usageLogId: "log-r", commit: { metered: false }, providerCost: null, workflowExecutionId: null })
    expect((take.held_completion_fields as Record<string, Record<string, unknown>>).deferredSettlement).not.toHaveProperty("rule")
  })
})

describe("the sweep decides a held upscale by what its run delivered", () => {
  it("delivered and listed, but the plugin's settle never landed (it crashed after the delivery): charged once", async () => {
    const p = parent("completed", 15 * MIN)
    const up = child(p, 20 * MIN, { upscale: true })
    fake.row("jobs", p)!.output_data = delivered(up)
    const r = await run()
    expect(r.settled).toBe(1)
    expect(logOf(up)).toBe("committed")
    expect(money.commitJobCredits).toHaveBeenCalledTimes(1)
    // A second sweep finds nothing open.
    await run()
    expect(money.commitJobCredits).toHaveBeenCalledTimes(1)
  })

  it("the run delivered the plain take (an empty list): released", async () => {
    const p = parent("completed", 15 * MIN, delivered())
    const up = child(p, 20 * MIN, { upscale: true })
    expect((await run()).released).toBe(1)
    expect(logOf(up)).toBe("refunded")
    expect(fake.row("jobs", up)).toMatchObject({ credits_actual: 0, billing_force_refund: true })
  })

  it("a completion with no list at all: charged, with an alert", async () => {
    const a = alerts()
    const p = parent("completed", 15 * MIN, { videoUrl: "https://x/v.mp4" })
    const up = child(p, 20 * MIN, { upscale: true })
    expect((await run()).settled).toBe(1)
    expect(logOf(up)).toBe("committed")
    expect(a.count()).toBe(1)
    a.restore()
  })

  it("two upscale children (an engine switch on re-entry): the listed one charged, the other released", async () => {
    const p = parent("completed", 15 * MIN)
    const first = child(p, 40 * MIN, { upscale: true })
    const second = child(p, 20 * MIN, { upscale: true })
    fake.row("jobs", p)!.output_data = delivered(first)
    await run()
    expect(logOf(first)).toBe("committed")
    expect(logOf(second)).toBe("refunded")
  })

  it("a record written before the rule was copied still reads the rule from its request", async () => {
    const p = parent("completed", 15 * MIN, delivered())
    const up = child(p, 20 * MIN, { upscale: true, ruleOnRecord: false })
    await run()
    expect(logOf(up)).toBe("refunded")
  })

  it.each([["failed"], ["cancelled"]])("its run %s: released", async (status) => {
    const p = parent(status, 15 * MIN)
    const up = child(p, 20 * MIN, { upscale: true })
    expect((await run()).released).toBe(1)
    expect(logOf(up)).toBe("refunded")
  })

  it("its run is gone: released", async () => {
    const up = child(id(), 20 * MIN, { upscale: true })
    await run()
    expect(logOf(up)).toBe("refunded")
  })

  it("its run still going 12 hours later: released; inside the grace period or a running run: nothing moves", async () => {
    const a = alerts()
    const long = child(parent("processing", null), 13 * 60 * MIN, { upscale: true })
    const running = child(parent("processing", null), 30 * MIN, { upscale: true })
    const fresh = child(parent("completed", 2 * MIN, delivered()), 3 * MIN, { upscale: true })
    await run()
    a.restore()
    expect(logOf(long)).toBe("refunded")
    expect(logOf(running)).toBe("reserved")
    expect(logOf(fresh)).toBe("reserved")
  })
})

describe("an upscale is never pooled with the run's engine takes", () => {
  it("engine take settled, upscale held and listed: the upscale is charged, not released as a 'discarded take'", async () => {
    const p = parent("completed", 15 * MIN)
    const take = child(p, 30 * MIN, { state: "settled", open: false, logStatus: "committed" })
    const up = child(p, 20 * MIN, { upscale: true })
    fake.row("jobs", p)!.output_data = delivered(up)
    await run()
    expect(logOf(take)).toBe("committed")
    expect(logOf(up)).toBe("committed")
  })

  it("engine take held, upscale skipped (not listed): the take is charged and the upscale released", async () => {
    const p = parent("completed", 15 * MIN, delivered())
    const take = child(p, 30 * MIN)
    const up = child(p, 20 * MIN, { upscale: true })
    const r = await run()
    expect(r).toMatchObject({ settled: 1, released: 1 })
    expect(logOf(take)).toBe("committed")
    expect(logOf(up)).toBe("refunded")
  })

  it("the engine plan raises no 'one take' alert for a run with one take and one upscale", async () => {
    const a = alerts()
    const p = parent("completed", 15 * MIN)
    child(p, 30 * MIN)
    const up = child(p, 20 * MIN, { upscale: true })
    fake.row("jobs", p)!.output_data = delivered(up)
    await run()
    expect(a.count()).toBe(0)
    a.restore()
  })
})

describe("the parent's own settle and release", () => {
  it("delivered: a settle charges once, a second settle answers the same and charges nothing more", async () => {
    const p = parent("completed", 0, delivered())
    const up = child(p, 1 * MIN, { upscale: true })
    expect(await resolveDeferredChild(up, "settled", { by: "plugin" })).toBe("settled")
    expect(await resolveDeferredChild(up, "settled", { by: "plugin" })).toBe("settled")
    expect(money.commitJobCredits).toHaveBeenCalledTimes(1)
    expect(logOf(up)).toBe("committed")
  })

  it("skipped: a release refunds once; a later settle answers already_decided and charges nothing", async () => {
    const p = parent("processing", null)
    const up = child(p, 1 * MIN, { upscale: true })
    expect(await resolveDeferredChild(up, "released", { reason: "output_wrong_size", by: "plugin" })).toBe("released")
    expect(await resolveDeferredChild(up, "released", { reason: "again", by: "plugin" })).toBe("released")
    expect(await resolveDeferredChild(up, "settled", { by: "plugin" })).toBe("already_decided")
    expect(money.refundCredits).toHaveBeenCalledTimes(1)
    expect(money.commitJobCredits).not.toHaveBeenCalled()
    expect(logOf(up)).toBe("refunded")
  })

  it("the wait ran out: a release of a child still running is scheduled, and its completion is never charged", async () => {
    const p = parent("processing", null)
    const up = child(p, 1 * MIN, { upscale: true })
    fake.row("jobs", up)!.status = "processing"
    expect(await resolveDeferredChild(up, "released", { reason: "child_timeout", by: "plugin" })).toBe("scheduled")
    expect((fake.row("jobs", up)!.input_data as Record<string, unknown>).__deferredRelease).toMatchObject({ reason: "child_timeout" })
    // It completes (finalize keeps it held) and the scheduled release is carried out.
    fake.row("jobs", up)!.status = "completed"
    expect(await resolveDeferredChild(up, "settled", { by: "plugin" })).toBe("already_decided")
    expect(logOf(up)).toBe("refunded")
    expect(money.commitJobCredits).not.toHaveBeenCalled()
  })

  it("the child failed: a release answers not_deferred (its own failure path refunds it) and moves nothing", async () => {
    const p = parent("processing", null)
    const up = child(p, 1 * MIN, { upscale: true })
    fake.row("jobs", up)!.status = "failed"
    expect(await resolveDeferredChild(up, "released", { reason: "child_failed", by: "plugin" })).toBe("not_deferred")
    expect(money.refundCredits).not.toHaveBeenCalled()
    expect(money.commitJobCredits).not.toHaveBeenCalled()
  })
})

describe("a delete of a completed run decides its held upscale as the sweep would", () => {
  it("listed: charged (deleting the delivered video never gives its upscale back)", async () => {
    const p = parent("completed", 1 * MIN)
    const up = child(p, 2 * MIN, { upscale: true })
    fake.row("jobs", p)!.output_data = delivered(up)
    await releaseHeldChildrenBeforeDelete({ jobId: p })
    expect(logOf(up)).toBe("committed")
  })

  it("not listed: released", async () => {
    const p = parent("completed", 1 * MIN, delivered())
    const up = child(p, 2 * MIN, { upscale: true })
    await releaseHeldChildrenBeforeDelete({ jobId: p })
    expect(logOf(up)).toBe("refunded")
  })

  it("a run still going: released, and an engine take beside it released as before", async () => {
    const p = parent("processing", null)
    const up = child(p, 2 * MIN, { upscale: true })
    const take = child(p, 3 * MIN)
    await releaseHeldChildrenBeforeDelete({ jobId: p })
    expect(logOf(up)).toBe("refunded")
    expect(logOf(take)).toBe("refunded")
  })
})

describe("a run parked for review", () => {
  it("is waited on past 12 hours (its approve completes it with its list); a refused review (failed) releases", async () => {
    const a = alerts()
    const review = parent("pending_review", null)
    const up = child(review, 14 * 60 * MIN, { upscale: true })
    const take = child(review, 14 * 60 * MIN)
    await run()
    expect(logOf(up)).toBe("reserved")
    // An engine take beside it keeps the rule of before (released for the wait).
    expect(logOf(take)).toBe("refunded")
    fake.row("jobs", review)!.status = "failed"
    fake.row("jobs", review)!.completed_at = ago(15 * MIN)
    await run()
    expect(logOf(up)).toBe("refunded")
    a.restore()
  })
})
