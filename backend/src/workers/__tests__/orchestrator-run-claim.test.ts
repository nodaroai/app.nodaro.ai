// @test-reads-none an in-memory database double; reads no repo file
/**
 * A run's claim (`running`) is a compare-and-set — REAL orchestrator path.
 *
 * The worker reads the execution row, then spends a while loading and sizing
 * the graph before it claims the row. In between, another write can end the
 * run: the concurrency lanes' queued sweep failing a run that waited past its
 * queue timeout (it already emitted `execution:failed` and settled a use-case
 * wrapper), or a user's Cancel. The claim used to overwrite either with
 * `running` and execute every node — a run the user saw fail (or stopped)
 * then ran and charged. Now a claim that matches no row runs nothing.
 *
 * The execution row lives in a filtering in-memory database (fake-sweep-db),
 * so the claim's own filter decides; the other write lands from the
 * reconcile mock, which runs between the row read and the claim.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"
import { makeSweepDb, type SweepDb } from "../../lib/concurrency-lanes/__tests__/fake-sweep-db.js"

const h = vi.hoisted(() => ({
  db: null as unknown as { client: { from(t: string): unknown } },
  /** The write that lands between the row read and the claim (a sweep's failure, a Cancel). */
  between: null as null | (() => void),
  /** The in-flight children a re-pick finds and adopts (`cancelInFlightChildJobs`), by node. */
  adoptable: new Map<string, { jobId: string }>(),
  /** Whether the executor adopts an adoptable job (node-executor deletes the entry and polls it). */
  consumesAdoption: true,
  /** A workflow_executions update that answers a database error instead of being applied. */
  failUpdate: null as null | ((patch: Record<string, unknown>) => boolean),
  // An adopted job is polled to its end, as node-executor does: its entry is taken, its credits charged.
  executeNode: vi.fn(async (node: { id: string }, ..._rest: unknown[]) => {
    const ctx = _rest[4] as { adoptableJobs?: Map<string, unknown> }
    if (h.consumesAdoption && ctx.adoptableJobs?.has(node.id)) {
      ctx.adoptableJobs.delete(node.id)
      return { output: { text: `adopted-${node.id}` }, creditsUsed: 7 }
    }
    return { output: { text: `out-${node.id}` }, creditsUsed: 0 }
  }),
  events: [] as Array<{ type: string }>,
}))

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", ORCHESTRATOR_CONCURRENCY: 2, MAX_CONCURRENT_NODES_PER_EXECUTION: 12 },
  hasCredits: () => false,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (t: string) => {
      const q = h.db.client.from(t) as { update(patch: Record<string, unknown>): unknown }
      const update = q.update.bind(q)
      q.update = (patch) => {
        if (t !== "workflow_executions" || !h.failUpdate?.(patch)) return update(patch)
        // A chain that answers a database error wherever it is awaited.
        const failed = { data: null, error: { message: "connection reset" } }
        const chain: unknown = new Proxy({}, {
          get: (_, k) => (k === "then" ? (resolve: (v: unknown) => void) => resolve(failed) : () => chain),
        })
        return chain
      }
      return q
    },
  },
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/services/workflow-engine/node-executor.js", () => ({
  executeNode: h.executeNode,
  loadCompletedFanOutIterations: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock("@/lib/reconcile/node-states.js", () => ({
  reconcileNodeStatesFromJobs: vi.fn(async (states: unknown) => {
    h.between?.()
    return { next: states, changed: false }
  }),
}))
vi.mock("@/lib/reconcile/cancel-inflight-jobs.js", () => ({
  cancelInFlightChildJobs: vi.fn(async () => ({ cancelled: 0, adoptable: new Map(h.adoptable) })),
}))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/execution-events.js", () => ({
  executionEvents: { emit: (_id: string, event: { type: string }) => { h.events.push(event) } },
}))

const { processWorkflowExecution } = await import("../orchestrator-worker.js")

const EXEC = "00000000-0000-4000-8000-0000000000e1"
let db: SweepDb

function job(): Job<WorkflowExecutionJob> {
  return { data: { executionId: EXEC, workflowId: "wf-1", userId: "owner-1", triggerType: "manual" } } as unknown as Job<WorkflowExecutionJob>
}

