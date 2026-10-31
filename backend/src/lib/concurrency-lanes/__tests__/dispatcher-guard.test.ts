// The deadlock invariant, held as a totality guard (decided 2026-10-30): a job
// that dispatches others never holds a slot its children need.
//   - A coordinator-class job — every one the registry names, and a plugin job
//     type that declared nothing — never acquires a leaf slot at pickup: a
//     top-level one takes a `run` slot, a nested one (a child of a run, a
//     pipeline or another job) takes none.
//   - Code already holding a leaf slot never acquires again: neither a call it
//     makes (withConcurrencySlot) nor a funnel it passes through
//     (ensureConcurrencySlot), on any lane.
// On the gate's JS twin, with lanes enforced (so an acquire is a real verdict).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate } from "../gate.js"
import { LEAF_LANES } from "../leaf-lanes.js"
import type { LaneQueueName, LaneSizes } from "../types.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "./fake-lane-redis.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 2, llm: 2, local: 2, run: 50 } as LaneSizes,
}))
vi.mock("../instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../sizes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sizes.js")>()),
  laneSizesFor: async () => refs.sizes,
  laneSettings: async () => ({ queueTimeoutMs: 60_000, liveWaitLimitMs: 600_000 }),
}))
vi.mock("../provider-of.js", () => ({ primaryProviderOfJob: () => "kie" }))
vi.mock("../wake-subscriber.js", () => ({ startLaneWakeSubscriber: () => () => undefined }))

const { admitWorkerJob, resetWorkerAdmitHooksForTests } = await import("../worker-admit.js")
const { JOB_LANE_CLASSES, laneClassOf, notePluginJobTypes } = await import("../registry.js")
const { runHolding } = await import("../hold.js")
const { withConcurrencySlot, ensureConcurrencySlot, resetConcurrencySlotsForTests } = await import("../slot.js")
const { resetServerShareForTests } = await import("../server-share.js")
type WorkerRow = import("../worker-admit.js").WorkerRow
type ConcurrencyHold = import("../hold.js").ConcurrencyHold

/** A plugin job type the loader merged a handler for, with no lane declaration. */
const UNDECLARED_PLUGIN_TYPE = "dispatcher-guard-undeclared-plugin-type"

/** Every coordinator-class job a worker can receive: the registry's, an undeclared plugin type, and a name nobody knows. */
function coordinatorJobs(): Array<{ queue: LaneQueueName; name: string }> {
  const out = Object.entries(JOB_LANE_CLASSES)
    .filter(([, cls]) => cls.kind === "coordinator")
    .map(([key]) => {
      const at = key.indexOf(":")
      return { queue: key.slice(0, at) as LaneQueueName, name: key.slice(at + 1) }
    })
  out.push({ queue: "video-generation", name: UNDECLARED_PLUGIN_TYPE }, { queue: "video-generation", name: "a-job-nobody-registered" })
  return out
}

const row = (id: string, over: Partial<WorkerRow> = {}): WorkerRow => ({
  id, user_id: "U", status: "pending", started_at: null, parent_job_id: null, workflow_execution_id: null,
  pipeline_id: null, workspace_id: null, org_id: null, source: "api", source_detail: null, mcp_client: null, ...over,
})

let gate: ConcurrencyGate

beforeEach(async () => {
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(makeFakeLaneStore()) })
  refs.gate = gate
  await gate.setEnforced(true)
  notePluginJobTypes([UNDECLARED_PLUGIN_TYPE])
  resetWorkerAdmitHooksForTests()
  resetServerShareForTests()
  resetConcurrencySlotsForTests()
})
afterEach(() => vi.restoreAllMocks())

describe("pickup", () => {
  it("the guard covers every coordinator the registry names, plus undeclared and unknown job types", () => {
    const jobs = coordinatorJobs()
    expect(jobs.length).toBeGreaterThan(5)
    for (const { queue, name } of jobs) expect(laneClassOf(queue, name, {}), `${queue}:${name}`).toEqual({ kind: "coordinator" })
  })

  it("a coordinator-class job never acquires a leaf slot at pickup", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const borrow = vi.spyOn(gate, "borrow")
    let n = 0
    for (const { queue, name } of coordinatorJobs()) {
      const shapes: Array<[string, Partial<WorkerRow>, "run" | null]> = [
        ["top-level", {}, "run"],
        ["in a workflow run", { workflow_execution_id: "exec-1" }, null],
        ["a child of a job", { parent_job_id: "parent-1" }, null],
        ["a pipeline stage", { pipeline_id: "pipe-1" }, null],
      ]
      for (const [shape, over, lane] of shapes) {
        acquire.mockClear()
        const id = `job-${++n}`
        const admission = await admitWorkerJob({ job: { id: `bull-${id}`, name, data: { jobId: id, userId: "U" } }, queue, row: row(id, over) })
        const what = `${queue}:${name} (${shape})`
        expect(admission.admitted, what).toBe(true)
        expect(acquire.mock.calls.map(([r]) => r.meta.lane), what).toEqual(lane ? [lane] : [])
        expect(admission.hold.role, what).toBe(lane ? "run" : "coordinator")
        if (admission.admitted) await admission.release("completed")
      }
    }
    // A coordinator child keeps its coordinator hold: it never runs on its parent's slot.
    expect(borrow).not.toHaveBeenCalled()
    // Nothing was ever counted in a leaf lane.
    for (const line of (await gate.snapshot()).lines) {
      for (const lane of LEAF_LANES) expect(line.lanes[lane]).toMatchObject({ running: 0, queued: 0 })
    }
  })
})

describe("calls", () => {
  const leafHold = (lane: (typeof LEAF_LANES)[number]): ConcurrencyHold =>
    ({ role: "leaf", lane, userId: "U", payer: "user:U", tier: null, jobId: "job-1", leaseId: "lease-1" })

  it("a call under a leaf hold never acquires, on any lane, by either form", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    for (const held of LEAF_LANES) {
      for (const lane of LEAF_LANES) {
        const ran = await runHolding(leafHold(held), async () => {
          await ensureConcurrencySlot({ lane, provider: "kie", jobType: "x" })
          return withConcurrencySlot({ lane, provider: "kie", jobType: "x" }, async () => "ran")
        })
        expect(ran, `${lane} under a ${held} hold`).toBe("ran")
      }
    }
    expect(acquire).not.toHaveBeenCalled()
  })

  it("a coordinator's call takes exactly one slot, and nothing under that call takes another", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const coordinator: ConcurrencyHold = { role: "coordinator", lane: null, userId: "U", payer: "user:U", tier: null, jobId: "job-1", leaseId: null }
    await runHolding(coordinator, () =>
      withConcurrencySlot({ lane: "provider", provider: "kie", jobType: "x" }, async () => {
        // Under the call's own leaf hold: the funnels and any nested call pass through.
        await ensureConcurrencySlot({ lane: "provider", provider: "kie", jobType: "x" })
        await withConcurrencySlot({ lane: "llm", provider: "kie", jobType: "x" }, async () => undefined)
        await withConcurrencySlot({ lane: "provider", provider: "kie", jobType: "x" }, async () => undefined)
      }))
    expect(acquire.mock.calls.map(([r]) => [r.meta.lane, r.mode])).toEqual([["provider", "front"]])
    // Released when the call ended: nothing of the user's is left running.
    expect((await gate.snapshot()).lines.every((l) => l.lanes.provider.running === 0)).toBe(true)
  })
})
