/**
 * The run lane at the orchestrator (lib/concurrency-lanes/run-admit.ts): a
 * top-level workflow execution takes a slot of its user's run lane and of its
 * user's share of this server's orchestrator pool before it starts; a run
 * started by a node of a running run (`parentExecutionId` — a component or a
 * use-case node) takes neither, so a parent holding the last slot never waits
 * on its own child; a claimed (`running`) execution is re-admitted at once;
 * and the execution runs under a run hold every node sees.
 *
 * Drives the REAL `runOrchestratorJob` on the gate's JS twin, with only leaf
 * I/O mocked (the harness of orchestrator-drain.test.ts). A refused run is
 * handed to a recording not-admitted handler that answers "parked" — so a run
 * that wrongly waited would never start, and the tests that need it to start
 * would hang on it rather than pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DelayedError, type Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"
import type { LaneSizes } from "../../lib/concurrency-lanes/types.js"

const mocks = vi.hoisted(() => {
  const executionWrites: Array<{ id: string; updates: Record<string, unknown> }> = []
  /** The status each execution's admission read finds (default `pending`). */
  const execStatus = new Map<string, string>()
  /** Executions another write ends between the worker's row read and its claim. */
  const endedBeforeClaim = new Set<string>()
  let executeNodeImpl: (ctx: { executionId: string }) => Promise<unknown> = async () => ({ output: { text: "x" }, creditsUsed: 0 })
  const executeNode = vi.fn(async (_node: unknown, _inputs: unknown, _edges: unknown, _nodes: unknown, _states: unknown, ctx: { executionId: string }) =>
    executeNodeImpl(ctx))

  const workflowRow = {
    nodes: [
      { id: "p1", type: "text-prompt", data: { text: "hello" } },
      { id: "g1", type: "generate-image", data: { prompt: "x" } },
    ],
    edges: [{ id: "e1", source: "p1", target: "g1" }],
    settings: {},
    user_id: "U",
  }

  function chain(table: string, columns: string | undefined) {
    let id: string | null = null
    const result = () => {
      if (table === "workflows") return { data: workflowRow, error: null }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: { status: "running", node_states: {} }, error: null }
      if (table === "workflow_executions" && columns?.startsWith("id, user_id, status")) {
        return { data: { id, user_id: "U", status: execStatus.get(id ?? "") ?? "pending", workspace_id: null, org_id: null, trigger_type: "manual", mcp_client: null }, error: null }
      }
      return { data: null, error: null }
    }
    const c: Record<string, unknown> = {}
    const self = () => c
    Object.assign(c, {
      select: vi.fn(self),
      eq: vi.fn((col: string, val: unknown) => {
        if (col === "id") id = String(val)
        return c
      }),
      or: vi.fn(self), is: vi.fn(self), in: vi.fn(self), neq: vi.fn(self), order: vi.fn(self),
      single: vi.fn(async () => result()),
      maybeSingle: vi.fn(async () => result()),
      limit: vi.fn(async () => ({ data: [], error: null })),
    })
    return c
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) => (chain(table, columns) as { select: (c?: string) => unknown }).select(columns),
    update: () => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    insert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
  }))

  return {
    executeNode,
    executionWrites,
    execStatus,
    endedBeforeClaim,
    from,
    setExecuteNodeImpl: (fn: (ctx: { executionId: string }) => Promise<unknown>) => { executeNodeImpl = fn },
    reset: () => {
      executionWrites.length = 0
      execStatus.clear()
      endedBeforeClaim.clear()
      executeNodeImpl = async () => ({ output: { text: "x" }, creditsUsed: 0 })
    },
  }
})

const lanes = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 10, llm: 20, local: 20, run: 2 } as LaneSizes,
}))

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", ORCHESTRATOR_CONCURRENCY: 20, MAX_CONCURRENT_NODES_PER_EXECUTION: 12, ORCHESTRATOR_DISPATCH_WIDTH: 50 },
  hasCredits: () => false,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
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
  updateExecutionWithRetry: vi.fn(async (id: string, updates: Record<string, unknown>, opts?: { fromStatuses?: readonly string[] }) => {
    // The claim's compare-and-set misses a row another write ended.
    if (opts?.fromStatuses && mocks.endedBeforeClaim.has(id)) return { ok: false, cancelledRace: true, attempts: 1 }
    mocks.executionWrites.push({ id, updates })
    return { ok: true, cancelledRace: false, attempts: 1 }
  }),
}))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { getJob: vi.fn(async () => null) } }))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))
// A use-case node's hidden run: its graph is the execution's stored snapshot.
vi.mock("@/lib/execution-inline-graph.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/execution-inline-graph.js")>()),
  loadInlineGraph: vi.fn(async () => ({
    version: 1,
    nodeType: "a-use-case",
    nodes: [{ id: "g1", type: "generate-image", data: { prompt: "x" } }],
    edges: [],
    outputMap: {},
    settings: {},
    hash: "h",
  })),
}))
vi.mock("@/lib/use-case/finalize-wrapper.js", () => ({ finalizeUseCaseWrapper: vi.fn(async () => "not_use_case") }))
// Concurrency lanes: the real admission on the gate's JS twin.
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => lanes.gate }))
vi.mock("@/lib/concurrency-lanes/sizes.js", () => ({
  laneSizesFor: async () => lanes.sizes,
  lanesEnforced: async () => (lanes.gate as { isEnforced(): Promise<boolean> }).isEnforced(),
}))
vi.mock("@/lib/concurrency-lanes/provider-of.js", () => ({ primaryProviderOfJob: () => null }))

