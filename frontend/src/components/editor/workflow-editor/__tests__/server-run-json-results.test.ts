/**
 * A5.0 — a workflow run's JSON results reach the canvas.
 *
 * The payloads are REAL. The fixture holds two executions captured on staging
 * on 2026-10-04 — a 42-second synthetic narration; account and workflow ids,
 * row ids and every media URL replaced, nothing else touched: a whole-workflow
 * run of
 *   Recording → Transcribe + Silence Detect → Tighten Plan → Apply Cut (audio, preview)
 * (`fullRun`), and a Run from here at Apply Cut (`runFromRender`), whose
 * upstream nodes the orchestrator SEEDED from their saved data:
 * `fromSavedData: true`, no `startedAt`, no job. `jobs` holds each job's row as
 * `GET /v1/jobs/:id` returned it.
 *
 * Before A5.0 no lane that paints a run onto the canvas mapped `json`: Edit
 * Plan's plan, Transcribe's transcript and Silence Detect's ranges stayed
 * whatever the last CANVAS run left (or nothing), and the next Run from here
 * seeded that stale value. And a seeded state was written back like a real
 * result — onto an upload node as a "generated" result, and (once json is
 * mapped) over the planner's output.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
// use-workflow-persistence builds a Supabase client only inside its hook.
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyBackendExecutionState, applyCompletedExecutionResults } from "@/hooks/use-workflow-persistence"
import { buildCompletedResultPatch } from "@/lib/reconcile-completed-jobs"
import { applyRestoredJobCompletion, paintRunStates } from "../run-handlers"
import { extractNodeOutput } from "../execution-graph"
import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/server-run-json-results.json"

type Data = Record<string, unknown>
type Run = { readonly id: string; readonly completedAt: string | null; readonly nodeStates: Record<string, Data> }

const FULL = fixture.fullRun as unknown as Run
const FROM_RENDER = fixture.runFromRender as unknown as Run
const outputOf = (run: Run, nodeId: string) => run.nodeStates[nodeId]!.output as Data

const PLAN = outputOf(FULL, "a50-plan").json
const TRANSCRIPT = outputOf(FULL, "a50-transcribe").json
const TRANSCRIPT_TEXT = outputOf(FULL, "a50-transcribe").text as string
const SILENCE = outputOf(FULL, "a50-silence").json
const RENDER_1 = outputOf(FULL, "a50-apply")
const RENDER_2 = outputOf(FROM_RENDER, "a50-apply")

/** The repro canvas, each node's data merged with `extra[nodeId]`. */
function canvas(extra: Record<string, Data> = {}): WorkflowNode[] {
  return fixture.workflow.nodes.map((n) => ({ ...n, data: { ...n.data, ...(extra[n.id] ?? {}) } })) as unknown as WorkflowNode[]
}
const dataOf = (nodes: readonly WorkflowNode[], id: string) => (nodes.find((n) => n.id === id)?.data ?? {}) as Data
const activeTake = (data: Data) => (data.generatedResults as Data[] | undefined)?.[(data.activeResultIndex as number | undefined) ?? 0]

/** The three lanes that paint an orchestrator run's node states onto the canvas. */
const LANES: ReadonlyArray<readonly [string, (nodes: WorkflowNode[], run: Run) => WorkflowNode[]]> = [
  [
    "the live run (syncNodeStatesToStore)",
    (nodes, run) => {
      act(() => useWorkflowStore.setState({ nodes, edges: [] }))
      act(() => paintRunStates(run.nodeStates as never))
      return useWorkflowStore.getState().nodes
    },
  ],
  ["a reopen while it runs (applyBackendExecutionState)", (nodes, run) => applyBackendExecutionState(nodes, run.nodeStates as never)],
  ["a reopen after it ended (applyCompletedExecutionResults)", (nodes, run) => applyCompletedExecutionResults(nodes, run.nodeStates as never, run.completedAt)],
]

beforeEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe.each(LANES)("a workflow run's json, through %s", (_lane, paint) => {
  it("Edit Plan holds the plan the run made", () => {
    const out = paint(canvas(), FULL)
    expect(dataOf(out, "a50-plan").generatedJson).toEqual(PLAN)
  })

  it("Transcribe holds the run's transcript: its text, its json, and a take that carries both", () => {
    const transcribe = dataOf(paint(canvas(), FULL), "a50-transcribe")
    expect(transcribe.generatedText).toBe(TRANSCRIPT_TEXT)
    expect(transcribe.generatedJson).toEqual(TRANSCRIPT)
    expect(activeTake(transcribe)).toMatchObject({ text: TRANSCRIPT_TEXT, transcript: TRANSCRIPT })
  })

  it("Silence Detect holds the ranges the run found", () => {
    expect(dataOf(paint(canvas(), FULL), "a50-silence").generatedJson).toEqual(SILENCE)
  })

  it("Apply EDL keeps landing its render and the transcript remapped through it", () => {
    const apply = dataOf(paint(canvas(), FULL), "a50-apply")
    expect(apply.generatedAudioUrl).toBe(RENDER_1.audioUrl)
    expect(apply.generatedJson).toEqual(RENDER_1.json)
  })

  it("the canvas engine reads back exactly what the run produced", () => {
    const out = paint(canvas(), FULL)
    const node = (id: string) => out.find((n) => n.id === id)!
    expect(extractNodeOutput(node("a50-plan"))).toBe(JSON.stringify(PLAN))
    expect(extractNodeOutput(node("a50-transcribe"), "json")).toBe(JSON.stringify(TRANSCRIPT))
    expect(extractNodeOutput(node("a50-transcribe"), "text")).toBe(TRANSCRIPT_TEXT)
    expect(extractNodeOutput(node("a50-silence"), "json")).toBe(JSON.stringify(SILENCE))
  })
})

describe.each(LANES)("a Run from here's SEEDED states, through %s", (lane, paint) => {
  // What the person's canvas holds after the whole run landed — and an EDITED
  // plan in the seed, the value a seed carries once Edit Plan's review edits
  // are resolved into it (A5.2). The seed must never overwrite the planner's.
  const EDITED = (() => {
    const plan = structuredClone(PLAN) as { segments: Data[]; dropped: Data[] }
    const [cut] = plan.segments.splice(3, 1)
    plan.dropped.push({ inMs: cut!.inMs, outMs: cut!.outMs, reason: "manual" })
    return plan
  })()
  const seeded: Run = {
    ...FROM_RENDER,
    nodeStates: { ...FROM_RENDER.nodeStates, "a50-plan": { ...FROM_RENDER.nodeStates["a50-plan"]!, output: { json: EDITED } } },
  }
  const TAKE = { text: TRANSCRIPT_TEXT, language: "eng", jobId: FULL.nodeStates["a50-transcribe"]!.jobId, timestamp: "2026-10-04T21:28:26.196Z", transcript: TRANSCRIPT }
  const landed = () =>
    canvas({
      "a50-transcribe": { generatedText: TRANSCRIPT_TEXT, generatedJson: TRANSCRIPT, generatedResults: [TAKE], activeResultIndex: 0 },
      "a50-silence": { generatedJson: SILENCE },
      "a50-plan": { generatedJson: PLAN, __alignedListResults: ["row-a", "row-b"] },
      "a50-apply": {
        generatedAudioUrl: RENDER_1.audioUrl,
        generatedJson: RENDER_1.json,
        generatedResults: [{ url: RENDER_1.audioUrl, timestamp: "2026-10-04T21:28:46.455Z", jobId: FULL.nodeStates["a50-apply"]!.jobId, generatedJson: RENDER_1.json }],
        activeResultIndex: 0,
      },
    })

  it("the real seeds are what the orchestrator stamps: fromSavedData, no startedAt", () => {
    for (const id of ["a50-src", "a50-transcribe", "a50-silence", "a50-plan"]) {
      expect(FROM_RENDER.nodeStates[id], id).toMatchObject({ status: "completed", fromSavedData: true })
      expect(FROM_RENDER.nodeStates[id]!.startedAt, id).toBeUndefined()
    }
  })

  it("Edit Plan keeps the planner's output, whatever the seed carried", () => {
    expect(dataOf(paint(landed(), seeded), "a50-plan").generatedJson).toEqual(PLAN)
  })

  it("a seed writes no result field at all — not on the upload, not on Transcribe, not the row-aligned list", () => {
    const before = landed()
    const out = paint(before, seeded)
    expect(dataOf(out, "a50-src").generatedAudioUrl).toBeUndefined()
    expect(dataOf(out, "a50-src").generatedResults).toBeUndefined()
    expect(dataOf(out, "a50-transcribe").generatedResults).toEqual([TAKE])
    expect(dataOf(out, "a50-plan").__alignedListResults).toEqual(["row-a", "row-b"])
    for (const id of ["a50-src", "a50-transcribe", "a50-silence", "a50-plan"]) {
      const { executionStatus: _after, ...after } = dataOf(out, id)
      const { executionStatus: _before, ...was } = dataOf(before, id)
      expect(after, id).toEqual(was)
    }
  })

  // The fill-only lane leaves a render that already holds one alone by design;
  // a reopen loads the newer render through the review rule (below).
  if (!lane.includes("applyCompletedExecutionResults")) {
    it("the render the run DID execute still lands", () => {
      const apply = dataOf(paint(landed(), seeded), "a50-apply")
      expect(apply.generatedAudioUrl).toBe(RENDER_2.audioUrl)
      expect(apply.generatedJson).toEqual(RENDER_2.json)
    })
  }
})

