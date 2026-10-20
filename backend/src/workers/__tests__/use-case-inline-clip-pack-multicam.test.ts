// @test-watches backend/src/routes/use-case-run.ts backend/src/workers/orchestrator-worker.ts backend/src/workers/fan-out-result.ts
/**
 * A Clip Pack on several cameras, through the REAL orchestrator (decided
 * 2026-10-17/18): Camera Switch runs once per clip and every clip's switch is
 * tried — one clip whose switch fails never stops the others, its render never
 * starts (nothing is reserved for it), and the wrapper names it on
 * `failedClips`, keeping the delivered clips and the run's fee.
 *
 * Drives `processWorkflowExecution` with only leaf I/O mocked (the harness of
 * use-case-inline-orchestrator.test.ts, which is past its size).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import { buildClipPackGraph, resolveClipPackSettings, toStoredInlineGraph } from "@nodaro/render-rules"
import type { NodeExecutionState, WorkflowExecutionJob } from "../../services/workflow-engine/types.js"
import { edlSpanKey } from "@nodaro/shared/nodes"
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
import { buildPayload } from "../../services/workflow-engine/payload-builder.js"

const OWNER = "owner-1"

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

function completedWrite(): Record<string, unknown> | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === "completed")
  return call?.[1] as Record<string, unknown> | undefined
}
function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(([, u]) => (u as { status?: string })?.status === "failed")
  return call?.[1] as { error_message?: string } | undefined
}

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
  inline.loads.length = 0
  blocks.blocked = false
  flag.on = true
  fin.finalize.mockClear()
  fin.progress.mockClear()
})

const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const, durationSec: 3600 })
const SOURCES = { media: cam(1), moreMedia: [cam(2)], masterAudio: { url: "https://r2/m.wav", kind: "audio" as const, durationSec: 3600 } }
const SHAPE = { recordings: 2, masterAudio: true }
const CAMS = [{ id: "uc-source", url: "https://r2/c1.mp4", kind: "video" }, { id: "uc-cam-2", url: "https://r2/c2.mp4", kind: "video" }]
const clip = (i: number) => ({ version: 1, sources: CAMS, segments: [{ id: `s${i}`, video: "uc-source", inMs: i * 60_000, outMs: i * 60_000 + 30_000 }], meta: { title: `Clip ${i + 1}`, hook: `Hook ${i + 1}` } })
const plan = [0, 1, 2].map(clip)
/** Clip `i` as Camera Switch hands it on: every segment names its speaker. */
const switchedClip = (i: number) => ({ ...plan[i]!, segments: plan[i]!.segments.map((s) => ({ ...s, speaker: "A" })), switched: true })
const SWITCH_CREDITS = 2
const RENDER_CREDITS = 30
const CAPTION_CREDITS = 5
type Call = { id: string; data?: Record<string, unknown> }

