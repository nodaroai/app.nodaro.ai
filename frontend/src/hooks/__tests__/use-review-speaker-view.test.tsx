import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { findSpeakerViewIssues, speakerViewContext, speakerViewRenderBasis, speakerViewWireSettings } from "@nodaro/render-rules"
import { editPlanBasis, normalizeEdl, renderReadBasis, resolveEditPlanOutput } from "@nodaro/shared"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useWorkflowStore } from "../use-workflow-store"
import { useReviewModel } from "../use-review-model"
import { useReviewEdits } from "../use-review-edits"
import { useReviewChecks } from "../use-review-checks"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { editedSincePreview } from "@/lib/edl-review/face-staleness"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The Tighten inspector anchored at a Speaker View (C3.4): it judges the cut by
 * Speaker View's own rule, takes the take's freshness from the basis Speaker
 * View's run stamps, and maps the take's clock through the EDL the take
 * emitted (`clockMapFrom: "output-json"`), never the EDL on its wire.
 */
const MIC = { id: "mic", url: "https://cdn.test/mic.wav", kind: "audio", role: "master-audio" }
const CAM = { id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }
const PLAN = {
  version: 1,
  clock: "master",
  sources: [MIC, CAM],
  segments: [
    { id: "s0", inMs: 0, outMs: 4000, video: "cam", speaker: "Host" },
    { id: "s1", inMs: 5000, outMs: 9000, video: "cam", speaker: "Guest" },
  ],
  dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }],
}
// What the take drew: its turn split cut s1 in two (a third segment).
const EMITTED = {
  ...PLAN,
  segments: [PLAN.segments[0], { ...PLAN.segments[1], outMs: 7000 }, { id: "s1b", inMs: 7000, outMs: 9000, video: "cam", speaker: "Host" }],
}
const at = { x: 0, y: 0 }
const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: at, data })
const EDGES = [{ id: "e", source: "plan", sourceHandle: "edl", target: "view", targetHandle: "edl" }]

/** A take stamped as Speaker View's run of `value` stamps it, with the node's settings. */
function stampedTake(value: typeof PLAN, url = "https://cdn.test/preview.mp4") {
  const settings = speakerViewWireSettings({}, speakerViewContext(value, undefined))
  return { url, quality: "proxy", planBasis: renderReadBasis(value), renderBasis: speakerViewRenderBasis(settings, findSpeakerViewIssues({ edl: value, settings }).edl!) }
}

function load(plan: Record<string, unknown>, view: Record<string, unknown> = {}) {
  useWorkflowStore.setState({
    nodes: [node("plan", "edit-plan", { mode: "tighten", generatedJson: plan }), node("view", "speaker-view", view)] as never,
    edges: EDGES as never,
    isReadOnly: false,
    workflowId: null,
  })
}

function useReview() {
  const model = useReviewModel("view")
  const edits = useReviewEdits(model)
  return { model, checks: useReviewChecks(model, edits) }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetUndoStacks()
})
afterEach(() => vi.useRealTimers())

describe("the review anchored at a Speaker View", () => {
  it("reads Speaker View's settings, and judges the cut by Speaker View's rule", () => {
    load(PLAN)
    const { result } = renderHook(() => useReview())
    expect(result.current.model.render).toEqual({ output: "video", crossfadeMs: 0, sources: [] })
    expect(result.current.checks.verdict).toEqual({ ok: true })
    expect(result.current.checks.validity).toMatchObject({ ok: true })
  })

  it("refuses a multicam cut with no speaker named, as the plugin would (Apply EDL's rule passes it)", () => {
    const unnamed = {
      ...PLAN,
      sources: [MIC, CAM, { ...CAM, id: "cam2", url: "https://cdn.test/cam2.mp4" }],
      segments: [{ id: "s0", inMs: 0, outMs: 4000, video: "cam" }, { id: "s1", inMs: 5000, outMs: 9000, video: "cam2" }],
    }
    load(unnamed)
    const { result } = renderHook(() => useReview())
    expect(result.current.checks.verdict?.ok).toBe(false)
    expect(result.current.checks.validity?.issues[0]).toMatch(/Wire Camera Switch/)
  })

  it("a fresh take maps its clock through the EDL it emitted, not the plan on its wire", () => {
    const take = stampedTake(PLAN)
    load(PLAN, { generatedResults: [take], activeResultIndex: 0, generatedVideoUrl: take.url, generatedJson: JSON.stringify(EMITTED) })
    const { result } = renderHook(() => useReview())
    expect(result.current.checks.fresh).toBe(true)
    expect(result.current.checks.clockMap).toEqual(normalizeEdl(EMITTED))
    expect(result.current.checks.clockMap?.segments).toHaveLength(3)
  })

  it("a take from another setting is stale (the basis is Speaker View's own), with no map", () => {
    const take = stampedTake(PLAN)
    load(PLAN, { layout: "grid", generatedResults: [take], activeResultIndex: 0, generatedVideoUrl: take.url, generatedJson: JSON.stringify(EMITTED) })
    const { result } = renderHook(() => useReview())
    expect(result.current.checks.fresh).toBe(false)
    expect(result.current.checks.clockMap).toBeNull()
  })

  it("the node face's edited-since note judges the take by Speaker View's own basis", () => {
    // An applied edit that keeps s0 only; the take was cut from it, by Speaker View.
    const edited = { v: 1, kind: "edl", basis: editPlanBasis(PLAN), edl: { segments: [PLAN.segments[0]], dropped: [] } }
    const resolved = resolveEditPlanOutput(PLAN, edited)
    expect(resolved.status).toBe("applied")
    const take = stampedTake(resolved.json as typeof PLAN)
    useWorkflowStore.setState({
      nodes: [node("plan", "edit-plan", { mode: "tighten", generatedJson: PLAN, editedEdl: edited }), node("view", "speaker-view", { generatedResults: [take], activeResultIndex: 0 })] as never,
      edges: EDGES as never,
    })
    const { nodes, edges } = useWorkflowStore.getState()
    expect(editedSincePreview("view", nodes as WorkflowNode[], edges as WorkflowEdge[])).toBe(false)
    // A different setting since the take: it is no longer what the render would make.
    useWorkflowStore.setState({ nodes: nodes.map((n) => (n.id === "view" ? { ...n, data: { ...n.data, layout: "grid" } } : n)) as never })
    const next = useWorkflowStore.getState()
    expect(editedSincePreview("view", next.nodes as WorkflowNode[], next.edges as WorkflowEdge[])).toBe(true)
  })
})
