// @test-watches backend/src/routes/use-case-run.ts backend/src/routes/use-case-continue.ts backend/src/workers/orchestrator-worker.ts
/**
 * An INLINE (use-case) execution — REAL orchestrator path (decided 2026-10-13).
 *
 * A use-case node's hidden run has no workflow row and no app version: its
 * graph is the execution's own stored snapshot (`inline_graph`). The worker
 * loads it as a third graph source and then runs it through every wall a
 * saved workflow passes — the access block, the canvas check, entity
 * hydration, the continuation identity, the override merge, the catalog
 * guard, the preview stop rule, the render preflights and the time cap.
 *
 * Drives `processWorkflowExecution` with only leaf I/O mocked (the harness of
 * run-continuation-orchestrator.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  EPISODE_TRAILER_DEFAULTS,
  TIGHTEN_EPISODE_DEFAULTS,
  buildEpisodeTrailerGraph,
  renderFinalRunSet,
  renderRunOverrides,
  buildTightenEpisodeGraph,
  initialRunNodeIds,
  toStoredInlineGraph,
  usecaseRenderFinalOverrides,
  USE_CASE_LIST_DRIVEN,
  USE_CASE_REVIEW_LIST_DRIVEN,
  USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE,
  type TightenEpisodeSettings,
} from "@nodaro/render-rules"
import type { NodeExecutionState, OrchestratorContext, WorkflowExecutionJob } from "../../services/workflow-engine/types.js"
import { usecaseWrapperKeepsPartial, usecaseWrapperOutput } from "../../lib/use-case/wrapper-output.js"

const mocks = vi.hoisted(() => {
  const executeNodeCalls: Array<{ id: string; inputs: Record<string, unknown>; data: Record<string, unknown> }> = []
  const executeNode = vi.fn(async (node: { id: string; data?: Record<string, unknown> }, inputs: Record<string, unknown>) => {
    executeNodeCalls.push({ id: node.id, inputs, data: { ...(node.data ?? {}) } })
    return { output: { videoUrl: `https://r2/${node.id}.mp4` }, creditsUsed: 1 }
  })
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const directUpdates: Array<Record<string, unknown>> = []
  const workflows = new Map<string, Record<string, unknown>>()
  const apps = new Map<string, Record<string, unknown>>()
  /** Earlier executions, by id: the rows a continuation reads. */
  const executions = new Map<string, Record<string, unknown>>()
  /** app_runs.app_id by execution id. */
  const appRuns = new Map<string, string>()
  /** app_runs.input_values by execution id: the overrides that app run used. */
  const appRunInputs = new Map<string, Record<string, Record<string, unknown>>>()
  const execSelectRow = { status: "queued", node_states: {} }
  /** `jobs` rows, in the projection the canvas-result-ids lookup selects. */
  const jobRows: Array<Record<string, unknown>> = []

  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "workflows") {
        const row = workflows.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "published_apps") {
        const row = apps.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
      if (table === "workflow_executions") return { data: executions.get(filters.id as string) ?? null, error: null }
      if (table === "jobs") return { data: jobRows.filter((r) => r.user_id === filters.user_id), error: null }
      if (table === "app_runs") {
        const appId = appRuns.get(filters.execution_id as string)
        const inputValues = appRunInputs.get(filters.execution_id as string) ?? null
        return { data: appId ? { app_id: appId, input_values: inputValues } : null, error: null }
      }
      return { data: null, error: null }
    }
    const self = {
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return self
      },
      is: () => self,
      or: () => self,
      order: () => self,
      range: async () => resolve(),
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
    }
    return self
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) => chain(table, columns),
    update: (row: Record<string, unknown>) => {
      directUpdates.push(row)
      return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
    },
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }))

  return { executeNode, executeNodeCalls, updateExecutionWithRetry, directUpdates, from, workflows, apps, executions, appRuns, appRunInputs, execSelectRow, jobRows }
})

const flag = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => flag.on }))
vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", ORCHESTRATOR_CONCURRENCY: 2, MAX_CONCURRENT_NODES_PER_EXECUTION: 12 },
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
vi.mock("@/lib/execution-writes.js", () => ({ updateExecutionWithRetry: mocks.updateExecutionWithRetry }))
vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

const inline = vi.hoisted(() => ({ graph: null as unknown, loads: [] as string[] }))
vi.mock("@/lib/execution-inline-graph.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/execution-inline-graph.js")>()),
  loadInlineGraph: vi.fn(async (executionId: string) => {
    inline.loads.push(executionId)
    return inline.graph
  }),
}))
const blocks = vi.hoisted(() => ({ blocked: false }))
vi.mock("@/lib/access-blocks.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/access-blocks.js")>()),
  isUserBlocked: vi.fn(async () => blocks.blocked),
}))

const fin = vi.hoisted(() => ({ finalize: vi.fn(async (_id: string, _expected?: string) => "completed"), progress: vi.fn(async (_id: string, _c: number, _t: number) => {}) }))
vi.mock("@/lib/use-case/finalize-wrapper.js", () => ({ finalizeUseCaseWrapper: fin.finalize }))
vi.mock("@/lib/use-case/progress.js", () => ({ mirrorUseCaseProgress: fin.progress }))

import { processWorkflowExecution } from "../orchestrator-worker.js"

const OWNER = "owner-1"

