/**
 * A CONTINUED run — REAL orchestrator path (A6.2; TA11, decided 2026-10-04).
 *
 * Render final after a run that stopped at its preview: the continuation runs
 * the render (overridden to Final) and the tail, and every node it does not run
 * hands on what the EARLIER execution produced — its `node_states`, with an Edit
 * Plan's review applied — never the workflow's saved results. It is refused,
 * before any node runs, when the earlier execution is not the caller's own
 * completed run of this workflow and this version of its graph.
 *
 * Drives `processWorkflowExecution` with only leaf I/O mocked (the harness of
 * preview-gate-orchestrator.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import {
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_NOT_FOUND,
  CONTINUATION_SUBSET_REQUIRED,
  CONTINUATION_VERSION_MISMATCH,
  CONTINUATION_WORKFLOW_MISMATCH,
  PREVIEW_REVIEW_REQUIRED,
  editPlanBasis,
} from "@nodaro/shared"
import type { NodeExecutionState, ResolvedInputs, WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

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

vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
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
const at = "2026-10-05T10:00:00.000Z"

const planned = {
  version: 1,
  sources: [{ id: "s0", url: "https://r2/master.mp4", role: "master" }],
  segments: [
    { id: "seg-0", sourceId: "s0", inMs: 0, outMs: 4000 },
    { id: "seg-1", sourceId: "s0", inMs: 6000, outMs: 9000 },
  ],
  dropped: [{ sourceId: "s0", inMs: 4000, outMs: 6000, reason: "silence" }],
}
const editedSegments = [{ id: "seg-0", sourceId: "s0", inMs: 0, outMs: 9000 }]
const review = { v: 1, kind: "edl", basis: editPlanBasis(planned), edl: { segments: editedSegments, dropped: [] } }
/** What the canvas holds: an OLDER plan (the editor was closed when the run ended), and the review of the run's plan. */
const stalePlan = { ...planned, segments: [planned.segments[1]] }

/** recording → plan → render(Preview) → captions → retake. */
function tighten(extra: { planData?: Record<string, unknown> } = {}) {
  return {
    nodes: [
      { id: "rec", type: "upload-video", data: { videoUrl: "https://r2/canvas.mp4" } },
      { id: "plan", type: "edit-plan", data: { generatedJson: stalePlan, editedEdl: review, ...(extra.planData ?? {}) } },
      { id: "cut", type: "apply-edl", data: { quality: "proxy", output: "video" } },
      { id: "cap", type: "add-captions", data: {} },
      { id: "out", type: "video-retake", data: {} },
    ],
    edges: [
      { id: "e0", source: "rec", target: "plan", sourceHandle: null, targetHandle: "media" },
      { id: "e1", source: "plan", target: "cut", sourceHandle: "edl", targetHandle: "edl" },
      { id: "e2", source: "cut", target: "cap", sourceHandle: null, targetHandle: null },
      { id: "e3", source: "cap", target: "out", sourceHandle: null, targetHandle: null },
    ],
  }
}

/** The run that stopped at its preview. */
function stoppedRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const states: Record<string, NodeExecutionState> = {
    rec: { status: "completed", output: { videoUrl: "https://r2/recording.mp4" }, completedAt: at, fromSavedData: true },
    plan: { status: "completed", nodeType: "edit-plan", jobId: "job-plan", startedAt: at, completedAt: at, output: { json: planned } },
    cut: {
      status: "completed",
      nodeType: "apply-edl",
      jobId: "job-cut",
      startedAt: at,
      completedAt: at,
      output: { videoUrl: "https://r2/preview.mp4", quality: "proxy" },
    },
    cap: { status: "skipped", nodeType: "add-captions", completedAt: at },
    out: { status: "skipped", nodeType: "video-retake", completedAt: at },
  }
  return { id: "exec-0", user_id: OWNER, workflow_id: "wf-1", status: "completed", node_states: states, ...overrides }
}

function job(data: Partial<WorkflowExecutionJob>): Job<WorkflowExecutionJob> {
  return {
    data: {
      executionId: "exec-1",
      workflowId: "wf-1",
      userId: OWNER,
      triggerType: "manual",
      reviewerPresent: true,
      continueFromExecutionId: "exec-0",
      nodeIds: ["cut", "cap", "out"],
      inputOverrides: { cut: { quality: "final" } },
      ...data,
    },
  } as unknown as Job<WorkflowExecutionJob>
}

