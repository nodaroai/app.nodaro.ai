// @test-watches backend/src/**/*.ts
/**
 * Concurrency lanes: an orchestrator re-picked mid-run (a deploy drain, a stall)
 * finds child jobs still WAITING for a slot (`queued`). Cancelling them would
 * refund them, send their nodes to the back of the line and re-dispatch them —
 * so the resume ADOPTS them (`cancelInFlightChildJobs(…, { adoptQueued: true })`):
 * each keeps its place in line and the time it has waited (decided 2026-10-30:
 * nothing fails for waiting). The paths that END a run (a blocked account, a
 * refused pick, a timed-out component, a stopped use-case node) are unchanged:
 * they cancel queued children and withdraw them from their lines.
 *
 * `cancelInFlightChildJobs` runs for real over an in-memory database that
 * applies its filters; the node executor's half (the adopted poll keeps its
 * wait off its clocks) is pinned in node-executor-lane-wait.test.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeFakeLaneDb, type FakeLaneDb } from "../../lib/concurrency-lanes/__tests__/fake-lane-db.js"

const h = vi.hoisted(() => ({
  db: null as unknown as { client: { from(t: string): unknown } },
  refunds: [] as string[],
  withdrawn: [] as string[],
}))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (t: string) => h.db.client.from(t) } }))
vi.mock("../../lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: async (id: string) => { h.refunds.push(id); return 1 } }))
vi.mock("../../lib/concurrency-lanes/withdraw.js", () => ({ withdrawFromLane: async (id: string) => { h.withdrawn.push(id) } }))
vi.mock("../../lib/llm-side-hold.js", () => ({ settleSideHoldsAfterFlip: async () => {} }))
vi.mock("../../lib/cancel-job.js", () => ({
  cancelOwnedJob: async () => ({ kind: "cancelled" }),
  settleMeteredHoldsBeforeCancel: async () => "not-metered",
  settleMeteredHoldAfterFlip: async () => "refund",
}))

const { cancelInFlightChildJobs } = await import("../../lib/reconcile/cancel-inflight-jobs.js")
const { resetLaneColumnsForTests } = await import("../../lib/concurrency-lanes/columns.js")

const MIN = 60_000
const RESUME = { adoptLiveBudgetedRenders: true, adoptQueued: true } as const

let db: FakeLaneDb

function job(id: string, over: Record<string, unknown>): Record<string, unknown> {
  const r = {
    id, user_id: "owner-1", workflow_execution_id: "exec-1", status: "queued", provider: "kie", provider_task_id: null,
    provider_kind: null, provider_call_started_at: null, created_at: new Date(Date.now() - 50 * MIN).toISOString(),
    started_at: null, usage_log_id: `log-${id}`, credits: 30, job_type: "generate-image", idempotency_key: null,
    reconcile_attempts: 0, reconcile_last_error: null, slot_wait_ms: 0, lane_queued_at: null,
    input_data: { node_id: `node-${id}`, type: "generate-image" }, ...over,
  }
  db.rows("jobs").push(r)
  return r
}
const status = (id: string) => db.rows("jobs").find((r) => r.id === id)?.status

beforeEach(() => {
  db = makeFakeLaneDb()
  h.db = db
  h.refunds.length = 0
  h.withdrawn.length = 0
  resetLaneColumnsForTests()
  vi.spyOn(console, "log").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

describe("the resume adopts children waiting for a concurrency slot", () => {
  it("a resumed run adopts its queued children instead of cancelling them", async () => {
    const queuedAt = Date.now() - 40 * MIN
    const createdAt = Date.now() - 45 * MIN
    job("j-wait", { lane_queued_at: new Date(queuedAt).toISOString(), created_at: new Date(createdAt).toISOString() })
    job("j-pre", { status: "pending" }) // control: today's resume cancels a never-started row

    const { cancelled, adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)

    const adopted = adoptable.get("node-j-wait")
    expect(adopted).toMatchObject({ jobId: "j-wait", usageLogId: "log-j-wait", creditsReserved: 30 })
    // Re-attached on its original dispatch, with the time it has waited credited from the first tick.
    expect(adopted?.clocks?.dispatchedAtMs).toBe(createdAt)
    expect(adopted?.clocks?.queuedMs).toBeGreaterThanOrEqual(40 * MIN)
    expect(adopted?.clocks?.queuedMs).toBeLessThan(41 * MIN)
    // Kept: its place in line, its reservation, its node.
    expect(status("j-wait")).toBe("queued")
    expect(h.withdrawn).toEqual([])
    expect(h.refunds).toEqual(["j-pre"])
    expect(cancelled).toBe(1)
    expect(status("j-pre")).toBe("cancelled")
  })

  it("a waiting fan-out iteration (or orphan) cannot be adopted: cancelled, refunded AND withdrawn from its line", async () => {
    job("j-item", { input_data: { node_id: "node-f", type: "generate-image", iterationIndex: 2 } })
    job("j-orphan", { input_data: { type: "generate-image" } })
    const { adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.size).toBe(0)
    expect([status("j-item"), status("j-orphan")]).toEqual(["cancelled", "cancelled"])
    // Left in its line it would stay at the head and block it.
    expect(h.withdrawn.sort()).toEqual(["j-item", "j-orphan"])
    expect(h.refunds.sort()).toEqual(["j-item", "j-orphan"])
  })

  it("first wins: a second waiting row of the same node is cancelled and withdrawn", async () => {
    job("j-a", { lane_queued_at: new Date(Date.now() - 10 * MIN).toISOString() })
    job("j-b", { input_data: { node_id: "node-j-a", type: "generate-image" } })
    const { adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.get("node-j-a")?.jobId).toBe("j-a")
    expect(status("j-b")).toBe("cancelled")
    expect(h.withdrawn).toEqual(["j-b"])
  })

  it("another user's waiting row naming this execution is neither adopted nor touched", async () => {
    job("j-foreign", { user_id: "intruder" })
    const { adoptable, cancelled } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.size).toBe(0)
    expect(cancelled).toBe(0)
    expect(status("j-foreign")).toBe("queued")
  })

  it("reads tolerate a missing lane_queued_at column: the child is still adopted, on fresh clocks", async () => {
    job("j-wait", {})
    db.missingColumns.add("jobs.lane_queued_at")
    const { adoptable } = await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(adoptable.get("node-j-wait")).toMatchObject({ jobId: "j-wait" })
    expect(adoptable.get("node-j-wait")?.clocks).toBeUndefined()
    expect(status("j-wait")).toBe("queued")
    // The main in-flight read never names a lane column.
    expect(db.selects.filter((s) => s.includes("status, input_data")).every((s) => !s.includes("lane_"))).toBe(true)
  })

  it("nothing waiting: no lane read at all", async () => {
    job("j-pre", { status: "pending" })
    await cancelInFlightChildJobs("exec-1", "owner-1", RESUME)
    expect(db.selects.filter((s) => s.includes("lane_queued_at"))).toEqual([])
  })
})

describe("every path that ends a run is unchanged", () => {
  it("without adoptQueued a resume never reads a waiting child (today's statuses)", async () => {
    job("j-wait", {})
    const { adoptable, cancelled } = await cancelInFlightChildJobs("exec-1", "owner-1", { adoptLiveBudgetedRenders: true })
    expect(adoptable.size).toBe(0)
    expect(cancelled).toBe(0)
    expect(status("j-wait")).toBe("queued")
  })

  it("a cancel that ends the run cancels waiting children and withdraws them", async () => {
    job("j-wait", { lane_queued_at: new Date(Date.now() - 5 * MIN).toISOString() })
    const { adoptable, cancelled } = await cancelInFlightChildJobs("exec-1", "owner-1")
    expect(adoptable.size).toBe(0)
    expect(cancelled).toBe(1)
    expect(status("j-wait")).toBe("cancelled")
    expect(h.withdrawn).toEqual(["j-wait"])
  })

  it("only the orchestrator's resume asks to adopt waiting children; every other caller ends the run", () => {
    // Every call site outside tests, by file: the resume is the one that adopts.
    const SRC = join(__dirname, "..", "..")
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== "__tests__" && name !== "node_modules") walk(p) }
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p)
      }
    }
    walk(SRC)
    const calls: Array<{ file: string; args: string }> = []
    for (const f of files) {
      const text = readFileSync(f, "utf8")
      for (const m of text.matchAll(/(?<!function )cancelInFlightChildJobs\(([^)]*)\)/g)) calls.push({ file: relative(SRC, f), args: m[1]! })
    }
    const adopting = calls.filter((c) => c.args.includes("adoptQueued"))
    expect(adopting).toEqual([
      { file: "workers/orchestrator-worker.ts", args: "executionId, userId, { adoptLiveBudgetedRenders: true, adoptQueued: true }" },
    ])
    // The others pass no options at all: they end the run, and take its waiting children with it.
    for (const c of calls.filter((x) => !x.args.includes("adoptQueued"))) expect(c.args.split(",").length).toBe(2)
    expect(calls.length).toBeGreaterThanOrEqual(5)
  })
})
