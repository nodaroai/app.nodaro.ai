/**
 * THE PREVIEW STOP RULE — REAL orchestrator path.
 *
 * A run stops at a Preview render: the render runs, everything forward of it
 * is seeded `skipped` before levels are built — never dispatched, never
 * counted, never billed — and the execution ends `completed`. A run nobody can
 * review (`reviewerPresent: false`) holding a Preview render is refused before
 * any node runs, and so is any run whose sub-workflow or component holds one.
 *
 * Drives `processWorkflowExecution` with only leaf I/O mocked (the harness of
 * transcribe-preflight-nested-orchestrator.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import { PREVIEW_REVIEW_REQUIRED, PREVIEW_RENDER_NESTED } from "@nodaro/shared"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  const executeNode = vi.fn(async (node: { id: string }) => {
    executeNodeCalls.push(node.id)
    return { output: { videoUrl: `https://r2/${node.id}.mp4` }, creditsUsed: 1 }
  })
  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })
  const directUpdates: Array<Record<string, unknown>> = []
  const workflows = new Map<string, Record<string, unknown>>()
  const apps = new Map<string, Record<string, unknown>>()
  const execSelectRow = { status: "queued", node_states: {} }

  function chain(table: string, columns?: string) {
    const filters: Record<string, unknown> = {}
    const resolve = () => {
      if (table === "workflows") {
        const row = workflows.get(filters.id as string)
        if (!row) return { data: null, error: { message: "nf" } }
        if (filters.user_id !== undefined && row.user_id !== filters.user_id) return { data: null, error: { message: "nf" } }
        return { data: row, error: null }
      }
      if (table === "published_apps") {
        const row = apps.get(filters.id as string)
        return row ? { data: row, error: null } : { data: null, error: { message: "nf" } }
      }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states") return { data: execSelectRow, error: null }
      return { data: null, error: null }
    }
    const self = {
      eq: (column: string, value: unknown) => {
        filters[column] = value
        return self
      },
      is: () => self,
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

  // PREVIEW_STOP_RULE_ENABLED (decided 2026-10-05): on unless a test turns it off.
  const flag = { on: true }

  return { executeNode, executeNodeCalls, updateExecutionWithRetry, directUpdates, from, workflows, apps, execSelectRow, flag }
})

vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => mocks.flag.on }))

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

import { processWorkflowExecution } from "../orchestrator-worker.js"

const OWNER = "owner-1"

/** script → render(quality) → captions → output. The script is not a source,
 *  so it runs: it stands for the upstream that bills. */
function tighten(quality: "proxy" | "final") {
  return {
    nodes: [
      { id: "plan", type: "llm-chat", data: { prompt: "plan" } },
      { id: "cut", type: "apply-edl", data: { quality } },
      { id: "cap", type: "add-captions", data: {} },
      { id: "out", type: "video-retake", data: {} },
    ],
    edges: [
      { id: "e1", source: "plan", target: "cut", sourceHandle: null, targetHandle: "edl" },
      { id: "e2", source: "cut", target: "cap", sourceHandle: null, targetHandle: null },
      { id: "e3", source: "cap", target: "out", sourceHandle: null, targetHandle: null },
    ],
  }
}

function job(data: Partial<WorkflowExecutionJob>): Job<WorkflowExecutionJob> {
  return {
    data: { executionId: "exec-1", workflowId: "wf-1", userId: OWNER, triggerType: "manual", ...data },
  } as unknown as Job<WorkflowExecutionJob>
}

function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === "failed")
  return call?.[1] as { error_message?: string } | undefined
}
function completedWrite(): Record<string, unknown> | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === "completed")
  return call?.[1] as Record<string, unknown> | undefined
}
const startedWrite = () => mocks.directUpdates.find((u) => u.status === "running")

beforeEach(() => {
  mocks.executeNode.mockClear()
  mocks.executeNodeCalls.length = 0
  mocks.updateExecutionWithRetry.mockClear()
  mocks.directUpdates.length = 0
  mocks.workflows.clear()
  mocks.apps.clear()
  mocks.execSelectRow.status = "queued"
  mocks.execSelectRow.node_states = {}
  mocks.flag.on = true
})

