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
  executeNode: vi.fn(async (node: { id: string }) => ({ output: { text: `out-${node.id}` }, creditsUsed: 0 })),
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
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => h.db.client.from(t) } }))
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
  cancelInFlightChildJobs: vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() }),
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
const runningWrites = () => db.writes.filter((w) => w.table === "workflow_executions" && w.patch?.status === "running")

beforeEach(() => {
  db = makeSweepDb()
  h.db = db
  h.between = null
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

  it("a re-picked run (`running`, or `stopping`) is claimed again and resumes", async () => {
    for (const status of ["running", "stopping"]) {
      // A run re-picked before any node finished (a drain, a stall): nothing carried forward.
      Object.assign(execRow(), { status, node_states: {} })
      h.executeNode.mockClear()
      await processWorkflowExecution(job())
      expect(h.executeNode).toHaveBeenCalled()
    }
  })
})
