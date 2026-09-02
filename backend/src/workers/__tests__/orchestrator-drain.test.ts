/**
 * B6 (spec §7). The orchestrator Worker held a 120-minute lock with
 * maxStalledCount at its default 1, so a SIGKILLed execution was invisible to
 * both BullMQ stall recovery and the executions cron for up to two hours and
 * then went failed-permanent on its first stall — the six
 * "Execution orphaned — no orchestrator job in queue" rows.
 *
 * B6b (below): a deploy drain must never travel the node-failure path. Those
 * tests drive the REAL `runOrchestratorJob` / `cleanupStaleExecutions` with only
 * leaf I/O mocked (supabase, executeNode, the write + queue helpers), so they
 * assert BEHAVIOR — what is written and what is not — rather than source text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DelayedError } from "bullmq"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"
import { DrainAbortError, beginWorkerDrain, _resetWorkerDrainForTests } from "../../lib/worker-drain.js"

// ---------------------------------------------------------------------------
// Mocks — leaf I/O only (harness mirrors freeze-lottie-override.test.ts).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  let executeNodeImpl: () => Promise<unknown> = async () => ({ output: { text: "x" }, creditsUsed: 0 })
  const executeNode = vi.fn(async (node: { id: string }) => {
    executeNodeCalls.push(node.id)
    return executeNodeImpl()
  })

  /** Every `workflow_executions` write the orchestrator issues funnels through
   *  updateExecutionWithRetry — BOTH `updateExecution` and `failExecution` call
   *  it — so this list is the complete record of what reached the row. */
  const executionWrites: Array<{ id: string; updates: Record<string, unknown> }> = []
  /** Raw supabase `.update()` payloads, as a second net under the above. */
  const supabaseUpdates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const fromCalls: string[] = []

  let workflowRow: Record<string, unknown> | null = null
  let staleRows: Array<Record<string, unknown>> = []
  let queueJobState: string | null = null

  function makeChain(table: string, columns?: string) {
    const rowResult = (() => {
      if (table === "workflows") return { data: workflowRow, error: workflowRow ? null : { message: "nf" } }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states")
        return { data: { status: "queued", node_states: {} }, error: null }
      return { data: null, error: null }
    })()
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: vi.fn(self),
      eq: vi.fn(self),
      is: vi.fn(self),
      in: vi.fn(self),
      neq: vi.fn(self),
      order: vi.fn(self),
      single: vi.fn().mockResolvedValue(rowResult),
      maybeSingle: vi.fn().mockResolvedValue(rowResult),
      // The stale-execution sweep's builder terminates on .limit().
      limit: vi.fn().mockResolvedValue({ data: staleRows, error: null }),
    })
    return chain
  }

  const from = vi.fn((table: string) => {
    fromCalls.push(table)
    return {
      select: (columns?: string) => (makeChain(table, columns) as { select: (c?: string) => unknown }).select(columns),
      update: (payload: Record<string, unknown>) => {
        supabaseUpdates.push({ table, payload })
        return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
      },
      insert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    }
  })

  const getJob = vi.fn(async () =>
    queueJobState === null ? null : { getState: async () => queueJobState },
  )

  const updateExecutionWithRetry = vi.fn(async (id: string, updates: Record<string, unknown>) => {
    executionWrites.push({ id, updates })
    return { ok: true, cancelledRace: false, attempts: 1 }
  })

  return {
    executeNode,
    executeNodeCalls,
    executionWrites,
    supabaseUpdates,
    fromCalls,
    from,
    getJob,
    updateExecutionWithRetry,
    setExecuteNodeImpl: (fn: () => Promise<unknown>) => { executeNodeImpl = fn },
    setWorkflowRow: (row: Record<string, unknown> | null) => { workflowRow = row },
    setStaleRows: (rows: Array<Record<string, unknown>>) => { staleRows = rows },
    setQueueJobState: (state: string | null) => { queueJobState = state },
    reset: () => {
      executeNodeCalls.length = 0
      executionWrites.length = 0
      supabaseUpdates.length = 0
      fromCalls.length = 0
      staleRows = []
      queueJobState = null
      executeNodeImpl = async () => ({ output: { text: "x" }, creditsUsed: 0 })
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

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { getJob: mocks.getJob },
}))

vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

import {
  ORCHESTRATOR_LOCK_MS,
  ORCHESTRATOR_STALLED_INTERVAL_MS,
  ORCHESTRATOR_MAX_STALLED,
  ORCHESTRATOR_DRAIN_REQUEUE_DELAY_MS,
  runOrchestratorJob,
  cleanupStaleExecutions,
} from "../orchestrator-worker.js"
// Single source of truth for "orchestrator alive" — asserting the boot sweep
// against this same set (rather than a hand-typed list) is what keeps it
// from drifting out of sync with the cron's gate again. Read from the
// Redis-free leaf, which both the cron and the worker import.
import { ORCHESTRATOR_ALIVE_STATES } from "../../lib/orchestration-queue-config.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type FakeJob = Job<WorkflowExecutionJob> & { moveToDelayed: ReturnType<typeof vi.fn> }

function makeJob(opts: { moveToDelayedFails?: boolean } = {}): FakeJob {
  mocks.setWorkflowRow({
    nodes: [
      { id: "p1", type: "text-prompt", data: { text: "hello" } },
      { id: "g1", type: "generate-image", data: { prompt: "x" } },
    ],
    edges: [{ id: "e1", source: "p1", target: "g1" }],
    settings: {},
    user_id: "owner-1",
  })
  const moveToDelayed = opts.moveToDelayedFails
    ? vi.fn().mockRejectedValue(new Error("lock is no longer owned"))
    : vi.fn().mockResolvedValue(undefined)
  return {
    data: {
      executionId: "exec-1",
      workflowId: "wf-1",
      userId: "owner-1",
      triggerType: "manual",
    },
    moveToDelayed,
  } as unknown as FakeJob
}

const failedWrites = () =>
  mocks.executionWrites.filter((w) => w.updates.status === "failed")

const failedNodeStates = () =>
  mocks.executionWrites.flatMap((w) =>
    Object.values((w.updates.node_states ?? {}) as Record<string, { status?: string }>),
  ).filter((s) => s?.status === "failed")

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("orchestrator worker lock geometry", () => {
  it("uses a short, auto-renewed lock rather than the workflow timeout", () => {
    expect(ORCHESTRATOR_LOCK_MS).toBe(300_000)
    // BullMQ renews at lockDuration/2 while the handler runs, so a long
    // execution is safe; the lock only bounds the post-SIGKILL blackout.
    expect(ORCHESTRATOR_LOCK_MS).toBeLessThan(15 * 60_000)
  })

  it("checks for stalls often enough to cap the blackout at ~6 minutes", () => {
    expect(ORCHESTRATOR_STALLED_INTERVAL_MS).toBe(60_000)
    expect(ORCHESTRATOR_LOCK_MS + ORCHESTRATOR_STALLED_INTERVAL_MS).toBeLessThanOrEqual(6 * 60_000)
  })

  it("survives a deploy storm rather than going failed-permanent on the first stall", () => {
    expect(ORCHESTRATOR_MAX_STALLED).toBe(3)
  })
})

