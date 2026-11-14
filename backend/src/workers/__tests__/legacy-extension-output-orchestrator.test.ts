// @test-units-by-name runs the node types it names (extend-video), a legacy node
/**
 * A server run reads an Extend Video node saved before outputs were recorded
 * apart as the database records it (lib/legacy-extension-output.ts) — REAL
 * orchestrator path, before any node's inputs are resolved: the node after it
 * is handed that node's own output, and the node itself runs on the task its
 * job extended. Only leaf I/O is mocked (the jobs lookup answers from a
 * fixture), so what is asserted is what each dispatched node was given.
 *
 * Harness mirrors trigger-run-scope-orchestrator.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const dispatched: Array<{ id: string; data: Record<string, unknown>; inputs: Record<string, unknown> }> = []
  const executeNode = vi.fn(async (node: { id: string; data: Record<string, unknown> }, inputs: Record<string, unknown>) => {
    dispatched.push({ id: node.id, data: node.data, inputs })
    return { output: { videoUrl: `https://cdn.example.com/${node.id}.mp4` }, creditsUsed: 0 }
  })
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })

  let workflowRow: Record<string, unknown> | null = null
  /** The run's jobs the legacy lookup reads, as PostgREST answers its select. */
  let legacyRows: Array<Record<string, unknown>> = []
  const legacyFilters: Array<[string, unknown[]]> = []
  const execSelectRow = { status: "queued", node_states: {} }

  function makeChain(table: string, columns?: string) {
    const result = (() => {
      if (table === "workflows") return { data: workflowRow, error: workflowRow ? null : { message: "nf" } }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
      return { data: null, error: null }
    })()
    const single = vi.fn().mockResolvedValue(result)
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eqInner = { single, maybeSingle, eq: vi.fn() }
    eqInner.eq = vi.fn().mockReturnValue(eqInner)
    const eq = vi.fn().mockReturnValue(eqInner)
    return {
      select: vi.fn().mockReturnValue({ eq, single, maybeSingle, is: vi.fn().mockReturnValue({ single, eq }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
    }
  }

  /** The legacy lookup's chain: every filter recorded, answered at `.limit()`. */
  function legacyChain() {
    const chain: Record<string, unknown> = {}
    for (const m of ["in", "eq", "is"]) {
      chain[m] = (...args: unknown[]) => {
        legacyFilters.push([m, args])
        return chain
      }
    }
    chain.limit = async () => ({ data: legacyRows, error: null })
    return chain
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) =>
      table === "jobs" && typeof columns === "string" && columns.includes("provider_task_id") ? legacyChain() : makeChain(table, columns).select(columns),
    update: () => makeChain(table).update(),
    insert: () => makeChain(table).insert(),
  }))

  return {
    executeNode,
    dispatched,
    updateExecutionWithRetry,
    from,
    legacyFilters,
    setWorkflowRow: (row: Record<string, unknown>) => {
      workflowRow = row
    },
    setLegacyRows: (rows: Array<Record<string, unknown>>) => {
      legacyRows = rows
    },
  }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    REDIS_URL: "redis://localhost:6379",
    ORCHESTRATOR_CONCURRENCY: 2,
    MAX_CONCURRENT_NODES_PER_EXECUTION: 12,
  },
  hasCredits: () => false,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/services/workflow-engine/node-executor.js", () => ({
  executeNode: mocks.executeNode,
  loadCompletedFanOutIterations: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("@/lib/reconcile/node-states.js", () => ({
  reconcileNodeStatesFromJobs: vi.fn(async (states: unknown) => ({ next: states, changed: false })),
}))

vi.mock("@/lib/reconcile/cancel-inflight-jobs.js", () => ({
  cancelInFlightChildJobs: vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() }),
}))

vi.mock("@/lib/execution-writes.js", () => ({
  updateExecutionWithRetry: mocks.updateExecutionWithRetry,
}))

vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import { processWorkflowExecution } from "../orchestrator-worker.js"

const USER = "owner-1"
const WORKFLOW = "wf-1"

/**
 * `x`: an MCP-built VEO extension (wired to nothing) whose `kieTaskId` an old
 * server run overwrote with its own output, `task-ext-own`; `y`: a VEO extend
 * wired after it.
 */
function makeJob(nodeIds?: string[]): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      { id: "x", type: "extend-video", data: { label: "Extend Video", provider: "veo-extend", prompt: "keep going", kieTaskId: "task-ext-own", generatedVideoUrl: "https://cdn.example.com/ext-old.mp4" } },
      { id: "y", type: "extend-video", data: { label: "Extend Video 2", provider: "veo-extend", prompt: "and more" } },
    ],
    edges: [{ id: "x->y", source: "x", target: "y", sourceHandle: "video", targetHandle: "video" }],
    settings: {},
    user_id: USER,
  })
  return {
    data: { executionId: "exec-1", workflowId: WORKFLOW, userId: USER, triggerType: "manual", ...(nodeIds ? { nodeIds } : {}) },
  } as unknown as Job<WorkflowExecutionJob>
}

/** x's own completed extension of this workflow's run: it extended `task-gen` and made `task-ext-own`. */
const OWN_EXTENSION = {
  user_id: USER, status: "completed", job_type: "extend-video", provider_task_id: "task-ext-own", deleted_at: null,
  node_id: "x", input_task: "task-gen", execution: { workflow_id: WORKFLOW },
}

const given = (id: string) => mocks.dispatched.find((d) => d.id === id)

describe("orchestrator — a legacy extension is read from the database before any input is resolved", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dispatched.length = 0
    mocks.legacyFilters.length = 0
    mocks.setLegacyRows([OWN_EXTENSION])
  })

  it("the node after it is handed the legacy node's own output (a run from that node: the legacy one is seeded, not run)", async () => {
    await processWorkflowExecution(makeJob(["y"]))
    expect(given("x")).toBeUndefined()
    expect(given("y")?.inputs.kieTaskId).toBe("task-ext-own")
    // Asked for the runner, in this workflow's runs.
    expect(mocks.legacyFilters).toEqual(expect.arrayContaining([
      ["eq", ["user_id", USER]],
      ["eq", ["execution.workflow_id", WORKFLOW]],
    ]))
  })

  it("the legacy node itself runs on the task its job extended, never on its own old output", async () => {
    await processWorkflowExecution(makeJob(["x"]))
    expect(given("x")?.data).toMatchObject({ kieTaskId: "task-gen", outputKieTaskId: "task-ext-own" })
  })

  it("another workflow's job of the same node id changes nothing: the node runs as stored", async () => {
    mocks.setLegacyRows([{ ...OWN_EXTENSION, execution: { workflow_id: "wf-other" } }])
    await processWorkflowExecution(makeJob(["x"]))
    expect(given("x")?.data.kieTaskId).toBe("task-ext-own")
    expect(given("x")?.data.outputKieTaskId).toBeUndefined()
  })
})