describe("the stop: a run stops at its Preview render", () => {
  it("runs the upstream and the render, never the tail, and ends completed", async () => {
    mocks.workflows.set("wf-1", { ...tighten("proxy"), settings: {}, user_id: OWNER })
    await processWorkflowExecution(job({ reviewerPresent: true }))

    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNodeCalls.sort()).toEqual(["cut", "plan"])
    const done = completedWrite()!
    const states = done.node_states as Record<string, { status: string }>
    expect(states.cap.status).toBe("skipped")
    expect(states.out.status).toBe("skipped")
    // The tail is never counted: 2 executed of 2 counted.
    expect(startedWrite()!.total_nodes).toBe(2)
    expect(done.completed_nodes).toBe(2)
  })

  it("a Final override on the render (Render final) lifts the stop", async () => {
    mocks.workflows.set("wf-1", { ...tighten("proxy"), settings: {}, user_id: OWNER })
    await processWorkflowExecution(job({ reviewerPresent: true, inputOverrides: { cut: { quality: "final" } } }))
    expect(mocks.executeNodeCalls.sort()).toEqual(["cap", "cut", "out", "plan"])
    expect(startedWrite()!.total_nodes).toBe(4)
  })

  it("a Final render runs the whole graph", async () => {
    mocks.workflows.set("wf-1", { ...tighten("final"), settings: {}, user_id: OWNER })
    await processWorkflowExecution(job({ reviewerPresent: true }))
    expect(mocks.executeNodeCalls.sort()).toEqual(["cap", "cut", "out", "plan"])
  })

  it("a Run from here past the render skips a gated node it was asked to run", async () => {
    mocks.workflows.set("wf-1", { ...tighten("proxy"), settings: {}, user_id: OWNER })
    await processWorkflowExecution(job({ reviewerPresent: true, nodeIds: ["cut", "cap", "out"] }))
    expect(mocks.executeNodeCalls).toEqual(["cut"])
    expect(completedWrite()).toBeDefined()
  })
})

describe("a resumed run (drain hand-off / crash re-pick)", () => {
  it("carries the gated tail forward without counting it, so progress never overshoots", async () => {
    mocks.workflows.set("wf-1", { ...tighten("proxy"), settings: {}, user_id: OWNER })
    // What the first pick persisted before it drained mid-render: the upstream
    // done, the gated tail seeded skipped, the render still in flight.
    const at = new Date().toISOString()
    mocks.execSelectRow.status = "running"
    mocks.execSelectRow.node_states = {
      plan: { status: "completed", nodeType: "llm-chat", completedAt: at, output: { text: "plan" } },
      cut: { status: "running", nodeType: "apply-edl" },
      cap: { status: "skipped", nodeType: "add-captions", completedAt: at },
      out: { status: "skipped", nodeType: "video-retake", completedAt: at },
    } as never
    await processWorkflowExecution(job({ reviewerPresent: true }))

    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNodeCalls).toEqual(["cut"])
    const done = completedWrite()!
    expect(startedWrite()!.total_nodes).toBe(2)
    expect(done.completed_nodes).toBe(2)
  })
})

describe("nobody to review (reviewerPresent false)", () => {
  it("refuses before any node runs, with the stable code", async () => {
    mocks.workflows.set("wf-1", { ...tighten("proxy"), settings: {}, user_id: OWNER })
    await processWorkflowExecution(job({ triggerType: "api", reviewerPresent: false }))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toBe(PREVIEW_REVIEW_REQUIRED)
  })


  it("runs when the call overrides the render to Final", async () => {
    mocks.workflows.set("wf-1", { ...tighten("proxy"), settings: {}, user_id: OWNER })
    await processWorkflowExecution(
      job({ triggerType: "api", reviewerPresent: false, inputOverrides: { cut: { quality: "final" } } }),
    )
    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNodeCalls.sort()).toEqual(["cap", "cut", "out", "plan"])
  })

  it("an app run of a Preview snapshot refuses (apps count as nobody to review)", async () => {
    mocks.apps.set("app-1", {
      snapshot_nodes: tighten("proxy").nodes,
      snapshot_edges: tighten("proxy").edges,
      snapshot_settings: {},
      creator_id: OWNER,
      publish_type: "app",
    })
    await processWorkflowExecution(job({ triggerType: "app_run", appVersionId: "app-1", reviewerPresent: false }))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toBe(PREVIEW_REVIEW_REQUIRED)
  })
})