const execRow = () => db.row("workflow_executions", EXEC)!
/** Writes that moved the row to `running` (a compare-and-set that matched nothing is recorded with no ids). */
const runningWrites = () => db.writes.filter((w) => w.table === "workflow_executions" && w.ids.length > 0 && w.patch?.status === "running")

beforeEach(() => {
  db = makeSweepDb()
  h.db = db
  h.between = null
  h.adoptable = new Map()
  h.consumesAdoption = true
  h.failUpdate = null
  h.events.length = 0
  h.executeNode.mockClear()
  db.rows("workflows").push({
    id: "wf-1",
    user_id: "owner-1",
    nodes: [
      { id: "t1", type: "text-prompt", data: { label: "Prompt", text: "a cat" } },
      { id: "ai", type: "llm-chat", data: { label: "Chat", prompt: "{Prompt}" } },
    ],
    edges: [{ id: "e1", source: "t1", target: "ai", sourceHandle: "text", targetHandle: "prompt" }],
    settings: {},
  })
  db.rows("profiles").push({ id: "owner-1", tier: "pro", prompt_templates: null })
  db.rows("workflow_executions").push({ id: EXEC, user_id: "owner-1", workflow_id: "wf-1", status: "pending", node_states: {} })
  vi.spyOn(console, "log").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

describe("a run's claim is a compare-and-set", () => {
  it("control: a run nothing ended is claimed and runs", async () => {
    await processWorkflowExecution(job())
    expect(runningWrites()).toHaveLength(1)
    expect(h.executeNode).toHaveBeenCalled()
    expect(h.events.map((e) => e.type)).toContain("execution:started")
  })

  it("a run the sweep failed between the worker's row read and its claim does not run", async () => {
    h.between = () => {
      Object.assign(execRow(), { status: "failed", error_message: "Timed out waiting for a free slot", completed_at: new Date().toISOString() })
    }
    await processWorkflowExecution(job())
    expect(execRow().status).toBe("failed")
    expect(execRow().error_message).toBe("Timed out waiting for a free slot")
    expect(h.executeNode).not.toHaveBeenCalled()
    expect(h.events.map((e) => e.type)).not.toContain("execution:started")
    // The claim was asked and matched nothing: no write moved the row.
    expect(db.writes.filter((w) => w.table === "workflow_executions" && w.ids.length > 0)).toEqual([])
  })

  it("a run the user cancelled between the worker's row read and its claim does not run", async () => {
    h.between = () => {
      Object.assign(execRow(), { status: "cancelled", completed_at: new Date().toISOString() })
    }
    await processWorkflowExecution(job())
    expect(execRow().status).toBe("cancelled")
    expect(h.executeNode).not.toHaveBeenCalled()
    expect(h.events.map((e) => e.type)).not.toContain("execution:started")
  })

  it("a run whose row was deleted before its claim does not run", async () => {
    h.between = () => {
      db.rows("workflow_executions").length = 0
    }
    await processWorkflowExecution(job())
    expect(h.executeNode).not.toHaveBeenCalled()
    expect(h.events.map((e) => e.type)).not.toContain("execution:started")
  })

  it("a re-picked `running` run is claimed again and resumes", async () => {
    // A run re-picked before any node finished (a drain, a stall): nothing carried forward.
    Object.assign(execRow(), { status: "running", node_states: {} })
    await processWorkflowExecution(job())
    expect(runningWrites()).toHaveLength(1)
    expect(h.executeNode).toHaveBeenCalled()
    expect(execRow().status).toBe("completed")
  })
})

describe("a Stop pressed before the run's claim is kept", () => {
  /** The claim's own write: it stamps `started_at`, with or without a status. */
  const claimWrites = () =>
    db.writes.filter((w) => w.table === "workflow_executions" && w.ids.length > 0 && w.patch?.started_at !== undefined)

  /** The settled run: claimed, nothing dispatched, ended `cancelled` through the level-boundary stop. */
  function expectSettledByTheStop(): void {
    expect(h.executeNode).not.toHaveBeenCalled()
    expect(runningWrites()).toEqual([])
    expect(claimWrites()).toHaveLength(1)
    expect(claimWrites()[0]!.patch).not.toHaveProperty("status")
    expect(execRow()).toMatchObject({ status: "cancelled", started_at: expect.any(String), completed_at: expect.any(String) })
    expect(execRow().total_nodes).toBe(1)
    expect(h.events.map((e) => e.type)).toContain("execution:cancelled")
    expect(h.events.map((e) => e.type)).not.toContain("execution:completed")
  }

  it("Stop after current, pressed while the run waited to be claimed: no node runs and it ends cancelled", async () => {
    // The route's write for a `pending` row: `stopping`, stamped with its environment.
    h.between = () => {
      Object.assign(execRow(), { status: "stopping", runtime_env: "production" })
    }
    await processWorkflowExecution(job())
    expectSettledByTheStop()
  })

  it("a run already `stopping` when the worker picks it up (a re-pick) is claimed and settles", async () => {
    Object.assign(execRow(), { status: "stopping", node_states: {} })
    await processWorkflowExecution(job())
    expectSettledByTheStop()
  })

  it("a run ended before its claim stays unclaimed when the `stopping` claim meets a database error", async () => {
    h.between = () => {
      Object.assign(execRow(), { status: "timed_out", completed_at: new Date().toISOString() })
    }
    // The second claim (from `stopping`, no status of its own) answers an error, not a miss.
    h.failUpdate = (patch) => patch.started_at !== undefined && patch.status === undefined
    await processWorkflowExecution(job())
    expect(execRow().status).toBe("timed_out")
    expect(h.executeNode).not.toHaveBeenCalled()
    expect(h.events.map((e) => e.type)).not.toContain("execution:started")
  })

  it("a re-picked `stopping` run finishes the child it adopted, runs nothing else, and ends cancelled", async () => {
    // Two nodes on the level that was in flight (only one had a job), and one after it.
    const wf = db.rows("workflows")[0]!
    wf.nodes = [
      { id: "t1", type: "text-prompt", data: { label: "Prompt", text: "a cat" } },
      { id: "a1", type: "llm-chat", data: { label: "A1", prompt: "{Prompt}" } },
      { id: "a2", type: "llm-chat", data: { label: "A2", prompt: "{Prompt}" } },
      { id: "a3", type: "llm-chat", data: { label: "A3", prompt: "{A1}" } },
    ]
    wf.edges = [
      { id: "e1", source: "t1", target: "a1", sourceHandle: "text", targetHandle: "prompt" },
      { id: "e2", source: "t1", target: "a2", sourceHandle: "text", targetHandle: "prompt" },
      { id: "e3", source: "a1", target: "a3", sourceHandle: "text", targetHandle: "prompt" },
    ]
    Object.assign(execRow(), { status: "stopping", started_at: new Date(Date.now() - 60_000).toISOString(), node_states: { a1: { status: "running", jobId: "job-a1" } } })
    h.adoptable = new Map([["a1", { jobId: "job-a1" }]])
    await processWorkflowExecution(job())
    expect(h.executeNode.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(["a1"])
    expect(runningWrites()).toEqual([])
    const states = execRow().node_states as Record<string, { status: string; creditsUsed?: number; output?: unknown }>
    expect(states.a1).toMatchObject({ status: "completed", creditsUsed: 7 })
    expect(states.a2?.status).not.toBe("completed")
    expect(states.a3?.status).not.toBe("completed")
    expect(execRow()).toMatchObject({ status: "cancelled", total_credits_used: 7, completed_at: expect.any(String) })
    expect(h.events.map((e) => e.type)).toContain("execution:cancelled")
    expect(h.events.map((e) => e.type)).not.toContain("execution:completed")
  })

  it("a re-picked `stopping` run whose adopted child no node takes still ends cancelled, never completed", async () => {
    Object.assign(execRow(), { status: "stopping", node_states: {} })
    h.adoptable = new Map([["ai", { jobId: "job-ai" }]])
    h.consumesAdoption = false
    await processWorkflowExecution(job())
    expect(execRow().status).toBe("cancelled")
    expect(h.events.map((e) => e.type)).not.toContain("execution:completed")
  })

  it("a run the user cancelled after its Stop, before its claim, is not claimed", async () => {
    h.between = () => {
      Object.assign(execRow(), { status: "cancelled", completed_at: new Date().toISOString() })
    }
    Object.assign(execRow(), { status: "stopping" })
    await processWorkflowExecution(job())
    expect(h.executeNode).not.toHaveBeenCalled()
    expect(claimWrites()).toEqual([])
    expect(h.events.map((e) => e.type)).not.toContain("execution:started")
  })
})