describe("orchestrator drain safety", () => {
  beforeEach(() => {
    mocks.reset()
    vi.mocked(mocks.executeNode).mockClear()
  })

  it("re-exports a requeue delay short enough to land inside the drain window", () => {
    expect(ORCHESTRATOR_DRAIN_REQUEUE_DELAY_MS).toBeGreaterThan(0)
    expect(ORCHESTRATOR_DRAIN_REQUEUE_DELAY_MS).toBeLessThan(30_000)
  })

  it("a node's DrainAbortError never reaches failExecution — nothing is written", async () => {
    // The whole point of B6b: without the hatches this run would write
    // status='failed' on a perfectly healthy execution.
    const reason = new DrainAbortError()
    mocks.setExecuteNodeImpl(async () => { throw reason })

    const job = makeJob()
    await expect(runOrchestratorJob(job, "tok")).rejects.toBeInstanceOf(DelayedError)

    expect(failedWrites()).toEqual([])
    expect(failedNodeStates()).toEqual([])
    expect(mocks.supabaseUpdates.filter((u) => u.payload.status === "failed")).toEqual([])
  })

  it("an ordinary node error DOES still write a failed execution (hatch is narrow)", async () => {
    mocks.setExecuteNodeImpl(async () => { throw new Error("provider 503") })

    const job = makeJob()
    await runOrchestratorJob(job, "tok")

    expect(failedWrites().length).toBeGreaterThan(0)
    expect(job.moveToDelayed).not.toHaveBeenCalled()
  })

  it("parks the job with moveToDelayed + DelayedError rather than a plain rethrow", async () => {
    mocks.setExecuteNodeImpl(async () => { throw new DrainAbortError() })

    const before = Date.now()
    const job = makeJob()
    await expect(runOrchestratorJob(job, "tok-1")).rejects.toBeInstanceOf(DelayedError)

    expect(job.moveToDelayed).toHaveBeenCalledTimes(1)
    const [when, token] = job.moveToDelayed.mock.calls[0] as [number, string]
    expect(token).toBe("tok-1")
    expect(when).toBeGreaterThanOrEqual(before + ORCHESTRATOR_DRAIN_REQUEUE_DELAY_MS)
    expect(when).toBeLessThanOrEqual(Date.now() + ORCHESTRATOR_DRAIN_REQUEUE_DELAY_MS)
  })

  it("falls back to rethrowing the drain error when moveToDelayed fails", async () => {
    // Retried up to ORCHESTRATION_JOB_ATTEMPTS on this queue — but it must
    // still not be a DelayedError, or BullMQ would think the park succeeded.
    const reason = new DrainAbortError()
    mocks.setExecuteNodeImpl(async () => { throw reason })

    const job = makeJob({ moveToDelayedFails: true })
    await expect(runOrchestratorJob(job, "tok")).rejects.toBe(reason)
    expect(failedWrites()).toEqual([])
  })

  it("a draining worker parks the job WITHOUT starting the execution", async () => {
    beginWorkerDrain()

    const job = makeJob()
    await expect(runOrchestratorJob(job, "tok")).rejects.toBeInstanceOf(DelayedError)

    expect(job.moveToDelayed).toHaveBeenCalledTimes(1)
    // No node dispatched, no row read, no row written — no jobs-row insert and
    // no credit reservation can have happened.
    expect(mocks.executeNodeCalls).toEqual([])
    expect(mocks.fromCalls).toEqual([])
    expect(mocks.executionWrites).toEqual([])
  })

  it("the job poll loop aborts on drain instead of cancelling the child job", async () => {
    // SOURCE assertion, deliberately kept: driving this poll loop behaviourally
    // needs a live `jobs` row plus real poll sleeps. It must THROW, never route
    // through cancelJobAndThrow (which cancels the child job and refunds — the
    // child is recoverable on resume).
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../services/workflow-engine/node-executor.ts", import.meta.url), "utf8"),
    )
    expect(src).toMatch(/if \(isWorkerDraining\(\)\) throw new DrainAbortError\(\)/)
  })
})