describe("nested graphs (refused permanently)", () => {
  it("a sub-workflow holding a Preview render is refused before the parent's upstream bills", async () => {
    mocks.workflows.set("wf-1", {
      nodes: [
        { id: "gv1", type: "generate-video", data: { prompt: "a cat" } },
        { id: "sw1", type: "sub-workflow", data: { workflowId: "wf-child" } },
      ],
      edges: [{ id: "e1", source: "gv1", target: "sw1", sourceHandle: null, targetHandle: null }],
      settings: {},
      user_id: OWNER,
    })
    mocks.workflows.set("wf-child", { ...tighten("proxy"), user_id: OWNER })
    await processWorkflowExecution(job({ reviewerPresent: true }))
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toBe(PREVIEW_RENDER_NESTED)
  })

  it("a component's inner run of a Preview snapshot is refused with the nested code", async () => {
    mocks.apps.set("comp-1", {
      snapshot_nodes: tighten("proxy").nodes,
      snapshot_edges: tighten("proxy").edges,
      snapshot_settings: {},
      creator_id: OWNER,
      publish_type: "component",
    })
    await processWorkflowExecution(
      job({ triggerType: "app_run", appVersionId: "comp-1", reviewerPresent: false, isComponentExecution: true }),
    )
    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()!.error_message).toBe(PREVIEW_RENDER_NESTED)
  })

  it("a component version published before the publish check is caught by its publish type", async () => {
    mocks.apps.set("comp-1", {
      snapshot_nodes: tighten("proxy").nodes,
      snapshot_edges: tighten("proxy").edges,
      snapshot_settings: {},
      creator_id: OWNER,
      publish_type: "component",
    })
    await processWorkflowExecution(job({ triggerType: "app_run", appVersionId: "comp-1", reviewerPresent: false }))
    expect(failedWrite()!.error_message).toBe(PREVIEW_RENDER_NESTED)
  })
})

/** A run of each gated scenario, and what it must do when the stop rule does
 *  not apply: exactly what dev did before the rule existed — the whole graph
 *  runs and is counted, and nothing is refused. */
const PRE_RULE_SCENARIOS: Array<{ name: string; setup: () => void; job: Partial<WorkflowExecutionJob>; runs: string[]; total: number }> = [
  {
    name: "an editor run of a Preview render runs the tail",
    setup: () => mocks.workflows.set("wf-1", { ...tighten("proxy"), settings: {}, user_id: OWNER }),
    job: { reviewerPresent: true },
    runs: ["cap", "cut", "out", "plan"],
    total: 4,
  },
  {
    name: "a run nobody can review is not refused",
    setup: () => mocks.workflows.set("wf-1", { ...tighten("proxy"), settings: {}, user_id: OWNER }),
    job: { triggerType: "api", reviewerPresent: false },
    runs: ["cap", "cut", "out", "plan"],
    total: 4,
  },
  {
    name: "an app run of a Preview snapshot is not refused",
    setup: () =>
      mocks.apps.set("app-1", {
        snapshot_nodes: tighten("proxy").nodes,
        snapshot_edges: tighten("proxy").edges,
        snapshot_settings: {},
        creator_id: OWNER,
        publish_type: "app",
      }),
    job: { triggerType: "app_run", appVersionId: "app-1", reviewerPresent: false },
    runs: ["cap", "cut", "out", "plan"],
    total: 4,
  },
  {
    name: "a component's inner run of a Preview snapshot is not refused",
    setup: () =>
      mocks.apps.set("comp-1", {
        snapshot_nodes: tighten("proxy").nodes,
        snapshot_edges: tighten("proxy").edges,
        snapshot_settings: {},
        creator_id: OWNER,
        publish_type: "component",
      }),
    job: { triggerType: "app_run", appVersionId: "comp-1", reviewerPresent: false, isComponentExecution: true },
    runs: ["cap", "cut", "out", "plan"],
    total: 4,
  },
  {
    name: "a sub-workflow holding a Preview render is not refused",
    setup: () => {
      mocks.workflows.set("wf-1", {
        nodes: [
          { id: "gv1", type: "generate-video", data: { prompt: "a cat" } },
          { id: "sw1", type: "sub-workflow", data: { workflowId: "wf-child" } },
        ],
        edges: [{ id: "e1", source: "gv1", target: "sw1", sourceHandle: null, targetHandle: null }],
        settings: {},
        user_id: OWNER,
      })
      mocks.workflows.set("wf-child", { ...tighten("proxy"), user_id: OWNER })
    },
    job: { reviewerPresent: true },
    runs: ["gv1", "sw1"],
    total: 2,
  },
]