describe("the live run settles a seeded node it marked pending without writing a result", () => {
  // Run marks every executable node pending, Skip-frozen ones included; the
  // orchestrator seeds those. Writing nothing must not leave them spinning.
  it("a frozen Silence Detect ends 'completed' with its saved ranges untouched", () => {
    act(() => useWorkflowStore.setState({ nodes: canvas({ "a50-silence": { executionStatus: "pending", generatedJson: SILENCE } }), edges: [] }))
    act(() => paintRunStates({ "a50-silence": { status: "completed", output: { json: { ranges: [] } }, completedAt: "2026-10-04T21:29:27.633Z", fromSavedData: true } } as never))
    const silence = dataOf(useWorkflowStore.getState().nodes, "a50-silence")
    expect(silence.executionStatus).toBe("completed")
    expect(silence.generatedJson).toEqual(SILENCE)
  })
})

describe("Edit Plan in Clips mode leaves the generic list write, like a canvas run", () => {
  // The output buildNodeOutputFromJobData builds for a clips plan: the bare
  // Edl[] on `json`, one JSON string per clip on `listResults`.
  const plan = PLAN as { segments: Data[] }
  const clips = [
    { ...plan, segments: plan.segments.slice(0, 4) },
    { ...plan, segments: plan.segments.slice(4) },
  ]
  const clipsRun: Run = {
    ...FULL,
    nodeStates: { "a50-plan": { ...FULL.nodeStates["a50-plan"]!, output: { json: clips, listResults: clips.map((c) => JSON.stringify(c)) } } },
  }

  it.each(LANES)("%s", (_lane, paint) => {
    const out = paint(canvas(), clipsRun)
    expect(dataOf(out, "a50-plan").generatedJson).toEqual(clips)
    expect(dataOf(out, "a50-plan").__listResults).toBeUndefined()
  })
})

/** The two lanes that land a single JOB's row (a poll restored after a reload; a job that ended while the editor was closed). */
const JOB_LANES: ReadonlyArray<readonly [string, (node: WorkflowNode, job: { id: string; status: string; output_data: Data }) => Data]> = [
  [
    "a poll restored after a reload (applyRestoredJobCompletion)",
    (node, job) => {
      act(() => useWorkflowStore.setState({ nodes: [node], edges: [] }))
      act(() => applyRestoredJobCompletion(node.id, node.type ?? "", job, job.id))
      return dataOf(useWorkflowStore.getState().nodes, node.id)
    },
  ],
  [
    "a job that ended while the editor was closed (buildCompletedResultPatch)",
    (node, job) => ({ ...node.data, ...(buildCompletedResultPatch(node.type, job.output_data, job.id, "2026-10-04T21:30:00.000Z", node.data as Data) ?? {}) }),
  ],
]

describe.each(JOB_LANES)("a job row's json, through %s", (_lane, land) => {
  const node = (id: string) => canvas().find((n) => n.id === id)!
  const job = (id: keyof typeof fixture.jobs) => fixture.jobs[id] as unknown as { id: string; status: string; output_data: Data }

  it("Edit Plan: the plan unwrapped once, exactly as the run's node output carries it", () => {
    expect(land(node("a50-plan"), job("a50-plan")).generatedJson).toEqual(PLAN)
  })

  it("Silence Detect: its ranges", () => {
    expect(land(node("a50-silence"), job("a50-silence")).generatedJson).toEqual(SILENCE)
  })

  it("Transcribe: its text, its json and a take carrying both", () => {
    const transcribe = land(node("a50-transcribe"), job("a50-transcribe"))
    expect(transcribe.generatedText).toBe(TRANSCRIPT_TEXT)
    expect(transcribe.generatedJson).toEqual(TRANSCRIPT)
    expect(activeTake(transcribe)).toMatchObject({ text: TRANSCRIPT_TEXT, transcript: TRANSCRIPT, jobId: job("a50-transcribe").id })
  })

  it("Apply EDL: its render and the remapped transcript", () => {
    const apply = land(node("a50-apply"), job("a50-apply"))
    expect(apply.generatedAudioUrl).toBe(RENDER_1.audioUrl)
    expect(apply.generatedJson).toEqual(RENDER_1.json)
  })
})
