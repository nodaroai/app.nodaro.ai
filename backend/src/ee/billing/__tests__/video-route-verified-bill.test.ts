// @test-units-by-name it names only Seedance price ids and video job types, never a node unit
/**
 * From the route's done answer to the charge, through the REAL ledger module
 * (lib/video-route-ledger.ts) over an in-memory table:
 *  - a bill the route computed from the seconds it billed (`costBasis:
 *    "billed-seconds"`) is a verified bill — the run settles, and the basis is
 *    kept on the task row;
 *  - a money receipt settles the same way;
 *  - an estimate (`estimatedCostUsd`) is recorded and can NEVER reach the
 *    settle: with no bill reported the run is pending, whatever the estimate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ db: null as null | import("./helpers/fake-tables.js").FakeTables }))
vi.mock("@/lib/runtime-env.js", () => ({ getRuntimeEnv: () => "production" }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => h.db!.client.from(t) } }))
const { createFakeTables } = await import("./helpers/fake-tables.js")
const ledgerRows = () => h.db!.rows("video_route_ledger")

const { billedAtOf, deliveredTask, markRouteTaskOwnLoss, readRouteLedger, recordRouteStart, recordRouteTask, recordRouteTaskOutcome, routeCostBasisOf } = await import("../../../lib/video-route-ledger.js")
const { routedChargeOf } = await import("../video-route-settlement.js")
const { videoRouteStamp, videoRouteStampOf, VIDEO_ROUTE_STAMP_KEY } = await import("../../../lib/video-route-decision.js")
const { CREDIT_BASE_USD } = await import("@nodaro/shared/models")
import type { PluginAlternateRoutePoll } from "../../../lib/private-plugins/types.js"

type Done = Extract<PluginAlternateRoutePoll, { state: "done" }>
const JOB = "job-1"
const stamp = videoRouteStampOf({ [VIDEO_ROUTE_STAMP_KEY]: videoRouteStamp(JOB, { route: "alternate", routeId: "r1", service: "image-to-video" }, { model: "seedance-2-5", priceId: "seedance-2-5:8s:720p", requestKey: "rk", quotedUsd: CREDIT_BASE_USD * 100, quotedSec: 8, factor: 1, factorKey: "seedance-2-5:720p:noref:generate" }) }, JOB)!
const log = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: JOB }
const settings = { cost_markup_percent: 0, service_margin_percent: {} } as never

/** What the run does with a done answer (lib/alternate-route.ts), then what the settlement makes of the ledger. */
async function chargeOf(done: Done) {
  await recordRouteTask(JOB, 1, "task", done.providerCostUsd ?? null, "", done.estimatedCostUsd, routeCostBasisOf(done))
  return routedChargeOf(stamp, log, await readRouteLedger(JOB), settings)
}

beforeEach(() => { h.db = createFakeTables() })

describe("the verified bill, from the route's answer to the charge", () => {
  it("billed seconds at the agreed rate settle, and the basis is kept on the task row", async () => {
    const charge = await chargeOf({ state: "done", resultUrl: "https://r/clip.mp4", providerCostUsd: CREDIT_BASE_USD * 80, costBasis: "billed-seconds", billedSec: 8 })
    expect(charge).toMatchObject({ kind: "billed", chargedCredits: 80 })
    expect(ledgerRows()[0]).toMatchObject({ kind: "task", billed_usd: CREDIT_BASE_USD * 80, cost_basis: "billed-seconds" })
  })

  it("a money receipt settles the same way (also from a route that predates the basis field)", async () => {
    expect(await chargeOf({ state: "done", resultUrl: "https://r/clip.mp4", providerCostUsd: CREDIT_BASE_USD * 80, costBasis: "receipt" })).toMatchObject({ kind: "billed", chargedCredits: 80 })
    expect(ledgerRows()[0]).toMatchObject({ cost_basis: "receipt" })
    h.db = createFakeTables()
    expect(await chargeOf({ state: "done", resultUrl: "https://r/clip.mp4", providerCostUsd: CREDIT_BASE_USD * 80 })).toMatchObject({ kind: "billed", chargedCredits: 80 })
    expect(ledgerRows()[0]).toMatchObject({ cost_basis: "receipt" })
  })

  it("an estimate never reaches the settle: with no bill reported the run is pending", async () => {
    const charge = await chargeOf({ state: "done", resultUrl: "https://r/clip.mp4", estimatedCostUsd: CREDIT_BASE_USD * 80 })
    expect(charge.kind).toBe("pending")
    // Recorded for the record, with no bill and no basis.
    expect(ledgerRows()[0]).toMatchObject({ billed_usd: null, estimated_usd: CREDIT_BASE_USD * 80 })
    expect(ledgerRows()[0]).not.toHaveProperty("cost_basis")
    // What the settlement reads carries no trace of it.
    expect((await readRouteLedger(JOB)).tasks).toEqual([{ send: 1, ref: "task", outcome: null, billedUsd: null }])
  })

  it("a bill of zero is no bill: the run is pending, never free", async () => {
    const charge = await chargeOf({ state: "done", resultUrl: "https://r/clip.mp4", providerCostUsd: 0, costBasis: "billed-seconds", billedSec: 0 })
    expect(charge.kind).toBe("pending")
    expect(ledgerRows()[0]).toMatchObject({ billed_usd: null })
  })

  it("a bill reported later replaces the pending state; the estimate beside it changes nothing", async () => {
    await chargeOf({ state: "done", resultUrl: "https://r/clip.mp4", estimatedCostUsd: CREDIT_BASE_USD * 999 })
    const charge = await chargeOf({ state: "done", resultUrl: "https://r/clip.mp4", providerCostUsd: CREDIT_BASE_USD * 80, costBasis: "billed-seconds", billedSec: 8, estimatedCostUsd: CREDIT_BASE_USD * 999 })
    expect(charge).toMatchObject({ kind: "billed", chargedCredits: 80 })
  })
})