const ran = () => mocks.executeNodeCalls.map((c) => c.id).sort()
const dataOf = (id: string) => mocks.executeNodeCalls.find((c) => c.id === id)?.data
const inputsOf = (id: string) => mocks.executeNodeCalls.find((c) => c.id === id)?.inputs as ResolvedInputs | undefined
function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === "failed")
  return call?.[1] as { error_message?: string } | undefined
}
function completedWrite(): Record<string, unknown> | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === "completed")
  return call?.[1] as Record<string, unknown> | undefined
}

beforeEach(() => {
  mocks.executeNode.mockClear()
  mocks.executeNodeCalls.length = 0
  mocks.updateExecutionWithRetry.mockClear()
  mocks.directUpdates.length = 0
  mocks.workflows.clear()
  mocks.apps.clear()
  mocks.executions.clear()
  mocks.appRuns.clear()
  mocks.appRunInputs.clear()
  mocks.execSelectRow.status = "queued"
  mocks.execSelectRow.node_states = {}
  mocks.jobRows.length = 0
  mocks.workflows.set("wf-1", { ...tighten(), settings: {}, user_id: OWNER })
  mocks.executions.set("exec-0", stoppedRun())
})

describe("Render final as a continuation", () => {
  it("runs the render and the tail; the plan hands on the earlier run's plan with the review applied", async () => {
    await processWorkflowExecution(job({}))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["cap", "cut", "out"])
    // The render cuts the EARLIER RUN's plan as the person edited it — not the
    // older plan the canvas still holds, and not the planner's cut.
    const edl = JSON.parse(String(inputsOf("cut")!.edl)) as { segments: unknown; dropped: unknown }
    expect(edl.segments).toEqual(editedSegments)
    expect(edl.dropped).toEqual([])
  })

  it("the nodes it does not run carry the earlier run's states, marked as seeds; a source or a plan is never saved data", async () => {
    await processWorkflowExecution(job({}))
    const states = completedWrite()!.node_states as Record<string, NodeExecutionState>
    expect(states.rec).toMatchObject({ status: "completed", output: { videoUrl: "https://r2/recording.mp4" }, seededFromExecution: "exec-0" })
    expect(states.plan).toMatchObject({ status: "completed", seededFromExecution: "exec-0" })
    for (const id of ["rec", "plan"]) {
      expect(states[id].fromSavedData).toBeUndefined()
      expect(states[id].jobId).toBeUndefined()
      expect(states[id].startedAt).toBeUndefined()
    }
    // Only what ran is counted.
    expect(mocks.directUpdates.find((u) => u.status === "running")!.total_nodes).toBe(3)
  })

  it("a continuation of the tail alone, past a seeded Preview, stops there: no node consumes a preview", async () => {
    await processWorkflowExecution(job({ nodeIds: ["cap", "out"], inputOverrides: undefined }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual([])
    const states = completedWrite()!.node_states as Record<string, NodeExecutionState>
    expect(states.cap.status).toBe("skipped")
  })

  it("the same continuation with nobody to review is refused before anything runs", async () => {
    await processWorkflowExecution(job({ triggerType: "manual", reviewerPresent: false, nodeIds: ["cap", "out"], inputOverrides: undefined }))
    expect(ran()).toEqual([])
    expect(failedWrite()!.error_message).toBe(PREVIEW_REVIEW_REQUIRED)
  })

  it("an API continuation that renders the final runs (the override lifts the stop)", async () => {
    await processWorkflowExecution(job({ triggerType: "api", reviewerPresent: false }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["cap", "cut", "out"])
  })

  it("an app continuation of an app run of the same version seeds from that run", async () => {
    mocks.apps.set("app-1", {
      snapshot_nodes: tighten().nodes,
      snapshot_edges: tighten().edges,
      snapshot_settings: {},
      creator_id: "creator-1",
      publish_type: "app",
    })
    mocks.appRuns.set("exec-0", "app-1")
    await processWorkflowExecution(job({ appVersionId: "app-1", triggerType: "manual" }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["cap", "cut", "out"])
  })
})

describe("Round 2 (decided 2026-10-06): a continuation re-applies the input overrides the earlier run used", () => {
  /** The earlier execution was an app run of version app-1, with the person's inputs stored.
   *  The creator's snapshot renders at Final: a Preview can come only from the stored inputs. */
  function appRun(inputValues: Record<string, Record<string, unknown>>) {
    const snapshotNodes = tighten().nodes.map((n) => (n.id === "cut" ? { ...n, data: { ...n.data, quality: "final" } } : n))
    mocks.apps.set("app-1", {
      snapshot_nodes: snapshotNodes,
      snapshot_edges: tighten().edges,
      snapshot_settings: {},
      creator_id: "creator-1",
      publish_type: "app",
    })
    mocks.appRuns.set("exec-0", "app-1")
    mocks.appRunInputs.set("exec-0", inputValues)
  }

  it("an app continuation re-runs a node with the person's app inputs", async () => {
    appRun({ cap: { fontSize: 72 } })
    await processWorkflowExecution(job({ appVersionId: "app-1" }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["cap", "cut", "out"])
    // The captions node runs with what the person entered in the app, not the
    // creator's snapshot default; the render with the continuation's own override.
    expect(dataOf("cap")!.fontSize).toBe(72)
    expect(dataOf("cut")!.quality).toBe("final")
  })

  it("an explicit override sent with the continuation beats the stored one, field by field", async () => {
    appRun({ cut: { quality: "proxy", resolution: "1080p" }, cap: { fontSize: 48 } })
    await processWorkflowExecution(
      job({ appVersionId: "app-1", triggerType: "api", reviewerPresent: false, inputOverrides: { cut: { quality: "final" }, cap: { fontSize: 96 } } }),
    )
    // Stored "proxy" would stop a run with nobody to review; the explicit "final" lifts it.
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["cap", "cut", "out"])
    expect(dataOf("cut")).toMatchObject({ quality: "final", resolution: "1080p" })
    expect(dataOf("cap")!.fontSize).toBe(96)
  })

  it("with no explicit override, the stored one is what runs", async () => {
    appRun({ cut: { quality: "proxy" } })
    await processWorkflowExecution(job({ appVersionId: "app-1", triggerType: "api", reviewerPresent: false, inputOverrides: undefined }))
    expect(ran()).toEqual([])
    expect(failedWrite()!.error_message).toBe(PREVIEW_REVIEW_REQUIRED)
  })

  it("a stored override on a render the continuation does not run leaves its seed's stamp in charge: a Preview still stops", async () => {
    appRun({ cut: { output: "video" } })
    await processWorkflowExecution(job({ appVersionId: "app-1", nodeIds: ["cap", "out"], inputOverrides: undefined }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual([])
    expect((completedWrite()!.node_states as Record<string, NodeExecutionState>).cap.status).toBe("skipped")
  })

  it("a source the stored overrides cover keeps its saved-data provenance; one the continuation overrides again does not", async () => {
    appRun({ rec: { videoUrl: "https://r2/recording.mp4" } })
    await processWorkflowExecution(job({ appVersionId: "app-1" }))
    let states = completedWrite()!.node_states as Record<string, NodeExecutionState>
    expect(states.rec).toMatchObject({ fromSavedData: true, seededFromExecution: "exec-0" })

    mocks.updateExecutionWithRetry.mockClear()
    mocks.executeNodeCalls.length = 0
    await processWorkflowExecution(
      job({ appVersionId: "app-1", inputOverrides: { cut: { quality: "final" }, rec: { videoUrl: "https://r2/other.mp4" } } }),
    )
    states = completedWrite()!.node_states as Record<string, NodeExecutionState>
    expect(states.rec.fromSavedData).toBeUndefined()
    expect(states.rec.output).toEqual({ videoUrl: "https://r2/recording.mp4" })
  })
})

describe("Round 3 (decided 2026-10-06): the overrides are PINNED on the execution", () => {
  /** The same app as round 2: its snapshot renders at Final. */
  function appRun(inputValues: Record<string, Record<string, unknown>>) {
    const snapshotNodes = tighten().nodes.map((n) => (n.id === "cut" ? { ...n, data: { ...n.data, quality: "final" } } : n))
    mocks.apps.set("app-1", {
      snapshot_nodes: snapshotNodes,
      snapshot_edges: tighten().edges,
      snapshot_settings: {},
      creator_id: "creator-1",
      publish_type: "app",
    })
    mocks.appRuns.set("exec-0", "app-1")
    mocks.appRunInputs.set("exec-0", inputValues)
  }
  const pinWrite = () => mocks.directUpdates.find((u) => Object.hasOwn(u, "input_overrides"))

  it("a run pins the overrides it applies when it starts", async () => {
    await processWorkflowExecution(
      job({ continueFromExecutionId: undefined, nodeIds: undefined, inputOverrides: { cut: { quality: "final" } } }),
    )
    expect(pinWrite()).toEqual({ input_overrides: { cut: { quality: "final" } } })
  })

  it("a run with no overrides pins {}: it ran with none", async () => {
    await processWorkflowExecution(job({ continueFromExecutionId: undefined, nodeIds: undefined, inputOverrides: undefined }))
    expect(pinWrite()).toEqual({ input_overrides: {} })
  })

  it("a continuation pins what it applied: the earlier pin with its own overrides over it", async () => {
    mocks.executions.set("exec-0", stoppedRun({ input_overrides: { cap: { fontSize: 60 }, cut: { quality: "proxy" } } }))
    await processWorkflowExecution(job({}))
    expect(pinWrite()).toEqual({ input_overrides: { cap: { fontSize: 60 }, cut: { quality: "final" } } })
  })

  it("R2-2 (PATCH after the run): the app run's row differs from the execution's pin — the pin is what runs", async () => {
    appRun({ cap: { fontSize: 12 } })
    mocks.executions.set("exec-0", stoppedRun({ input_overrides: { cap: { fontSize: 72 } } }))
    await processWorkflowExecution(job({ appVersionId: "app-1" }))
    expect(failedWrite()).toBeUndefined()
    expect(dataOf("cap")!.fontSize).toBe(72)
  })

  it("R2-1 (a draft run with no inputs): the row keeps the draft's Preview, the pin says none — the run is not stopped by it", async () => {
    appRun({ cut: { quality: "proxy" } })
    mocks.executions.set("exec-0", stoppedRun({ input_overrides: {} }))
    await processWorkflowExecution(job({ appVersionId: "app-1", triggerType: "api", reviewerPresent: false, inputOverrides: undefined }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual(["cap", "cut", "out"])
    expect(dataOf("cut")!.quality).toBe("final")
  })

  it("a continuation of a live (/run) execution re-applies that execution's pin", async () => {
    mocks.executions.set("exec-0", stoppedRun({ input_overrides: { cap: { fontSize: 60 } } }))
    await processWorkflowExecution(job({}))
    expect(failedWrite()).toBeUndefined()
    expect(dataOf("cap")!.fontSize).toBe(60)
    expect(dataOf("cut")!.quality).toBe("final")
  })

  it("the pin covers a source for provenance exactly as the round-2 row did", async () => {
    appRun({})
    mocks.executions.set("exec-0", stoppedRun({ input_overrides: { rec: { videoUrl: "https://r2/recording.mp4" } } }))
    await processWorkflowExecution(job({ appVersionId: "app-1", inputOverrides: { cut: { quality: "final" }, rec: { videoUrl: "https://r2/recording.mp4" } } }))
    const states = completedWrite()!.node_states as Record<string, NodeExecutionState>
    expect(states.rec).toMatchObject({ fromSavedData: true, seededFromExecution: "exec-0" })
  })
})

describe("what the earlier run did not hand on", () => {
  it("a render it made before renders were labelled is stamped from its job, so a Preview still stops the run", async () => {
    const renderJob = "f0000000-0000-4000-8000-0000000e9001"
    const prior = stoppedRun()
    const states = prior.node_states as Record<string, NodeExecutionState>
    // No quality and, as a state may, no nodeType: render-ness comes from the graph.
    states.cut = { status: "completed", jobId: renderJob, startedAt: at, completedAt: at, output: { videoUrl: "https://r2/preview.mp4" } }
    mocks.executions.set("exec-0", prior)
    mocks.jobRows.push({
      id: renderJob,
      user_id: OWNER,
      status: "completed",
      job_type: "apply-edl",
      node_id: "cut",
      input_quality: "proxy",
      video_url: "https://r2/preview.mp4",
    })
    await processWorkflowExecution(job({ nodeIds: ["cap", "out"], inputOverrides: undefined }))
    expect(failedWrite()).toBeUndefined()
    expect(ran()).toEqual([])
    expect((completedWrite()!.node_states as Record<string, NodeExecutionState>).cap.status).toBe("skipped")
  })

  it("a node whose every upstream the earlier run did not complete is gated: it never runs on nothing", async () => {
    const prior = stoppedRun()
    const states = prior.node_states as Record<string, NodeExecutionState>
    states.plan = { status: "failed", nodeType: "edit-plan", jobId: "job-plan", startedAt: at, completedAt: at, error: "boom" }
    mocks.executions.set("exec-0", prior)
    await processWorkflowExecution(job({}))
    // The plan is outside the run: it never runs again (and is never billed
    // again), and nothing reads the canvas's older plan in its place. Its seed
    // is `skipped`, a dead source for the run-time gate (computeGatedIds), so
    // the render it alone feeds — and the tail behind it — is skipped rather
    // than run, and billed, with no plan.
    expect(ran()).toEqual([])
    expect(failedWrite()).toBeUndefined()
    const finalStates = completedWrite()!.node_states as Record<string, NodeExecutionState>
    expect(finalStates.plan).toMatchObject({ status: "skipped", seededFromExecution: "exec-0" })
    expect(finalStates.plan.output).toBeUndefined()
    for (const id of ["cut", "cap", "out"]) expect(finalStates[id].status, id).toBe("skipped")
  })
})

describe("a continuation of an execution that itself seeded nodes", () => {
  it("the plan held with an older review applied (a partial run, or a continuation): the review made since wins", async () => {
    const olderCut = { ...planned, segments: [planned.segments[1]], dropped: [] }
    const prior = stoppedRun()
    const states = prior.node_states as Record<string, NodeExecutionState>
    states.plan = { status: "completed", output: { json: olderCut, plannedJson: planned }, completedAt: at, fromSavedData: true }
    mocks.executions.set("exec-0", prior)
    await processWorkflowExecution(job({}))
    expect(failedWrite()).toBeUndefined()
    const edl = JSON.parse(String(inputsOf("cut")!.edl)) as { segments: unknown; dropped: unknown }
    expect(edl.segments).toEqual(editedSegments)
    expect(edl.dropped).toEqual([])
    const plan = (completedWrite()!.node_states as Record<string, NodeExecutionState>).plan
    expect(plan.output!.plannedJson).toEqual(planned)
    expect(plan.fromSavedData).toBeUndefined()
  })

  it("a node outside the earlier run's subset hands on every saved result it handed on there", async () => {
    const results = ["a", "b", "c", "d"].map((x) => ({ url: `https://r2/${x}.png` }))
    mocks.workflows.set("wf-1", {
      nodes: [
        { id: "img", type: "generate-image", data: { generatedImageUrl: results[0].url, generatedResults: results } },
        { id: "up", type: "upscale-image", data: {} },
      ],
      edges: [{ id: "e0", source: "img", target: "up", sourceHandle: null, targetHandle: null, data: { outputMode: "each" } }],
      settings: {},
      user_id: OWNER,
    })
    mocks.executions.set("exec-0", {
      id: "exec-0",
      user_id: OWNER,
      workflow_id: "wf-1",
      status: "completed",
      node_states: {
        img: { status: "completed", output: { imageUrl: results[0].url }, completedAt: at, fromSavedData: true },
        up: { status: "completed", nodeType: "upscale-image", jobId: "job-up", startedAt: at, completedAt: at, output: { imageUrl: "https://r2/up.png" } },
      },
    })
    await processWorkflowExecution(job({ nodeIds: ["up"], inputOverrides: undefined }))
    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNodeCalls.filter((c) => c.id === "up")).toHaveLength(4)
    const img = (completedWrite()!.node_states as Record<string, NodeExecutionState>).img
    expect(img).toMatchObject({ fromSavedData: true, seededFromExecution: "exec-0" })
  })
})

describe("refusals: before any node runs, with stable codes", () => {
  const refused = async (data: Partial<WorkflowExecutionJob>, code: string) => {
    await processWorkflowExecution(job(data))
    expect(ran()).toEqual([])
    expect(failedWrite()!.error_message).toBe(code)
  }

  it("no subset", async () => {
    await refused({ nodeIds: undefined }, CONTINUATION_SUBSET_REQUIRED)
  })

  it("no such execution", async () => {
    await refused({ continueFromExecutionId: "exec-missing" }, CONTINUATION_NOT_FOUND)
  })

  it("someone else's execution reads as not found", async () => {
    mocks.executions.set("exec-0", stoppedRun({ user_id: "someone-else" }))
    await refused({}, CONTINUATION_NOT_FOUND)
  })

  it("an execution of another workflow", async () => {
    mocks.executions.set("exec-0", stoppedRun({ workflow_id: "wf-2" }))
    await refused({}, CONTINUATION_WORKFLOW_MISMATCH)
  })

  it("an app run continued on the live workflow, or another version", async () => {
    mocks.appRuns.set("exec-0", "app-1")
    await refused({}, CONTINUATION_VERSION_MISMATCH)
  })

  it("an execution that has not completed", async () => {
    mocks.executions.set("exec-0", stoppedRun({ status: "failed" }))
    await refused({}, CONTINUATION_NOT_COMPLETED)
  })
})