describe("orchestrator boot sweep — queue gate", () => {
  beforeEach(() => {
    mocks.reset()
  })

  it.each([...ORCHESTRATOR_ALIVE_STATES])(
    "SKIPS a stale row whose orchestration job is %s (a drain-parked run must survive a boot)",
    async (state) => {
      mocks.setStaleRows([{ id: "exec-parked", started_at: null, node_states: {} }])
      mocks.setQueueJobState(state)

      await cleanupStaleExecutions()

      expect(mocks.getJob).toHaveBeenCalledWith("exec-parked")
      // Untouched: without the gate this row is written failed/"never started".
      expect(mocks.executionWrites).toEqual([])
    },
  )

  it("still abandons a stale row with NO orchestration job (orphan path unchanged)", async () => {
    mocks.setStaleRows([{ id: "exec-orphan", started_at: null, node_states: {} }])
    mocks.setQueueJobState(null)

    await cleanupStaleExecutions()

    expect(mocks.executionWrites).toHaveLength(1)
    expect(mocks.executionWrites[0].id).toBe("exec-orphan")
    expect(mocks.executionWrites[0].updates.status).toBe("failed")
  })

  it("still abandons a stale row whose orchestration job already failed", async () => {
    mocks.setStaleRows([{ id: "exec-dead", started_at: null, node_states: {} }])
    mocks.setQueueJobState("failed")

    await cleanupStaleExecutions()

    expect(mocks.executionWrites).toHaveLength(1)
    expect(mocks.executionWrites[0].updates.status).toBe("failed")
  })
})


describe("orchestrator entrypoint shutdown", () => {
  it("the dedicated orchestrator process drains and hard-exits", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../orchestrator.ts", import.meta.url), "utf8"),
    )
    expect(src).toContain("beginWorkerDrain()")
    expect(src).toMatch(/SHUTDOWN_DRAIN_MS/)
    expect(src).toMatch(/setTimeout\([\s\S]{0,200}process\.exit\(1\)/)
    // No console.log in production code (root CLAUDE.md). This file has two
    // today (:33, :37); Step 3 replaces them, so the assertion is safe HERE.
    // It is deliberately NOT made for server.ts, which keeps its boot logs.
    expect(src).not.toMatch(/console\.log\(/)
  })

  it("keeps the mainline prompt-policy registration this task must not delete", async () => {
    // M-9a. W1-a (#1137) added registerMainlinePromptPolicies() to this
    // entrypoint. Rewriting the import block would drop the minor-age floor
    // for every orchestrated generation, silently. The canonical guard is
    // lib/prompt-policies/__tests__/registration-totality.test.ts; this is a
    // second, local tripwire because THIS task is the one that would do it.
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../orchestrator.ts", import.meta.url), "utf8"),
    )
    expect(src).toContain("registerMainlinePromptPolicies")
    // The ORDER is load-bearing, not just the presence: the overlay registers
    // first, the mainline floor after it (so the safety invariant wins), and
    // both strictly before the worker starts consuming executions.
    expect(src.indexOf("loadOverlay()")).toBeLessThan(src.indexOf("registerMainlinePromptPolicies()"))
    expect(src.indexOf("registerMainlinePromptPolicies()"))
      .toBeLessThan(src.indexOf("createOrchestratorWorker()"))
  })

  it("the API server hard-exits but does NOT set the process-global drain flag", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../server.ts", import.meta.url), "utf8"),
    )
    expect(src).toMatch(/SHUTDOWN_DRAIN_MS/)
    expect(src).toMatch(/setTimeout\([\s\S]{0,200}process\.exit\(1\)/)
    // Setting it here would abort in-flight HTTP provider polls and file them
    // as internal errors — the exact class W0's abort skip just removed.
    // Comments are stripped first: the block's own rationale NAMES the call it
    // must never make, and this asserts on code, not on prose (M-9b).
    expect(stripComments(src)).not.toContain("beginWorkerDrain")
  })
})

/** Strip block and line comments before matching — the server.ts shutdown
 *  block documents WHY it never calls beginWorkerDrain(), and that prose must
 *  not read as the call itself. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

afterEach(() => _resetWorkerDrainForTests())