describe("sends that did not simply deliver", () => {
  const bill = (credits: number): Done => ({ state: "done", resultUrl: "https://r/clip.mp4", providerCostUsd: CREDIT_BASE_USD * credits, costBasis: "billed-seconds", billedSec: 8 })
  const charge = async () => routedChargeOf(stamp, log, await readRouteLedger(JOB), settings)

  it("a send that started and was never read to an end blocks the settlement: it may have been billed", async () => {
    expect(await recordRouteStart(JOB, 1)).toBe("recorded")
    expect(await recordRouteStart(JOB, 2)).toBe("recorded")
    await recordRouteTask(JOB, 2, "t2", CREDIT_BASE_USD * 80, "", undefined, "billed-seconds")
    expect((await readRouteLedger(JOB)).unresolvedStarts).toEqual([{ send: 1, key: "", ref: null }])
    expect(await charge()).toMatchObject({ kind: "pending", cause: "unbilled" })
  })

  it("a send the route ended with no result is not charged and does not block: the delivered one settles alone", async () => {
    await recordRouteStart(JOB, 1)
    await recordRouteStart(JOB, 2)
    expect(await recordRouteTaskOutcome(JOB, 1, "", "t1", "failed")).toBe(true)
    await recordRouteTask(JOB, 2, "t2", CREDIT_BASE_USD * 80, "", undefined, "billed-seconds")
    expect((await readRouteLedger(JOB)).unresolvedStarts).toEqual([])
    expect(await charge()).toMatchObject({ kind: "billed", chargedCredits: 80, taskCount: 1 })
  })

  it("a send given up on as unresolved is kept on the ledger, never charged, and no longer blocks", async () => {
    await recordRouteStart(JOB, 1)
    await recordRouteStart(JOB, 2)
    await recordRouteTask(JOB, 2, "t2", CREDIT_BASE_USD * 80, "", undefined, "receipt")
    await recordRouteTaskOutcome(JOB, 1, "", null, "unresolved")
    expect(ledgerRows().filter((r) => r.kind === "task" && r.outcome === "unresolved")).toHaveLength(1)
    expect(await charge()).toMatchObject({ kind: "billed", chargedCredits: 80, taskCount: 1 })
  })

  it("an outcome never replaces a bill: a delivered, billed send stays delivered", async () => {
    await recordRouteStart(JOB, 1)
    await recordRouteTask(JOB, 1, "t1", CREDIT_BASE_USD * 80, "", undefined, "receipt")
    expect(await recordRouteTaskOutcome(JOB, 1, "", "t1", "failed")).toBe(false)
    expect(await charge()).toMatchObject({ kind: "billed", chargedCredits: 80 })
  })

  it.each(["failed", "expired", "unresolved"] as const)("a delivered send with no bill yet stays delivered when it is later reported %s: no outcome is written over it", async (outcome) => {
    await recordRouteStart(JOB, 1)
    await recordRouteTask(JOB, 1, "t1", null)
    expect(await recordRouteTaskOutcome(JOB, 1, "", "t1", outcome)).toBe(false)
    const task = ledgerRows().find((r) => r.kind === "task")!
    expect(task.outcome ?? null).toBeNull()
    expect((await readRouteLedger(JOB)).tasks.map(deliveredTask)).toEqual([true])
    // Still a delivered send waiting for its bill, never "nothing delivered".
    expect(await charge()).toMatchObject({ kind: "pending", cause: "unbilled" })
    // And its bill, when it comes, settles it.
    await recordRouteTask(JOB, 1, "t1", CREDIT_BASE_USD * 80, "", undefined, "receipt")
    expect(await charge()).toMatchObject({ kind: "billed", chargedCredits: 80 })
  })

  it("an outcome is rewritten only over a send already recorded as not delivered", async () => {
    await recordRouteStart(JOB, 1)
    expect(await recordRouteTaskOutcome(JOB, 1, "", "t1", "unresolved")).toBe(true)
    // Read to its end afterwards: how it ended replaces "unresolved".
    expect(await recordRouteTaskOutcome(JOB, 1, "", "t1", "expired")).toBe(true)
    expect(ledgerRows().find((r) => r.kind === "task")).toMatchObject({ outcome: "expired", billed_usd: null })
    expect(await charge()).toMatchObject({ kind: "pending", cause: "nothing-delivered" })
  })

  it("a start given up on whose bill arrives STAYS given up: its bill is recorded (when it arrived), it is never charged", async () => {
    await recordRouteStart(JOB, 1)
    await recordRouteStart(JOB, 2)
    await recordRouteTaskOutcome(JOB, 1, "", "t1", "unresolved")
    await recordRouteTaskOutcome(JOB, 2, "", "t2", "failed")
    await recordRouteTask(JOB, 1, "t1", CREDIT_BASE_USD * 70, "", undefined, "receipt")
    // The bill is on the ledger, stamped with when it was recorded; the outcome is untouched.
    const given = ledgerRows().find((r) => r.kind === "task" && r.send === 1)!
    expect(given).toMatchObject({ outcome: "unresolved", billed_usd: CREDIT_BASE_USD * 70, cost_basis: "receipt" })
    expect(billedAtOf(given.detail)).toEqual(expect.any(String))
    expect(ledgerRows().filter((r) => r.kind === "task").map((r) => r.outcome)).toEqual(["unresolved", "failed"])
    // Never part of a charge.
    expect(await charge()).toMatchObject({ kind: "pending", cause: "nothing-delivered" })
    expect((await readRouteLedger(JOB)).tasks.filter(deliveredTask)).toEqual([])
  })

  it("a bill is stamped with when it was first recorded: on a row written without one, and never moved by a later write", async () => {
    await recordRouteTask(JOB, 1, "t1", null)
    expect(billedAtOf(ledgerRows()[0]!.detail)).toBeUndefined()
    await recordRouteTask(JOB, 1, "t1", CREDIT_BASE_USD * 40, "", undefined, "receipt")
    const first = billedAtOf(ledgerRows()[0]!.detail)
    expect(first).toEqual(expect.any(String))
    await markRouteTaskOwnLoss(JOB, 1)
    await recordRouteTask(JOB, 1, "t1", CREDIT_BASE_USD * 41, "", undefined, "receipt")
    // The latest figure, the first time, and the own-loss mark beside it (merged, never replaced).
    expect(ledgerRows()[0]).toMatchObject({ billed_usd: CREDIT_BASE_USD * 41, detail: { billedAt: first, ownLoss: true } })
    // A row written with its bill carries none: its `created_at` is when.
    await recordRouteTask(JOB, 2, "t2", CREDIT_BASE_USD * 40, "", undefined, "receipt")
    expect(billedAtOf(ledgerRows().find((r) => r.send === 2)!.detail)).toBeUndefined()
  })

  it("an earlier delivered send is listed as our loss whether or not its bill has come, and its mark says when it could not be written", async () => {
    // No task row of that send: nothing was marked, and the caller is told.
    expect(await markRouteTaskOwnLoss(JOB, 1)).toBe(false)
    await recordRouteTask(JOB, 1, "t1", null)
    await recordRouteTask(JOB, 2, "t2", CREDIT_BASE_USD * 20, "", undefined, "receipt")
    await recordRouteTask(JOB, 3, "t3", CREDIT_BASE_USD * 80, "", undefined, "receipt")
    // Only the last delivered send is charged; every earlier one is listed, an unbilled one with no amount.
    expect(await charge()).toMatchObject({ kind: "billed", chargedCredits: 80, taskCount: 1, usedQuote: false, ownLoss: [{ send: 1, billedUsd: null }, { send: 2, billedUsd: CREDIT_BASE_USD * 20 }] })
    expect(await markRouteTaskOwnLoss(JOB, 1)).toBe(true)
    expect((await readRouteLedger(JOB)).tasks.map((t) => t.ownLoss === true)).toEqual([true, false, false])
  })

  it("an unbilled send is charged at its quote only on an admin's decision, and never before", async () => {
    await chargeOf({ state: "done", resultUrl: "https://r/clip.mp4" })
    expect(await charge()).toMatchObject({ kind: "pending", cause: "unbilled" })
    h.db!.tables.video_route_ledger!.push({ id: 1, job_id: JOB, env: "production", kind: "settle", send: 1, key: "", state: "retry", decision: "quote" })
    // The quote the run was held at: 100 credits.
    expect(await charge()).toMatchObject({ kind: "billed", chargedCredits: 100, taskCount: 1 })
    void bill
  })
})