import { runOrchestratorJob } from "../orchestrator-worker.js"
import { ConcurrencyGate } from "../../lib/concurrency-lanes/gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"
import { registerNotAdmittedHandler, resetWorkerAdmitHooksForTests } from "../../lib/concurrency-lanes/worker-admit.js"
import { resetServerShareForTests, serverShare, serverShareOf } from "../../lib/concurrency-lanes/server-share.js"
import { currentConcurrencyHold, resetLaneCountersForTests, type ConcurrencyHold } from "../../lib/concurrency-lanes/hold.js"

type FakeJob = Job<WorkflowExecutionJob> & { moveToDelayed: ReturnType<typeof vi.fn> }

let gate: ConcurrencyGate
let refused: Array<{ id: string; reason: string }>

function job(executionId: string, extra: Partial<WorkflowExecutionJob> = {}): FakeJob {
  return {
    id: executionId,
    name: "workflow-execution",
    data: { executionId, workflowId: "wf-1", userId: "U", triggerType: "manual", ...extra },
    opts: { attempts: 3 },
    attemptsMade: 0,
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn().mockResolvedValue(undefined),
  } as unknown as FakeJob
}

const runLane = async () => (await gate.snapshot()).lines.find((l) => l.payer === "user:U")?.lanes.run

/** Fill U's run lane with `n` runs that are not ours. */
async function fillRunLane(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const r = await gate.acquire({
      meta: { jobId: `other-${i}`, userId: "U", payer: "user:U", lane: "run", provider: null, source: null, sourceDetail: null, jobType: "workflow-execution", model: null, queue: "workflow-orchestration", bullJobId: `other-${i}` },
      size: lanes.sizes.run,
      mode: "fresh",
      leaseTtlMs: 3_600_000,
    })
    if (!r.granted) throw new Error("expected a grant")
  }
}

const completedWrite = (id: string) => mocks.executionWrites.find((w) => w.id === id && w.updates.status === "completed")