describe("PREVIEW_STOP_RULE_ENABLED off (production until Render final): dev before the rule", () => {
  for (const scenario of PRE_RULE_SCENARIOS) {
    it(scenario.name, async () => {
      mocks.flag.on = false
      scenario.setup()
      await processWorkflowExecution(job(scenario.job))
      expect(failedWrite()).toBeUndefined()
      expect(mocks.executeNodeCalls.sort()).toEqual(scenario.runs)
      expect(startedWrite()!.total_nodes).toBe(scenario.total)
      expect(completedWrite()!.completed_nodes).toBe(scenario.total)
    })
  }
})

describe("a job queued before the deploy (no reviewerPresent field): the pre-deploy behaviour, flag on", () => {
  const legacy = (data: Partial<WorkflowExecutionJob>): Partial<WorkflowExecutionJob> => {
    const { reviewerPresent: _dropped, ...rest } = data
    return rest
  }
  for (const scenario of PRE_RULE_SCENARIOS) {
    it(scenario.name, async () => {
      scenario.setup()
      const data = legacy(scenario.job)
      expect("reviewerPresent" in data).toBe(false)
      await processWorkflowExecution(job(data))
      expect(failedWrite()).toBeUndefined()
      expect(mocks.executeNodeCalls.sort()).toEqual(scenario.runs)
      expect(startedWrite()!.total_nodes).toBe(scenario.total)
    })
  }

  // The real legacy shape at a component hop: the PARENT was queued before the
  // deploy, but its component's inner run is a NEW job (executeAppRun always
  // stamps `reviewerPresent: false`). The parent's answer rides the hop as
  // `previewStopRule: false`, and the inner run must run as the parent would
  // have before the deploy. (The component scenario above strips the field
  // from the INNER job, a shape no producer emits.)
  it("a component's inner run for a parent the rule does not apply to runs whole", async () => {
    mocks.apps.set("comp-1", {
      snapshot_nodes: tighten("proxy").nodes,
      snapshot_edges: tighten("proxy").edges,
      snapshot_settings: {},
      creator_id: OWNER,
      publish_type: "component",
    })
    await processWorkflowExecution(
      job({
        triggerType: "app_run",
        appVersionId: "comp-1",
        reviewerPresent: false,
        isComponentExecution: true,
        previewStopRule: false,
      }),
    )
    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNodeCalls.sort()).toEqual(["cap", "cut", "out", "plan"])
    expect(startedWrite()!.total_nodes).toBe(4)
  })

  it.each([[true], [undefined]])(
    "a component's inner run for a parent the rule applies to (previewStopRule %s) is still refused",
    async (previewStopRule) => {
      mocks.apps.set("comp-1", {
        snapshot_nodes: tighten("proxy").nodes,
        snapshot_edges: tighten("proxy").edges,
        snapshot_settings: {},
        creator_id: OWNER,
        publish_type: "component",
      })
      await processWorkflowExecution(
        job({
          triggerType: "app_run",
          appVersionId: "comp-1",
          reviewerPresent: false,
          isComponentExecution: true,
          ...(previewStopRule === undefined ? {} : { previewStopRule }),
        }),
      )
      expect(mocks.executeNodeCalls).toEqual([])
      expect(failedWrite()!.error_message).toBe(PREVIEW_RENDER_NESTED)
    },
  )

  it("the same graph WITH the field is still stopped (the flag is on)", async () => {
    mocks.workflows.set("wf-1", { ...tighten("proxy"), settings: {}, user_id: OWNER })
    await processWorkflowExecution(job({ triggerType: "api", reviewerPresent: false }))
    expect(failedWrite()!.error_message).toBe(PREVIEW_REVIEW_REQUIRED)
  })
})