function built(over: Partial<TightenEpisodeSettings> = {}) {
  const settings: TightenEpisodeSettings = { ...TIGHTEN_EPISODE_DEFAULTS, captions: false, ...over }
  return toStoredInlineGraph(
    buildTightenEpisodeGraph(settings, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 60 } }),
    settings,
  )
}

function inlineJob(data: Partial<WorkflowExecutionJob> = {}): Job<WorkflowExecutionJob> {
  return {
    data: {
      executionId: "exec-1",
      workflowId: null,
      userId: OWNER,
      triggerType: "use_case",
      inlineGraph: true,
      wrapperJobId: "job-w",
      reviewerPresent: false,
      billingContext: { userId: OWNER, payer: "user" },
      ...data,
    },
  } as unknown as Job<WorkflowExecutionJob>
}

const ran = () => mocks.executeNodeCalls.map((c) => c.id).sort()
const dataOf = (id: string) => mocks.executeNodeCalls.find((c) => c.id === id)?.data
const at = "2026-10-13T10:00:00.000Z"
function completedWrite(): Record<string, unknown> | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === "completed")
  return call?.[1] as Record<string, unknown> | undefined
}
function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === "failed")
  return call?.[1] as { error_message?: string } | undefined
}
const tablesRead = () => mocks.from.mock.calls.map(([t]) => t)

beforeEach(() => {
  mocks.executeNode.mockClear()
  mocks.executeNodeCalls.length = 0
  mocks.updateExecutionWithRetry.mockClear()
  mocks.directUpdates.length = 0
  mocks.from.mockClear()
  mocks.workflows.clear()
  mocks.apps.clear()
  mocks.executions.clear()
  mocks.execSelectRow.status = "queued"
  mocks.execSelectRow.node_states = {}
  mocks.jobRows.length = 0
  inline.graph = built()
  inline.loads.length = 0
  blocks.blocked = false
  flag.on = true
  fin.finalize.mockClear()
  fin.progress.mockClear()
})

describe("an inline (use-case) execution", () => {
  it("runs the snapshot's executable nodes and never reads a workflow or an app row", async () => {
    await processWorkflowExecution(inlineJob())
    expect(failedWrite()).toBeUndefined()
    expect(inline.loads).toEqual(["exec-1"])
    expect(ran()).toEqual(["uc-plan", "uc-render", "uc-silence", "uc-transcribe"])
    expect(tablesRead()).not.toContain("workflows")
    expect(tablesRead()).not.toContain("published_apps")
  })

  it("the engine sees empty workflow settings: the snapshot's use-case settings never reach the workflow-settings slot", async () => {
    inline.graph = built({ instructions: "keep the jokes", reviewBeforeRender: false })
    await processWorkflowExecution(inlineJob())
    const ctx = (mocks.executeNode.mock.calls[0] as unknown[])[5] as OrchestratorContext
    expect(ctx.workflowSettings).toEqual({})
    expect(ctx.workflowId).toBeNull()
    expect(ctx.workflowOwnerId).toBe(OWNER)
    expect(ctx.triggerType).toBe("use_case")
  })

  it("its steps reserve with the run's spend surface and app-run flag, as the fee did (the component lane's precedent)", async () => {
    // Every step the hidden run executes reserves its own credits with these
    // ctx flags (node-executor's checkCredits / reserve, the sync lane's
    // X-App-Run / X-Web-Free-Mode headers).
    await processWorkflowExecution(inlineJob({ webFreeMode: true, appRun: true }))
    const ctxs = mocks.executeNode.mock.calls.map((c) => (c as unknown[])[5] as OrchestratorContext)
    expect(ctxs.length).toBeGreaterThan(0)
    for (const ctx of ctxs) {
      expect(ctx.webFreeMode).toBe(true)
      expect(ctx.isAppRun).toBe(true)
    }
    mocks.executeNode.mockClear()
    await processWorkflowExecution(inlineJob())
    for (const c of mocks.executeNode.mock.calls) {
      const ctx = (c as unknown[])[5] as OrchestratorContext
      expect(ctx.webFreeMode).toBe(false)
      expect(ctx.isAppRun).toBe(false)
    }
  })

  it("both use-case routes hand the hidden run the flags their balance check and fee hold used", () => {
    for (const rel of ["routes/use-case-run.ts", "routes/use-case-continue.ts"]) {
      const src = readFileSync(join(__dirname, "..", "..", rel), "utf8")
      const start = src.indexOf("executeInlineGraph({")
      const call = src.slice(start, start + src.slice(start).search(/\n\s*\}\)\n/))
      expect(call, rel).toMatch(/\n\s*webFreeMode,\n/)
      expect(call, rel).toMatch(/appRun: req\.isAppRun === true,/)
      // …the same webFreeMode the balance check read.
      expect(src, rel).toMatch(/const webFreeMode = req\.webFreeMode === true \|\| \(await resolveWebSurfaceFlag\(req\)\)/)
      expect(src.match(/const webFreeMode =/g)?.length, rel).toBe(1)
    }
  })

  it("no snapshot: fails honestly, running nothing", async () => {
    inline.graph = null
    await processWorkflowExecution(inlineJob())
    expect(failedWrite()?.error_message).toBe("Use-case graph not found")
    expect(ran()).toEqual([])
    expect(tablesRead()).not.toContain("workflows")
  })

  it("a run with no workflow and no snapshot flag never asks the workflows table for a null id", async () => {
    await processWorkflowExecution(inlineJob({ inlineGraph: undefined, triggerType: "manual" }))
    expect(failedWrite()?.error_message).toBe("Workflow not found")
    expect(inline.loads).toEqual([])
    expect(tablesRead()).not.toContain("workflows")
    expect(ran()).toEqual([])
  })

  it("the access wall still applies (a blocked runner)", async () => {
    blocks.blocked = true
    await processWorkflowExecution(inlineJob())
    expect(failedWrite()?.error_message).toBe("This account is blocked.")
    expect(ran()).toEqual([])
  })

  it("every wall a saved workflow passes runs AFTER the inline load", () => {
    // Placement, in the style of catalog-guard-wiring.test.ts: the inline
    // branch only sets the graph and the owner; every wall must come after it.
    const src = readFileSync(join(__dirname, "..", "orchestrator-worker.ts"), "utf8")
    const body = src.slice(src.indexOf("export async function processWorkflowExecution"))
    const load = body.indexOf("job.data.inlineGraph === true")
    expect(load).toBeGreaterThan(0)
    for (const wall of [
      "isUserBlocked(", // access block (runner and owner)
      "assertCanvasExecutionAllowed(", // canvas / run-scope check
      "hydrateEntityNodes(", // entity hydration under the owner
      "continuationRefusal(", // continuation identity
      "applyInputOverridesToNodes(", // override merge + lock
      "findForeignCatalogIds(", // catalog guard
      "runPreviewStops(", // preview stop rule
      "speakerViewRunPreflight(", // render preflights
      "workflowCapMs(", // workflow time cap
    ]) {
      const at = body.indexOf(wall)
      expect(at, `${wall} missing from processWorkflowExecution`).toBeGreaterThan(0)
      expect(at, `${wall} runs before the inline load`).toBeGreaterThan(load)
    }
  })

  for (const on of [true, false]) {
    it(`a review-on run executes up to the proxy render — no captions job — with the stop-rule flag ${on ? "on" : "off"}`, async () => {
      flag.on = on
      const g = built({ reviewBeforeRender: true, captions: true })
      inline.graph = g
      await processWorkflowExecution(inlineJob({ reviewerPresent: true, nodeIds: initialRunNodeIds(g)! }))
      expect(failedWrite()).toBeUndefined()
      expect(ran()).toEqual(["uc-plan", "uc-render", "uc-silence", "uc-transcribe"])
      expect(mocks.executeNodeCalls.some((c) => c.id === "uc-captions")).toBe(false)
    })
  }
})