/** Each step's output; the switch of clip `failSwitchRow` throws (its own job refunds itself: no charge). */
function steps(opts: { failSwitchRow?: number; failSwitchRows?: readonly number[]; stopAtSwitchRow?: number } = {}) {
  mocks.executeNode.mockImplementation((async (node: Call, inputs: Record<string, unknown>, ...rest: unknown[]) => {
    mocks.executeNodeCalls.push({ id: node.id, inputs, data: { ...(node.data ?? {}) } })
    const row = rest[5] as number | undefined
    switch (node.id) {
      case "uc-sync":
        return { output: { json: { offsets: [] } }, creditsUsed: 1 }
      case "uc-map":
        return { output: { json: { speakers: [] } }, creditsUsed: 1 }
      case "uc-transcribe":
        return { output: { json: { words: [] } }, creditsUsed: 1 }
      case "uc-plan":
        return { output: { json: plan, listResults: plan.map((c) => JSON.stringify(c)) }, creditsUsed: 1 }
      case "uc-switch": {
        if (row === opts.stopAtSwitchRow) {
          // The Stop lands as this row runs: the run's control row says so, and the poll's flag is up before the next row starts.
          mocks.executions.set("exec-1", { status: "cancelled" })
          ;(rest[3] as { cancelled?: boolean }).cancelled = true
        }
        if (row === opts.failSwitchRow || (row !== undefined && opts.failSwitchRows?.includes(row))) throw new Error("camera switch failed")
        await new Promise((r) => setTimeout(r, 5))
        return { output: { json: { edl: switchedClip(row ?? 0), transcript: { words: [] } } }, creditsUsed: SWITCH_CREDITS, jobId: `job-s${row}` }
      }
      case "uc-frames":
        return { output: { json: { version: 1, tracks: [] } }, creditsUsed: 7 }
      case "uc-render": {
        // The take carries what its payload was stamped with (the plugin copies
        // `clipKey` / `planBasis` onto the result): the REAL payload builder's stamps.
        const { payload } = buildPayload(node as never, `job-r${row}`, inputs as never, undefined, {
          nodes: rest[1] as never,
          edges: rest[0] as never,
          nodeStates: rest[2] as never,
          ...(row !== undefined ? { listRow: row } : {}),
        })
        const stamps = { ...(payload.clipKey ? { clipKey: payload.clipKey } : {}), ...(payload.planBasis ? { planBasis: payload.planBasis } : {}) }
        return { output: { videoUrl: `https://r2/r${row}.mp4`, quality: node.data?.quality, ...stamps }, creditsUsed: RENDER_CREDITS, jobId: `job-r${row}` }
      }
      case "uc-captions": {
        const src = String(inputs.videoUrl ?? inputs.video ?? "")
        return { output: { videoUrl: `https://r2/captioned-${src.split("/").pop()}` }, creditsUsed: CAPTION_CREDITS }
      }
      default:
        return { output: { videoUrl: `https://r2/${node.id}.mp4` }, creditsUsed: 0 }
    }
  }) as never)
}
const restore = () => {
  mocks.executeNode.mockReset()
  mocks.executeNode.mockImplementation(async (node: Call, inputs: Record<string, unknown>) => {
    mocks.executeNodeCalls.push({ id: node.id, inputs, data: { ...(node.data ?? {}) } })
    return { output: { videoUrl: `https://r2/${node.id}.mp4` }, creditsUsed: 1 }
  })
}
const twoAtATime = { userId: OWNER, payer: "deployment", entitlements: { parallelism: 2 } }