beforeEach(async () => {
  mocks.reset()
  mocks.executeNode.mockClear()
  const client = makeFakeLaneClient(makeFakeLaneStore())
  lanes.gate = new ConcurrencyGate({ client: () => client })
  gate = lanes.gate as ConcurrencyGate
  lanes.sizes = { provider: 10, llm: 20, local: 20, run: 2 }
  resetLaneCountersForTests()
  resetServerShareForTests()
  resetWorkerAdmitHooksForTests()
  serverShare("orchestrator", 20)
  refused = []
  registerNotAdmittedHandler(async (args) => {
    refused.push({ id: args.row.id, reason: args.wait.reason })
    return "parked"
  })
  await gate.setEnforced(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the run lane at the orchestrator", () => {
  it("a run ended between its admission and its claim runs nothing and gives its slot back", async () => {
    mocks.endedBeforeClaim.add("exec-1")
    await runOrchestratorJob(job("exec-1"), "t1")
    expect(mocks.executeNode).not.toHaveBeenCalled()
    expect(mocks.executionWrites.filter((w) => w.id === "exec-1")).toEqual([])
    // The slot it was admitted on is free again (a line with nothing in it is not listed).
    expect(await runLane()).toBeUndefined()
    expect(serverShareOf("orchestrator").occupancy().byUser).toEqual({})
  })

  it("a third run on a 2-run line waits to start and starts when one finishes", async () => {
    const release = new Map<string, () => void>()
    const started = new Set<string>()
    mocks.setExecuteNodeImpl(async (ctx) => {
      started.add(ctx.executionId)
      await new Promise<void>((resolve) => release.set(ctx.executionId, resolve))
      return { output: { text: "x" }, creditsUsed: 0 }
    })
    const first = runOrchestratorJob(job("exec-1"), "t1")
    const second = runOrchestratorJob(job("exec-2"), "t2")
    await vi.waitFor(() => expect(started).toEqual(new Set(["exec-1", "exec-2"])))

    const third = job("exec-3")
    await expect(runOrchestratorJob(third, "t3")).rejects.toBeInstanceOf(DelayedError)
    expect(refused).toEqual([{ id: "exec-3", reason: "user_lane" }])
    expect(started.has("exec-3")).toBe(false)
    expect(await runLane()).toMatchObject({ running: 2, queued: 1 })

    // One finishes: its slot is reserved for the waiting run, which starts at its next pickup.
    release.get("exec-1")!()
    await first
    expect(await gate.hasReservation("exec-3")).toBe(true)
    mocks.setExecuteNodeImpl(async (ctx) => {
      started.add(ctx.executionId)
      return { output: { text: "x" }, creditsUsed: 0 }
    })
    await runOrchestratorJob(third, "t3b")
    expect(started.has("exec-3")).toBe(true)
    expect(completedWrite("exec-3")).toBeDefined()
    release.get("exec-2")!()
    await second
    // Every slot given back (a line with nothing in it is not listed).
    expect(await runLane()).toBeUndefined()
  })

  it("a resumed running execution is readmitted at once", async () => {
    lanes.sizes = { ...lanes.sizes, run: 1 }
    await fillRunLane(1)
    mocks.execStatus.set("exec-1", "running")
    const acquire = vi.spyOn(gate, "acquire")
    await runOrchestratorJob(job("exec-1"), "t")
    expect(refused).toEqual([])
    expect(acquire.mock.calls.map((c) => c[0].mode)).toEqual(["readmit"])
    expect(completedWrite("exec-1")).toBeDefined()
  })

  it("node-executor sees a run hold during an execution", async () => {
    let hold: ConcurrencyHold | undefined
    mocks.setExecuteNodeImpl(async () => {
      hold = currentConcurrencyHold()
      return { output: { text: "x" }, creditsUsed: 0 }
    })
    await runOrchestratorJob(job("exec-1"), "t")
    expect(hold).toMatchObject({ role: "run", lane: "run", userId: "U", payer: "user:U", jobId: "exec-1", leaseId: expect.any(String) })
    // Released when the run settled (a line with nothing in it is not listed).
    expect(await runLane()).toBeUndefined()
  })

  it("a sub-workflow takes no run slot", async () => {
    // A sub-workflow node runs inside its parent's handler (node-executor's
    // sub-workflow handler): it sees the parent's run hold and nothing acquires.
    lanes.sizes = { ...lanes.sizes, run: 1 }
    const acquire = vi.spyOn(gate, "acquire")
    let seen: { hold: ConcurrencyHold | undefined; running: number | undefined } | undefined
    mocks.setExecuteNodeImpl(async () => {
      seen = { hold: currentConcurrencyHold(), running: (await runLane())?.running }
      return { output: { text: "x" }, creditsUsed: 0 }
    })
    await runOrchestratorJob(job("exec-1"), "t")
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(seen).toMatchObject({ hold: { role: "run", jobId: "exec-1" }, running: 1 })
  })

  it("a component execution started by a workflow node takes no run slot", async () => {
    lanes.sizes = { ...lanes.sizes, run: 1 }
    await fillRunLane(1)
    const acquire = vi.spyOn(gate, "acquire")
    let hold: ConcurrencyHold | undefined
    mocks.setExecuteNodeImpl(async () => {
      hold = currentConcurrencyHold()
      return { output: { text: "x" }, creditsUsed: 0 }
    })
    await runOrchestratorJob(job("exec-child", { triggerType: "app_run", parentExecutionId: "exec-parent" }), "t")
    expect(refused).toEqual([])
    expect(acquire).not.toHaveBeenCalled()
    expect(hold).toMatchObject({ role: "coordinator", lane: null, leaseId: null, jobId: "exec-child" })
    expect(completedWrite("exec-child")).toBeDefined()
  })

  it("a run waiting on its nested component execution on a 1-run line completes", async () => {
    lanes.sizes = { ...lanes.sizes, run: 1 }
    mocks.setExecuteNodeImpl(async (ctx) => {
      // The parent's component node starts the inner run and waits for it, holding the line's only slot.
      if (ctx.executionId === "exec-parent") {
        await runOrchestratorJob(job("exec-child", { triggerType: "app_run", parentExecutionId: "exec-parent" }), "tc")
      }
      return { output: { text: "x" }, creditsUsed: 0 }
    })
    await runOrchestratorJob(job("exec-parent"), "tp")
    expect(refused).toEqual([])
    expect(completedWrite("exec-child")).toBeDefined()
    expect(completedWrite("exec-parent")).toBeDefined()
  })

  it("a run waiting on its nested use-case execution on a 1-run line completes", async () => {
    lanes.sizes = { ...lanes.sizes, run: 1 }
    mocks.setExecuteNodeImpl(async (ctx) => {
      if (ctx.executionId === "exec-parent") {
        await runOrchestratorJob(job("exec-uc", {
          workflowId: null, triggerType: "use_case", inlineGraph: true, wrapperJobId: "wrapper-1", parentExecutionId: "exec-parent",
        }), "tu")
      }
      return { output: { text: "x" }, creditsUsed: 0 }
    })
    await runOrchestratorJob(job("exec-parent"), "tp")
    expect(refused).toEqual([])
    expect(completedWrite("exec-uc")).toBeDefined()
    expect(completedWrite("exec-parent")).toBeDefined()
  })

  it("a nested component execution is never refused by its user's orchestrator share", async () => {
    // A pool of 4: one run per user, and U's parent run holds it.
    serverShare("orchestrator", 4)
    const parent = serverShareOf("orchestrator").tryEnter({ userId: "U", jobId: "exec-parent", coordinator: true, exempt: false })
    expect(parent.entered).toBe(true)
    await runOrchestratorJob(job("exec-child", { triggerType: "app_run", parentExecutionId: "exec-parent" }), "t")
    expect(refused).toEqual([])
    expect(completedWrite("exec-child")).toBeDefined()
  })

  it("a nested use-case execution is never refused by its user's orchestrator share", async () => {
    serverShare("orchestrator", 4)
    const parent = serverShareOf("orchestrator").tryEnter({ userId: "U", jobId: "exec-parent", coordinator: true, exempt: false })
    expect(parent.entered).toBe(true)
    await runOrchestratorJob(job("exec-uc", {
      workflowId: null, triggerType: "use_case", inlineGraph: true, wrapperJobId: "wrapper-1", parentExecutionId: "exec-parent",
    }), "t")
    expect(refused).toEqual([])
    expect(completedWrite("exec-uc")).toBeDefined()
  })

  it("one user cannot hold more than 25% of the orchestrator pool", async () => {
    lanes.sizes = { ...lanes.sizes, run: 100 }
    // The default pool of 20: five runs of one user.
    expect(serverShareOf("orchestrator").occupancy()).toMatchObject({ poolSize: 20, userCap: 5 })
    for (let i = 0; i < 5; i++) {
      expect(serverShareOf("orchestrator").tryEnter({ userId: "U", jobId: `held-${i}`, coordinator: true, exempt: false }).entered).toBe(true)
    }
    const acquire = vi.spyOn(gate, "acquire")
    await expect(runOrchestratorJob(job("exec-6"), "t")).rejects.toBeInstanceOf(DelayedError)
    expect(refused).toEqual([{ id: "exec-6", reason: "server_busy" }])
    expect(acquire).not.toHaveBeenCalled()
    expect(mocks.executeNode).not.toHaveBeenCalled()
    // Another user still gets in.
    expect(serverShareOf("orchestrator").tryEnter({ userId: "V", jobId: "v-1", coordinator: true, exempt: false }).entered).toBe(true)
  })

  it("with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    lanes.sizes = { ...lanes.sizes, run: 1 }
    await fillRunLane(1)
    serverShare("orchestrator", 4)
    expect(serverShareOf("orchestrator").tryEnter({ userId: "U", jobId: "held", coordinator: true, exempt: false }).entered).toBe(true)
    let lane: unknown
    mocks.setExecuteNodeImpl(async () => {
      lane = await runLane()
      return { output: { text: "x" }, creditsUsed: 0 }
    })
    const j = job("exec-1")
    await runOrchestratorJob(j, "t")
    // Over both its line and its share, the run started at once — counted as an over-limit lease.
    expect(refused).toEqual([])
    expect(j.moveToDelayed).not.toHaveBeenCalled()
    expect(lane).toMatchObject({ running: 2, overLimit: 1, queued: 0 })
    expect(completedWrite("exec-1")).toBeDefined()
  })

  it("a gate that fails admits the run at once (fails open)", async () => {
    vi.spyOn(gate, "acquire").mockRejectedValue(new Error("redis down"))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await runOrchestratorJob(job("exec-1"), "t")
    expect(refused).toEqual([])
    expect(completedWrite("exec-1")).toBeDefined()
  })

  it("a closed execution re-picked takes no slot at all", async () => {
    mocks.execStatus.set("exec-1", "completed")
    const acquire = vi.spyOn(gate, "acquire")
    await runOrchestratorJob(job("exec-1"), "t")
    expect(acquire).not.toHaveBeenCalled()
  })
})