describe("continue from a failed inline run", () => {
  const stored = () => built()
  function failedSource(): Record<string, unknown> {
    return {
      id: "exec-0", user_id: OWNER, workflow_id: null, status: "failed", inline_graph: stored(),
      node_states: {
        "uc-source": { status: "completed", output: { videoUrl: "https://r2/ep.mp4" }, completedAt: at, fromSavedData: true },
        "uc-transcribe": { status: "completed", nodeType: "transcribe", jobId: "j-t", output: { json: { words: [] } }, completedAt: at },
        "uc-silence": { status: "completed", nodeType: "silence-detect", jobId: "j-s", output: { json: { silences: [] } }, completedAt: at },
        "uc-plan": { status: "completed", nodeType: "edit-plan", jobId: "j-p", output: { json: { version: 1, sources: [], segments: [] } }, completedAt: at },
        "uc-render": { status: "failed", nodeType: "apply-edl", jobId: "j-r", error: "boom", completedAt: at },
      },
    }
  }
  beforeEach(() => {
    inline.graph = stored()
    mocks.executions.set("exec-0", failedSource())
  })

  it("re-runs only the failed step; the completed ones are seeded, never dispatched (never billed again)", async () => {
    await processWorkflowExecution(inlineJob({ executionId: "exec-1", continueFromExecutionId: "exec-0", continueMode: "from-failed", nodeIds: ["uc-render"] }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["uc-render"])
    const states = completedWrite()!.node_states as Record<string, NodeExecutionState>
    for (const id of ["uc-transcribe", "uc-silence", "uc-plan"]) expect(states[id]).toMatchObject({ status: "completed", seededFromExecution: "exec-0" })
  })

  it("is refused when the source did not fail", async () => {
    mocks.executions.set("exec-0", { ...failedSource(), status: "completed" })
    await processWorkflowExecution(inlineJob({ continueFromExecutionId: "exec-0", continueMode: "from-failed", nodeIds: ["uc-render"] }))
    expect(failedWrite()?.error_message).toBe("continuation_not_failed")
    expect(ran()).toEqual([])
  })

  it("is refused across snapshots", async () => {
    inline.graph = built({ planTier: "premium" })
    await processWorkflowExecution(inlineJob({ continueFromExecutionId: "exec-0", continueMode: "from-failed", nodeIds: ["uc-render"] }))
    expect(failedWrite()?.error_message).toBe("continuation_workflow_mismatch")
    expect(ran()).toEqual([])
  })

  it("is refused when the source's snapshot is gone (expunged): no stored hash, no identity", async () => {
    mocks.executions.set("exec-0", { ...failedSource(), inline_graph: {} })
    await processWorkflowExecution(inlineJob({ continueFromExecutionId: "exec-0", continueMode: "from-failed", nodeIds: ["uc-render"] }))
    expect(failedWrite()?.error_message).toBe("continuation_workflow_mismatch")
    expect(ran()).toEqual([])
  })

  it("a caller that lists a completed step never re-dispatches (or re-bills) it: the worker filters the subset itself", async () => {
    await processWorkflowExecution(inlineJob({
      executionId: "exec-1", continueFromExecutionId: "exec-0", continueMode: "from-failed",
      nodeIds: ["uc-transcribe", "uc-silence", "uc-plan", "uc-render"],
    }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["uc-render"])
    const states = completedWrite()!.node_states as Record<string, NodeExecutionState>
    for (const id of ["uc-transcribe", "uc-silence", "uc-plan"]) expect(states[id]).toMatchObject({ status: "completed", seededFromExecution: "exec-0" })
  })

  it("a from-failed run listing only completed steps is refused, running nothing", async () => {
    await processWorkflowExecution(inlineJob({ continueFromExecutionId: "exec-0", continueMode: "from-failed", nodeIds: ["uc-plan", "uc-transcribe"] }))
    expect(failedWrite()?.error_message).toBe("continuation_subset_required")
    expect(ran()).toEqual([])
  })

  it("a continuation without the mode is a subset run: a failed source is refused as not completed", async () => {
    await processWorkflowExecution(inlineJob({ continueFromExecutionId: "exec-0", nodeIds: ["uc-render"] }))
    expect(failedWrite()?.error_message).toBe("continuation_not_completed")
    expect(ran()).toEqual([])
  })
})

describe("Render final of a review-on inline run", () => {
  it("re-renders at final and creates the captions job exactly once", async () => {
    const g = built({ reviewBeforeRender: true, captions: true })
    inline.graph = g
    const done = (nodeType: string, output: Record<string, unknown>) => ({ status: "completed", nodeType, jobId: `j-${nodeType}`, output, completedAt: at })
    mocks.executions.set("exec-0", {
      id: "exec-0", user_id: OWNER, workflow_id: null, status: "completed", inline_graph: g,
      node_states: {
        "uc-source": { status: "completed", output: { videoUrl: "https://r2/ep.mp4" }, completedAt: at, fromSavedData: true },
        "uc-transcribe": done("transcribe", { json: { words: [] } }),
        "uc-silence": done("silence-detect", { json: { ranges: [] } }),
        "uc-plan": done("edit-plan", { json: { version: 1, sources: [], segments: [] } }),
        "uc-render": done("apply-edl", { videoUrl: "https://r2/preview.mp4", quality: "proxy" }),
      },
    })
    await processWorkflowExecution(inlineJob({
      executionId: "exec-2", continueFromExecutionId: "exec-0", reviewerPresent: false,
      nodeIds: ["uc-render", "uc-captions"], inputOverrides: { "uc-render": { quality: "final" } },
    }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["uc-captions", "uc-render"])
    expect(mocks.executeNodeCalls.filter((c) => c.id === "uc-captions")).toHaveLength(1)
    expect(dataOf("uc-render")).toMatchObject({ quality: "final" })
  })
})

describe("an inline run with an app version", () => {
  it("is refused before any graph loads: no snapshot read, no app row read, nothing run — and its wrapper is still settled", async () => {
    mocks.apps.set("app-1", { snapshot_nodes: [], snapshot_edges: [], snapshot_settings: {}, creator_id: "someone", publish_type: "app" })
    await processWorkflowExecution(inlineJob({ appVersionId: "app-1" }))
    expect(failedWrite()?.error_message).toBe("A use-case run cannot carry an app version")
    expect(inline.loads).toEqual([])
    expect(tablesRead()).not.toContain("published_apps")
    expect(ran()).toEqual([])
    expect(fin.finalize).toHaveBeenCalledWith("exec-1", "job-w")
  })
})

describe("the wrapper hooks", () => {
  it("finalises the wrapper when the run ends, once", async () => {
    await processWorkflowExecution(inlineJob())
    expect(failedWrite()).toBeUndefined()
    expect(fin.finalize).toHaveBeenCalledTimes(1)
    expect(fin.finalize).toHaveBeenCalledWith("exec-1", "job-w")
  })

  it("finalises on an early refusal too", async () => {
    inline.graph = null
    await processWorkflowExecution(inlineJob())
    expect(failedWrite()?.error_message).toBe("Use-case graph not found")
    expect(fin.finalize).toHaveBeenCalledTimes(1)
    expect(fin.finalize).toHaveBeenCalledWith("exec-1", "job-w")
  })

  it("a finaliser that throws never fails the run's own bookkeeping", async () => {
    fin.finalize.mockRejectedValueOnce(new Error("db down"))
    await expect(processWorkflowExecution(inlineJob())).resolves.toBeUndefined()
    expect(completedWrite()).toBeDefined()
  })

  it("mirrors progress onto the wrapper, never past what the run has done", async () => {
    await processWorkflowExecution(inlineJob())
    expect(fin.progress).toHaveBeenCalledWith("job-w", expect.any(Number), expect.any(Number))
    for (const [id, done, total] of fin.progress.mock.calls) {
      expect(id).toBe("job-w")
      expect(total).toBeGreaterThan(0)
      expect(done).toBeLessThanOrEqual(total)
    }
  })

  it("a saved-workflow run never touches a wrapper", async () => {
    const g = built()
    mocks.workflows.set("wf-1", { nodes: g.nodes, edges: g.edges, settings: {}, user_id: OWNER })
    await processWorkflowExecution(inlineJob({ inlineGraph: undefined, wrapperJobId: undefined, workflowId: "wf-1", triggerType: "manual" }))
    expect(failedWrite()).toBeUndefined()
    expect(ran().length).toBeGreaterThan(0)
    expect(fin.finalize).not.toHaveBeenCalled()
    expect(fin.progress).not.toHaveBeenCalled()
  })
})

describe("an outer run holds what follows a review-on Tighten Episode node until its Render final", () => {
  const outer = (data: Record<string, unknown>) => ({
    nodes: [
      { id: "rec", type: "upload-video", data: { url: "https://r2/ep.mp4" } },
      { id: "t1", type: "tighten-episode", data },
      { id: "fmt", type: "social-media-format", data: {} },
    ],
    edges: [
      { id: "e1", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { id: "e2", source: "t1", target: "fmt", sourceHandle: "media", targetHandle: "in" },
    ],
    settings: {},
    user_id: OWNER,
  })
  const outerJob = (data: Partial<WorkflowExecutionJob>) =>
    inlineJob({ inlineGraph: undefined, wrapperJobId: undefined, workflowId: "wf-2", triggerType: "manual", ...data })
  /** The run that made t1's take, finished; what followed it waited. */
  const madeTake = (quality: "proxy" | "final") =>
    mocks.executions.set("exec-0", {
      id: "exec-0", user_id: OWNER, workflow_id: "wf-2", status: "completed",
      node_states: {
        rec: { status: "completed", output: { videoUrl: "https://r2/ep.mp4" }, completedAt: at, fromSavedData: true },
        t1: { status: "completed", nodeType: "tighten-episode", jobId: "job-w", output: { videoUrl: "https://r2/p.mp4", quality }, completedAt: at },
        fmt: { status: "skipped", completedAt: at },
      },
    })
  const states = () => completedWrite()?.node_states as Record<string, NodeExecutionState> | undefined

  it("the node runs (to its preview); what follows it does not", async () => {
    mocks.workflows.set("wf-2", outer({ reviewBeforeRender: true }))
    await processWorkflowExecution(outerJob({ reviewerPresent: true }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["t1"])
    expect(states()?.fmt?.status).toBe("skipped")
  })

  it("review off: what follows runs in the same run", async () => {
    mocks.workflows.set("wf-2", outer({ reviewBeforeRender: false }))
    await processWorkflowExecution(outerJob({ reviewerPresent: true }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["fmt", "t1"])
  })

  it("with the stop-rule flag off nothing is held, as with every preview", async () => {
    flag.on = false
    mocks.workflows.set("wf-2", outer({ reviewBeforeRender: true }))
    await processWorkflowExecution(outerJob({ reviewerPresent: false }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["fmt", "t1"])
  })

  it("with nobody to review, the run is refused as a held preview is", async () => {
    mocks.workflows.set("wf-2", outer({ reviewBeforeRender: true }))
    await processWorkflowExecution(outerJob({ reviewerPresent: false }))
    expect(failedWrite()?.error_message).toBe("preview_review_required_review_on")
    expect(ran()).toEqual([])
  })

  it("its Render final (the shipped continuation override) runs it and what follows", async () => {
    mocks.workflows.set("wf-2", outer({ reviewBeforeRender: true }))
    madeTake("proxy")
    await processWorkflowExecution(outerJob({
      continueFromExecutionId: "exec-0", nodeIds: ["t1", "fmt"], reviewerPresent: true,
      inputOverrides: usecaseRenderFinalOverrides("t1", { jobId: "job-w" }),
    }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["fmt", "t1"])
    expect(dataOf("t1")?.useCaseContinue).toEqual({ mode: "render-final", jobId: "job-w" })
  })

  for (const code of ["render_final_already_rendered", "already_running"]) {
    it(`a Render final the route refuses with ${code} fails the node: nothing after it runs or charges again`, async () => {
      mocks.workflows.set("wf-2", outer({ reviewBeforeRender: true }))
      madeTake("proxy")
      mocks.executeNode.mockImplementationOnce(async (node: { id: string; data?: Record<string, unknown> }, inputs: Record<string, unknown>) => {
        mocks.executeNodeCalls.push({ id: node.id, inputs, data: { ...(node.data ?? {}) } })
        throw Object.assign(new Error("Already rendered with this edit."), { errorCode: code, output: { useCaseFinalJobId: "job-f" } })
      })
      await processWorkflowExecution(outerJob({
        continueFromExecutionId: "exec-0", nodeIds: ["t1", "fmt"], reviewerPresent: true,
        inputOverrides: usecaseRenderFinalOverrides("t1", { jobId: "job-w" }),
      }))
      // Only the node was asked; what follows it never ran.
      expect(ran()).toEqual(["t1"])
      const written = ((failedWrite() ?? completedWrite()) as { node_states?: unknown } | undefined)?.node_states as Record<string, NodeExecutionState> | undefined
      expect(written?.t1).toMatchObject({ status: "failed", errorCode: code })
      expect(written?.t1?.creditsUsed ?? 0).toBe(0)
      expect(written?.fmt?.status).not.toBe("completed")
    })
  }

  it("a continuation that does not run it reads its Preview take: what follows still waits", async () => {
    mocks.workflows.set("wf-2", outer({ reviewBeforeRender: true }))
    madeTake("proxy")
    await processWorkflowExecution(outerJob({ continueFromExecutionId: "exec-0", nodeIds: ["fmt"], reviewerPresent: true }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual([])
    expect(states()?.fmt?.status).toBe("skipped")
  })

  it("a continuation that does not run it, over a Final take, runs what follows", async () => {
    mocks.workflows.set("wf-2", outer({ reviewBeforeRender: true }))
    madeTake("final")
    await processWorkflowExecution(outerJob({ continueFromExecutionId: "exec-0", nodeIds: ["fmt"], reviewerPresent: true }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["fmt"])
  })
})

describe("a review-on Tighten Episode fed by a list is refused where it would fan out", () => {
  const listed = (data: Record<string, unknown>, urls: string[]) => ({
    nodes: [
      {
        id: "ls", type: "list",
        data: { label: "Episodes", columns: [{ id: "default", name: "Items", handleId: "col_default", type: "video-url" }], rows: urls.map((u) => [u]) },
      },
      { id: "t1", type: "tighten-episode", data },
      { id: "fmt", type: "social-media-format", data: {} },
    ],
    edges: [
      { id: "e1", source: "ls", target: "t1", sourceHandle: "col_default", targetHandle: "media", data: { outputMode: "each" } },
      { id: "e2", source: "t1", target: "fmt", sourceHandle: "media", targetHandle: "in" },
    ],
    settings: {},
    user_id: OWNER,
  })
  const listJob = () =>
    inlineJob({ inlineGraph: undefined, wrapperJobId: undefined, workflowId: "wf-3", triggerType: "manual", reviewerPresent: true })
  const states = () =>
    (mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => (u as { node_states?: Record<string, NodeExecutionState> }).node_states).filter(Boolean).pop() ?? {}) as Record<string, NodeExecutionState>

  it("review on, two items: the node fails with the refusal before any item runs; what follows does not run", async () => {
    mocks.workflows.set("wf-3", listed({ reviewBeforeRender: true }, ["https://r2/a.mp4", "https://r2/b.mp4"]))
    await processWorkflowExecution(listJob())
    expect(ran()).toEqual([])
    expect(states().t1).toMatchObject({
      status: "failed",
      errorCode: USE_CASE_REVIEW_LIST_DRIVEN,
      error: USE_CASE_REVIEW_LIST_DRIVEN_MESSAGE,
    })
    expect(states().fmt?.status).not.toBe("completed")
  })

  it("the refusal holds with the stop-rule flag off too", async () => {
    flag.on = false
    mocks.workflows.set("wf-3", listed({ reviewBeforeRender: true }, ["https://r2/a.mp4", "https://r2/b.mp4"]))
    await processWorkflowExecution(listJob())
    expect(ran()).toEqual([])
    expect(states().t1).toMatchObject({ status: "failed", errorCode: USE_CASE_REVIEW_LIST_DRIVEN })
  })

  it("review off, two items: one run per item", async () => {
    mocks.workflows.set("wf-3", listed({ reviewBeforeRender: false }, ["https://r2/a.mp4", "https://r2/b.mp4"]))
    await processWorkflowExecution(listJob())
    expect(mocks.executeNodeCalls.filter((c) => c.id === "t1")).toHaveLength(2)
  })

  it("review on, one item: no fan-out, so it runs (and holds what follows) as any review-on node", async () => {
    mocks.workflows.set("wf-3", listed({ reviewBeforeRender: true }, ["https://r2/a.mp4"]))
    await processWorkflowExecution(listJob())
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["t1"])
  })
  it("a Trailer (its own result is a list) with review off, two items: refused before any item runs", async () => {
    const graph = listed({ reviewBeforeRender: false }, ["https://r2/a.mp4", "https://r2/b.mp4"])
    mocks.workflows.set("wf-3", { ...graph, nodes: graph.nodes.map((n) => (n.id === "t1" ? { ...n, type: "episode-trailer" } : n)) })
    await processWorkflowExecution(listJob())
    expect(ran()).toEqual([])
    expect(states().t1).toMatchObject({ status: "failed", errorCode: USE_CASE_LIST_DRIVEN, error: "Trailer takes one recording. Use a separate workflow run for each recording." })
    expect(states().fmt?.status).not.toBe("completed")
  })
})

describe("a Trailer tries every format (decided 2026-10-18): one failure never stops the rest", () => {
  type Call = { id: string; data?: Record<string, unknown> }
  const reset = () => {
    mocks.executeNode.mockReset()
    mocks.executeNode.mockImplementation(async (node: Call, inputs: Record<string, unknown>) => {
      mocks.executeNodeCalls.push({ id: node.id, inputs, data: { ...(node.data ?? {}) } })
      return { output: { videoUrl: `https://r2/${node.id}.mp4` }, creditsUsed: 1 }
    })
  }
  const FORMAT_IDS = ["uc-format-9x16", "uc-format-1x1", "uc-format-4x5"]
  /**
   * The first format (9:16) fails at once while 1:1 is still rendering. Two at
   * a time (the free tier), so under fail-fast 4:5 would never start. `onFormat`
   * runs as each format starts.
   */
  function steps(onFormat?: (id: string) => void) {
    mocks.executeNode.mockImplementation((async (node: Call, inputs: Record<string, unknown>) => {
      mocks.executeNodeCalls.push({ id: node.id, inputs, data: { ...(node.data ?? {}) } })
      if (node.id.startsWith("uc-format-")) {
        onFormat?.(node.id)
        if (node.id === "uc-format-9x16") throw new Error("format failed")
        await new Promise((r) => setTimeout(r, 10))
        return { output: { videoUrl: `https://r2/${node.id}.mp4` }, creditsUsed: 22 }
      }
      switch (node.id) {
        case "uc-transcribe":
          return { output: { json: { words: [] } }, creditsUsed: 1 }
        case "uc-plan":
          return { output: { json: { version: 1, sources: [], segments: [] } }, creditsUsed: 1 }
        case "uc-render":
          return { output: { videoUrl: "https://r2/trailer.mp4", quality: node.data?.quality }, creditsUsed: 11 }
        default:
          return { output: { videoUrl: `https://r2/${node.id}.mp4` }, creditsUsed: 0 }
      }
    }) as never)
  }
  const twoAtATime = { userId: OWNER, payer: "deployment", entitlements: { parallelism: 2 } }
  const trailer = (over: Partial<typeof EPISODE_TRAILER_DEFAULTS> = {}) => {
    const settings = { ...EPISODE_TRAILER_DEFAULTS, ...over }
    return toStoredInlineGraph(buildEpisodeTrailerGraph(settings, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } }), settings)
  }
  const formatCalls = () => mocks.executeNodeCalls.filter((c) => c.id.startsWith("uc-format-")).map((c) => c.id)
  const lastStates = () =>
    (mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => (u as { node_states?: Record<string, NodeExecutionState> }).node_states).filter(Boolean).pop() ?? {}) as Record<string, NodeExecutionState>
  const statusWrite = (status: string) => mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === status)

  it("a first run, 9:16 fails: all three are tried, two are delivered, 9:16 alone is named, and the run keeps them", async () => {
    const g = trailer()
    inline.graph = g
    steps()
    try {
      await processWorkflowExecution(inlineJob({ billingContext: twoAtATime as never }))
    } finally {
      reset()
    }
    expect(formatCalls().sort()).toEqual([...FORMAT_IDS].sort())
    // The run failed (a step failed); the wrapper keeps what rendered.
    expect(failedWrite()).toBeDefined()
    const states = lastStates()
    expect(states["uc-format-9x16"]!.status).toBe("failed")
    expect(states["uc-format-1x1"]!.status).toBe("completed")
    expect(states["uc-format-4x5"]!.status).toBe("completed")
    const out = usecaseWrapperOutput(g, states as Record<string, unknown>, "exec-1")
    expect(out.formats).toEqual([
      { format: "1:1", url: "https://r2/uc-format-1x1.mp4" },
      { format: "4:5", url: "https://r2/uc-format-4x5.mp4" },
    ])
    expect(out.failedFormats).toEqual(["9:16"])
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(true)
  })

  it("a Render final, 9:16 fails: all three are tried, two are delivered, 9:16 alone is named", async () => {
    const g = trailer({ reviewBeforeRender: true })
    inline.graph = g
    const done = (nodeType: string, output: Record<string, unknown>) => ({ status: "completed", nodeType, jobId: `j-${nodeType}`, output, completedAt: at })
    mocks.executions.set("exec-0", {
      id: "exec-0", user_id: OWNER, workflow_id: null, status: "completed", inline_graph: g,
      node_states: {
        "uc-source": { status: "completed", output: { videoUrl: "https://r2/ep.mp4" }, completedAt: at, fromSavedData: true },
        "uc-transcribe": done("transcribe", { json: { words: [] } }),
        "uc-plan": done("edit-plan", { json: { version: 1, sources: [], segments: [] } }),
        "uc-render": done("apply-edl", { videoUrl: "https://r2/preview.mp4", quality: "proxy" }),
      },
    })
    const runSet = renderFinalRunSet("uc-render", g.nodes, g.edges)
    steps()
    try {
      await processWorkflowExecution(inlineJob({
        executionId: "exec-2", continueFromExecutionId: "exec-0", reviewerPresent: false, billingContext: twoAtATime as never,
        nodeIds: g.nodes.map((n) => n.id).filter((id) => runSet.has(id)), inputOverrides: renderRunOverrides("uc-render", "final", runSet),
      }))
    } finally {
      reset()
    }
    expect(dataOf("uc-render")).toMatchObject({ quality: "final" })
    expect(formatCalls().sort()).toEqual([...FORMAT_IDS].sort())
    const out = usecaseWrapperOutput(g, lastStates() as Record<string, unknown>, "exec-2")
    expect(out.formats!.map((f) => f.format)).toEqual(["1:1", "4:5"])
    expect(out.failedFormats).toEqual(["9:16"])
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(true)
  })

  it("a Stop mid-stage starts no further format: the held one is neither delivered nor named failed, and the run is cancelled", async () => {
    const g = trailer()
    inline.graph = g
    // A Stop lands while 9:16 and 1:1 are running (4:5 waits for a slot).
    steps((id) => {
      if (id === "uc-format-1x1") mocks.executions.set("exec-1", { status: "cancelled" })
    })
    try {
      await processWorkflowExecution(inlineJob({ billingContext: twoAtATime as never }))
    } finally {
      reset()
    }
    expect(formatCalls().sort()).toEqual(["uc-format-1x1", "uc-format-9x16"])
    expect(statusWrite("completed")).toBeUndefined()
    expect(statusWrite("cancelled")).toBeDefined()
    const states = lastStates()
    expect(states["uc-format-4x5"]!.status).toBe("skipped")
    const out = usecaseWrapperOutput(g, states as Record<string, unknown>, "exec-1")
    expect(out.formats!.map((f) => f.format)).toEqual(["1:1"])
    expect(out.failedFormats).toEqual(["9:16"])
  })

  /** Every format renders; `onFormat` runs as each one starts. */
  function allRender(onFormat: (id: string) => void) {
    mocks.executeNode.mockImplementation((async (node: Call, inputs: Record<string, unknown>) => {
      mocks.executeNodeCalls.push({ id: node.id, inputs, data: { ...(node.data ?? {}) } })
      if (node.id.startsWith("uc-format-")) {
        onFormat(node.id)
        await new Promise((r) => setTimeout(r, 10))
        return { output: { videoUrl: `https://r2/${node.id}.mp4` }, creditsUsed: 22 }
      }
      return node.id === "uc-render"
        ? { output: { videoUrl: "https://r2/trailer.mp4", quality: node.data?.quality }, creditsUsed: 11 }
        : { output: { json: { version: 1, sources: [], segments: [], words: [] } }, creditsUsed: 1 }
    }) as never)
  }

  it("a Stop as the first format starts: what started is delivered by its own result, the rest are skipped, and the run is cancelled (no fee kept)", async () => {
    const g = trailer()
    inline.graph = g
    // Two at a time: 9:16 and 1:1 have both passed their Stop check when the Stop lands; 4:5 has not.
    allRender((id) => {
      if (id === "uc-format-9x16") mocks.executions.set("exec-1", { status: "cancelled" })
    })
    try {
      await processWorkflowExecution(inlineJob({ billingContext: twoAtATime as never }))
    } finally {
      reset()
    }
    expect(formatCalls().sort()).toEqual(["uc-format-1x1", "uc-format-9x16"])
    const states = lastStates()
    expect(states["uc-format-9x16"]!.status).toBe("completed")
    expect(states["uc-format-1x1"]!.status).toBe("completed")
    expect(states["uc-format-4x5"]).toMatchObject({ status: "skipped" })
    expect(states["uc-format-4x5"]).not.toHaveProperty("error")
    expect(statusWrite("cancelled")).toBeDefined()
    expect(statusWrite("completed")).toBeUndefined()
    expect(statusWrite("failed")).toBeUndefined()
    // The run ends cancelled, and the finaliser settles the wrapper from that: a cancelled run keeps
    // nothing, its fee refunded (finalize-wrapper.test "a cancelled run keeps nothing").
    expect(fin.finalize).toHaveBeenCalledWith("exec-1", "job-w")
    const out = usecaseWrapperOutput(g, states as Record<string, unknown>, "exec-1")
    expect(out.failedFormats).toBeUndefined()
  })

  it("a format held back by anything but a Stop is a failure, named as one (never skipped)", async () => {
    const g = trailer()
    inline.graph = g
    // 4:5's own Stop check cannot read the run: it never starts, and no Stop was asked for.
    let reads = 0
    allRender((id) => {
      if (id !== "uc-format-1x1") return
      mocks.executions.set("exec-1", {
        get status() {
          reads++
          if (reads === 1) throw new Error("status read failed")
          return "running"
        },
      })
    })
    try {
      await processWorkflowExecution(inlineJob({ billingContext: twoAtATime as never }))
    } finally {
      reset()
    }
    expect(formatCalls().sort()).toEqual(["uc-format-1x1", "uc-format-9x16"])
    const states = lastStates()
    expect(states["uc-format-4x5"]).toMatchObject({ status: "failed", error: "status read failed" })
    expect(statusWrite("cancelled")).toBeUndefined()
    expect(statusWrite("completed")).toBeUndefined()
    expect(failedWrite()).toBeDefined()
    const out = usecaseWrapperOutput(g, states as Record<string, unknown>, "exec-1")
    expect(out.formats!.map((f) => f.format)).toEqual(["9:16", "1:1"])
    expect(out.failedFormats).toEqual(["4:5"])
  })

  it("the switch is the Trailer's own: the same chain as a saved workflow keeps the engine's default (the first failure stops what has not started)", async () => {
    const g = trailer()
    mocks.workflows.set("wf-1", { nodes: g.nodes, edges: g.edges, settings: {}, user_id: OWNER })
    steps()
    try {
      await processWorkflowExecution(inlineJob({ inlineGraph: undefined, wrapperJobId: undefined, workflowId: "wf-1", triggerType: "manual", billingContext: twoAtATime as never }))
    } finally {
      reset()
    }
    expect(formatCalls().sort()).toEqual(["uc-format-1x1", "uc-format-9x16"])
    expect(lastStates()["uc-format-4x5"]).toMatchObject({ status: "failed", error: "Execution cancelled" })
  })
})