describe("a Clip Pack on two cameras + Master audio, one clip's Camera Switch fails (decided 2026-10-18)", () => {
  const settings = resolveClipPackSettings({}, "video", SHAPE)
  const g = toStoredInlineGraph(buildClipPackGraph(settings, SOURCES), settings)

  it("rows 1 and 3 still switch and render; row 2's render never starts; the failed switch is not charged; the wrapper names one failed clip and keeps the others", async () => {
    inline.graph = g
    steps({ failSwitchRow: 1 })
    try {
      await processWorkflowExecution(inlineJob({ billingContext: twoAtATime as never }))
    } finally {
      restore()
    }
    expect(failedWrite()).toBeUndefined()
    // Every clip's switch is tried (concurrency 2: row 2 fails while row 1 still switches).
    expect(mocks.executeNodeCalls.filter((c) => c.id === "uc-switch")).toHaveLength(3)
    // The render runs once per switched clip: the hole is never started, so nothing is reserved for it.
    const renders = mocks.executeNodeCalls.filter((c) => c.id === "uc-render")
    expect(renders).toHaveLength(2)
    expect(mocks.executeNodeCalls.filter((c) => c.id === "uc-captions")).toHaveLength(2)
    const done = completedWrite()!
    expect(done.total_credits_used).toBe(1 + 1 + 1 + 1 + 2 * SWITCH_CREDITS + 2 * RENDER_CREDITS + 2 * CAPTION_CREDITS)
    const states = done.node_states as Record<string, NodeExecutionState>
    expect(states["uc-switch"]!.status).toBe("completed")
    const switchOut = states["uc-switch"]!.output as { listResults?: string[]; listResultStamps?: Array<Record<string, unknown>> }
    expect(switchOut.listResults!.map((r) => r !== "")).toEqual([true, false, true])
    expect(switchOut.listResultStamps![1]).not.toHaveProperty("cancelled")
    const out = usecaseWrapperOutput(g, states as Record<string, unknown>, "exec-1")
    expect(out.clips!.map((c) => [c.clipKey, c.title])).toEqual([[edlSpanKey(plan[0]), "Clip 1"], [edlSpanKey(plan[2]), "Clip 3"]])
    expect(out.clips!.map((c) => c.url)).toEqual(["https://r2/captioned-r0.mp4", "https://r2/captioned-r2.mp4"])
    expect(out.failedClips).toBe(1)
    expect(usecaseWrapperKeepsPartial(g, out)).toBe(true)
  })

  it("a Stop while the switch runs: the switch row never started is not a failure, and the run is cancelled (no fee kept)", async () => {
    inline.graph = g
    // Two at a time: rows 1 and 2 have started when the Stop lands; row 3 never starts.
    steps({ stopAtSwitchRow: 1 })
    try {
      await processWorkflowExecution(inlineJob({ billingContext: twoAtATime as never }))
    } finally {
      restore()
    }
    expect(completedWrite()).toBeUndefined()
    const states = (mocks.updateExecutionWithRetry.mock.calls.map(([, u]) => (u as { node_states?: Record<string, NodeExecutionState> }).node_states).filter(Boolean).pop() ?? {}) as Record<string, NodeExecutionState>
    const switchOut = states["uc-switch"]?.output as { listResultStamps?: Array<Record<string, unknown>> } | undefined
    // Rows 1 and 2 ran; row 3 never started and says so.
    expect(mocks.executeNodeCalls.filter((c) => c.id === "uc-switch")).toHaveLength(2)
    expect(switchOut!.listResultStamps![2]).toMatchObject({ cancelled: true })
    expect(mocks.executeNodeCalls.some((c) => c.id === "uc-render")).toBe(false)
    const out = usecaseWrapperOutput(g, states as Record<string, unknown>, "exec-1")
    expect(out.failedClips ?? 0).toBe(0)
  })

  it("following faces: ONE Speaker Frames run over the clips whose switch delivered (the hole is not sent), its tracks read by every render", async () => {
    const tracked = resolveClipPackSettings({ framingSource: "tracking" }, "video", SHAPE)
    const tg = toStoredInlineGraph(buildClipPackGraph(tracked, SOURCES), tracked)
    inline.graph = tg
    steps({ failSwitchRow: 1 })
    try {
      await processWorkflowExecution(inlineJob({ billingContext: twoAtATime as never }))
    } finally {
      restore()
    }
    expect(failedWrite()).toBeUndefined()
    const frames = mocks.executeNodeCalls.filter((c) => c.id === "uc-frames")
    expect(frames).toHaveLength(1)
    // The fold reads only the switched clips that came back: the hole is not sent.
    const folded = (frames[0]!.inputs as { inputs?: string[] }).inputs ?? []
    expect(folded.map((e) => (JSON.parse(e) as { meta: { title: string } }).meta.title)).toEqual(["Clip 1", "Clip 3"])
    const renders = mocks.executeNodeCalls.filter((c) => c.id === "uc-render")
    expect(renders).toHaveLength(2)
    // One tracks value, read by every clip's render.
    expect(new Set(renders.map((r) => r.inputs.tracks))).toEqual(new Set([JSON.stringify({ version: 1, tracks: [] })]))
    const out = usecaseWrapperOutput(tg, completedWrite()!.node_states as Record<string, unknown>, "exec-1")
    expect(out.clips).toHaveLength(2)
    expect(out.failedClips).toBe(1)
  })

  it("only the last clip's switch survives: one render of THAT clip, two failed clips", async () => {
    inline.graph = g
    steps({ failSwitchRows: [0, 1] })
    try {
      await processWorkflowExecution(inlineJob({ billingContext: twoAtATime as never }))
    } finally {
      restore()
    }
    expect(failedWrite()).toBeUndefined()
    // One live row left: the render runs once (not a fan-out), on the clip that was switched.
    const renders = mocks.executeNodeCalls.filter((c) => c.id === "uc-render")
    expect(renders).toHaveLength(1)
    expect((JSON.parse(String(renders[0]!.inputs.edl)) as { meta: { title: string } }).meta.title).toBe("Clip 3")
    const out = usecaseWrapperOutput(g, completedWrite()!.node_states as Record<string, unknown>, "exec-1")
    expect(out.clips).toHaveLength(1)
    expect(out.failedClips).toBe(2)
    // The render ran once, with no list row, yet it is stamped as clip 3's take (decided 2026-10-20):
    // the switch's one delivered row is the row it reads (`renderLoneRow`), so the delivered clip keeps
    // its clipKey, its plan basis, its title and its hook.
    expect(out.clips![0]).toMatchObject({ clipKey: edlSpanKey(plan[2]), title: "Clip 3", hook: "Hook 3" })
    expect(out.clips![0]!.planBasis).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe("a multicam Clip Pack whose render failed outright, continued from where it failed", () => {
  const settings = resolveClipPackSettings({}, "video", SHAPE)
  const g = toStoredInlineGraph(buildClipPackGraph(settings, SOURCES), settings)
  const at = "2026-10-20T10:00:00.000Z"
  const done = (nodeType: string, output: Record<string, unknown>) => ({ status: "completed", nodeType, jobId: `j-${nodeType}`, output, completedAt: at })
  const switched = plan.map((_, i) => JSON.stringify(switchedClip(i)))

  it("re-runs the render and the captions only (the switch is seeded, not re-run, and not charged again); the clips come back", async () => {
    inline.graph = g
    mocks.executions.set("exec-0", {
      id: "exec-0", user_id: OWNER, workflow_id: null, status: "failed", inline_graph: g,
      node_states: {
        "uc-source": { status: "completed", output: { videoUrl: "https://r2/c1.mp4" }, completedAt: at, fromSavedData: true },
        "uc-cam-2": { status: "completed", output: { videoUrl: "https://r2/c2.mp4" }, completedAt: at, fromSavedData: true },
        "uc-master": { status: "completed", output: { audioUrl: "https://r2/m.wav" }, completedAt: at, fromSavedData: true },
        "uc-sync": done("audio-sync", { json: { offsets: [] } }),
        "uc-map": done("speaker-map", { json: { speakers: [] } }),
        "uc-transcribe": done("transcribe", { json: { words: [] } }),
        "uc-plan": done("edit-plan", { json: plan, listResults: plan.map((c) => JSON.stringify(c)) }),
        "uc-switch": done("camera-switch", { json: { edl: JSON.parse(switched[0]!), transcript: { words: [] } }, listResults: switched, listResultStamps: plan.map(() => ({})) }),
        "uc-render": { status: "failed", nodeType: "speaker-view", error: "render failed" },
        "uc-captions": { status: "pending", nodeType: "add-captions" },
      },
    })
    steps()
    try {
      await processWorkflowExecution(inlineJob({ executionId: "exec-1", continueFromExecutionId: "exec-0", continueMode: "from-failed", nodeIds: ["uc-render", "uc-captions"] }))
    } finally {
      restore()
    }
    expect(failedWrite()).toBeUndefined()
    expect(mocks.executeNodeCalls.some((c) => c.id === "uc-switch")).toBe(false)
    expect(mocks.executeNodeCalls.filter((c) => c.id === "uc-render")).toHaveLength(3)
    const done1 = completedWrite()!
    expect(done1.total_credits_used).toBe(3 * RENDER_CREDITS + 3 * CAPTION_CREDITS)
    const out = usecaseWrapperOutput(g, done1.node_states as Record<string, unknown>, "exec-1")
    expect(out.clips).toHaveLength(3)
    expect(out).not.toHaveProperty("failedClips")
    // Each clip keeps its own key and title: the seeded switch's batch still names its rows.
    expect(out.clips!.map((c) => [c.clipKey, c.title])).toEqual(plan.map((c, i) => [edlSpanKey(c), `Clip ${i + 1}`]))
  })
})
