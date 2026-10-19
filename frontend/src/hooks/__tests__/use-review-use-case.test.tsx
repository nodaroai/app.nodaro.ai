import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { editPlanBasis, normalizeEdl } from "@nodaro/shared/edl"
import { buildTightenEpisodeGraph, resolveTightenEpisodeSettings } from "@nodaro/render-rules"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))
vi.mock("@/lib/edition", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), hasCredits: () => true }))
vi.mock("@/hooks/use-model-credit-cost", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: async () => undefined,
}))
vi.mock("@/components/editor/workflow-editor/newer-run-check", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  newerRunOnServer: vi.fn(async () => null),
  applyNewerRun: vi.fn(() => true),
}))

import { useWorkflowStore } from "../use-workflow-store"
import { useReviewModel } from "../use-review-model"
import { useReviewEdits } from "../use-review-edits"
import { useReviewChecks, REVIEW_CHECK_DEBOUNCE_MS } from "../use-review-checks"
import { useReviewRuns } from "../use-review-runs"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { REVIEW_WRITE_IDLE_MS, reviewOf as editOf } from "@/lib/edl-review/write-review"
import { keptSetOf } from "@/lib/edl-review/kept-set"
import { reviewViewOf } from "@/lib/edl-review/use-case-review-source"
import { reviewKindOf } from "@/lib/edl-review/review-entry"
import { renderRowsOf, renderSettingsBasisFor } from "@/lib/render-review-adapter"
import { currentRenderPlanBasis } from "@/components/editor/workflow-editor/apply-edl-stamps"

/**
 * The review of a Tighten Episode node (decided 2026-10-13) is the review of
 * the Edit Plan → render pair its run is. The same plan, edit, transcript,
 * recording and take, once held by the node and once on a hand-built pair on
 * the canvas, give the same model, the same checks and the same gate — and an
 * edit made in the review is written to the node.
 */
const URL = "https://r2/ep.mp4"
const PLAN = {
  version: 1,
  clock: "master",
  sources: [{ id: "rec", url: URL, kind: "video" }],
  segments: [
    { id: "s0", inMs: 0, outMs: 4000, video: "rec" },
    { id: "s1", inMs: 5000, outMs: 9000, video: "rec" },
  ],
  dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }],
}
const TRANSCRIPT = {
  version: 1,
  words: [
    { text: "So", startMs: 100, endMs: 400, speaker: "A" },
    { text: "um", startMs: 4200, endMs: 4600, speaker: "A" },
    { text: "is", startMs: 5100, endMs: 5400, speaker: "B" },
  ],
}
const EDIT = { v: 1, kind: "edl", basis: editPlanBasis(PLAN), edl: { segments: [PLAN.segments[0]], dropped: [] } }
const TAKE = { generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: "job-1" }], activeResultIndex: 0, generatedVideoUrl: "https://r2/p.mp4" }
const at = { x: 0, y: 0 }
const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: at, data })
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ id: `${source}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle })
const REC = node("rec", "upload-video", { url: URL })

/** The node's settings, the take and the plan's edit (when any). */
function loadUseCase(settings: Record<string, unknown>, edit?: unknown) {
  useWorkflowStore.setState({
    nodes: [REC, node("t1", "tighten-episode", {
      reviewBeforeRender: true, useCaseJobId: "job-1", generatedJson: PLAN, generatedTranscript: TRANSCRIPT,
      ...(edit ? { editedEdl: edit } : {}), ...TAKE, ...settings,
    })] as never,
    edges: [edge("rec", "video", "t1", "media")] as never,
    isReadOnly: false,
    workflowId: null,
  })
}

/** The same run built by hand: recording → transcribe → Edit Plan → the run's own render. */
function loadPair(settings: Record<string, unknown>, edit?: unknown) {
  const g = buildTightenEpisodeGraph(resolveTightenEpisodeSettings({ reviewBeforeRender: true, ...settings }, "video"), { media: { url: URL, kind: "video" } })
  const render = g.nodes.find((n) => n.id === g.outputMap.renderNodeId)!
  const plan = g.nodes.find((n) => n.id === g.outputMap.planNodeId)!
  const framed = !g.edges.some((e) => e.target === render.id && e.targetHandle === "sources")
  useWorkflowStore.setState({
    nodes: [
      REC,
      node("tr", "transcribe", { generatedJson: TRANSCRIPT }),
      node("plan", "edit-plan", { ...plan.data, sourceOrder: ["rec"], generatedJson: PLAN, ...(edit ? { editedEdl: edit } : {}) }),
      node("cut", render.type, { ...render.data, ...TAKE }),
    ] as never,
    edges: [
      edge("rec", "video", "tr", "audio"),
      edge("rec", "video", "plan", "sources"),
      edge("tr", "json", "plan", "transcript"),
      edge("plan", "edl", "cut", "edl"),
      edge("tr", "json", "cut", "transcript"),
      ...(framed ? [] : [edge("rec", "video", "cut", "sources")]),
    ] as never,
    isReadOnly: false,
    workflowId: null,
  })
}

function useReview(renderId: string) {
  const model = useReviewModel(renderId)
  const edits = useReviewEdits(model)
  const checks = useReviewChecks(model, edits)
  const runs = useReviewRuns(model, edits, checks)
  return { model, edits, checks, runs }
}

/** Everything the review derives, less the ids that name where it lives. */
async function reviewOf(renderId: string) {
  const hook = renderHook(() => useReview(renderId))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(REVIEW_CHECK_DEBOUNCE_MS + 1)
  })
  const { model, edits, checks, runs } = hook.result.current
  const { renderId: _r, planId: _p, path: _path, loadNewerRun: _l, ...derived } = model
  const result = {
    model: derived,
    passesOtherNodes: model.passesOtherNodes,
    kept: edits.kept,
    canEdit: edits.canEdit,
    checks: { ...checks, renders: checks.renders.map((r) => ({ ...r })) },
    gate: runs.gate,
  }
  hook.unmount()
  return result
}

beforeEach(() => {
  vi.useFakeTimers()
  resetUndoStacks()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("a Tighten Episode node reviews as the pair its run is", () => {
  it.each([
    ["unframed, no edit", {}, undefined],
    ["unframed, an applied edit", {}, EDIT],
    ["framed (its render is the framed one), an applied edit", { framing: { aspect: "9:16", layout: "stacked" } }, EDIT],
  ])("%s: the same model, checks and gate", async (_name, settings, edit) => {
    loadPair(settings, edit)
    const pair = await reviewOf("cut")
    loadUseCase(settings, edit)
    const own = await reviewOf("t1")
    expect(own).toEqual(pair)
    // And it is a real review: a plan, a transcript, a gate that is ready.
    expect(own.model.planKind).toBe("edl")
    expect(own.model.transcript?.words).toHaveLength(3)
    expect(own.gate).toMatchObject({ mode: "ready" })
    expect(own.checks.verdict).toEqual({ ok: true })
  })

  it("names the node as its plan, and an edit made in the review is written to the node", async () => {
    loadUseCase({})
    const hook = renderHook(() => useReview("t1"))
    expect(hook.result.current.model.planId).toBe("t1")
    // Cut the second kept part (5–9 s).
    act(() => hook.result.current.edits.cutRange({ inMs: 5000, outMs: 9000 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVIEW_WRITE_IDLE_MS + 1)
    })
    const data = useWorkflowStore.getState().nodes.find((n) => n.id === "t1")!.data as Record<string, unknown>
    expect(data.editedEdl).toMatchObject({ kind: "edl", basis: editPlanBasis(PLAN) })
    hook.unmount()
  })

  /** The bases a render of the pair the node shows would stamp now (what its run stamps on the take). */
  function basesNow(edit?: unknown) {
    loadUseCase({}, edit)
    const { nodes, edges } = useWorkflowStore.getState()
    const view = reviewViewOf("t1", nodes as never, edges as never)
    const render = view.nodes.find((n) => n.id === view.renderId)! as never
    const row = renderRowsOf(render, view.nodes as never, view.edges as never)[0]
    return {
      planBasis: currentRenderPlanBasis(view.renderId, view.nodes as never, view.edges as never, row?.row),
      renderBasis: renderSettingsBasisFor(render, row),
    }
  }

  it("a take stamped with its render's bases: a Final made with the applied edit is fresh; a Preview made before it is stale", async () => {
    // The edit as the review writes it (keeping the first part only).
    const base = normalizeEdl(PLAN)
    const EDIT = editOf(PLAN, base, keptSetOf({ ...base, segments: [base.segments[0]!] }))
    const withEdit = basesNow(EDIT)
    const before = basesNow()
    expect(withEdit.planBasis).toBeTruthy()
    expect(withEdit.renderBasis).toBeTruthy()
    expect(withEdit.planBasis).not.toBe(before.planBasis)

    const take = (quality: string, bases: object) => ({ generatedResults: [{ url: "https://r2/t.mp4", quality, jobId: "job-1", ...bases }], activeResultIndex: 0 })
    loadUseCase(take("final", withEdit), EDIT)
    const finalTake = await reviewOf("t1")
    expect(finalTake.checks.fresh).toBe(true)
    expect(finalTake.checks.staleTake).toBe(false)

    loadUseCase(take("proxy", before), EDIT)
    const previewTake = await reviewOf("t1")
    expect(previewTake.checks.fresh).toBe(false)
    expect(previewTake.checks.staleTake).toBe(true)
  })
})

describe("an edit made on another take of the node (decided 2026-10-13)", () => {
  // The newest take cut PLAN_NEW, and the edit was made on it; the older take
  // (cut from PLAN) is picked, so the node holds PLAN and an edit of PLAN_NEW.
  const PLAN_NEW = { ...PLAN, segments: [PLAN.segments[0]], dropped: [] }
  const OTHER_EDIT = { v: 1, kind: "edl", basis: editPlanBasis(PLAN_NEW), edl: { segments: [], dropped: [] } }
  const takes = {
    generatedResults: [
      { url: "https://r2/new.mp4", quality: "proxy", jobId: "00000000-0000-4000-8000-000000000002", generatedJson: PLAN_NEW },
      { url: "https://r2/old.mp4", quality: "proxy", jobId: "00000000-0000-4000-8000-000000000001", generatedJson: PLAN },
    ],
    activeResultIndex: 1,
  }
  const editOnNode = () => (useWorkflowStore.getState().nodes.find((n) => n.id === "t1")!.data as Record<string, unknown>).editedEdl

  it("the model knows the edit is another take's, not an earlier plan's", () => {
    loadUseCase(takes, OTHER_EDIT)
    const { result } = renderHook(() => useReviewModel("t1"))
    expect(result.current.editStatus).toBe("stale")
    expect(result.current.staleEditOfOtherTake).toBe(true)
    // An edit of a plan no take holds is an earlier plan's.
    loadUseCase(takes, { ...OTHER_EDIT, basis: "0000000000000000" })
    expect(renderHook(() => useReviewModel("t1")).result.current.staleEditOfOtherTake).toBe(false)
  })

  it("the first edit here asks before replacing that take's edit; Cancel keeps it, Replace goes ahead", async () => {
    loadUseCase(takes, OTHER_EDIT)
    const hook = renderHook(() => useReview("t1"))
    const before = hook.result.current.edits.kept
    act(() => hook.result.current.edits.cutRange({ inMs: 5000, outMs: 9000 }))
    expect(hook.result.current.edits.replaceAsked).toBe(true)
    expect(hook.result.current.edits.kept).toEqual(before)
    act(() => hook.result.current.edits.cancelReplace())
    expect(hook.result.current.edits.replaceAsked).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(REVIEW_WRITE_IDLE_MS + 1) })
    expect(editOnNode()).toEqual(OTHER_EDIT)

    act(() => hook.result.current.edits.cutRange({ inMs: 5000, outMs: 9000 }))
    act(() => hook.result.current.edits.confirmReplace())
    expect(hook.result.current.edits.kept).not.toEqual(before)
    await act(async () => { await vi.advanceTimersByTimeAsync(REVIEW_WRITE_IDLE_MS + 1) })
    expect(editOnNode()).toMatchObject({ basis: editPlanBasis(PLAN) })
    hook.unmount()
  })

  it("Reset to plan asks the same before it clears that take's edit; Cancel keeps it", async () => {
    loadUseCase(takes, OTHER_EDIT)
    const hook = renderHook(() => useReview("t1"))
    act(() => hook.result.current.edits.resetToPlan())
    expect(hook.result.current.edits.replaceAsked).toBe(true)
    expect(editOnNode()).toEqual(OTHER_EDIT)
    act(() => hook.result.current.edits.cancelReplace())
    expect(editOnNode()).toEqual(OTHER_EDIT)
    act(() => hook.result.current.edits.resetToPlan())
    act(() => hook.result.current.edits.confirmReplace())
    await act(async () => { await vi.advanceTimersByTimeAsync(REVIEW_WRITE_IDLE_MS + 1) })
    expect(editOnNode()).toBeUndefined()
    hook.unmount()
  })

  it("locked after the ask (the canvas turned read-only, a run started): Replace and Reset clear nothing", async () => {
    loadUseCase(takes, OTHER_EDIT)
    const hook = renderHook(() => useReview("t1"))
    act(() => hook.result.current.edits.resetToPlan())
    expect(hook.result.current.edits.replaceAsked).toBe(true)
    act(() => useWorkflowStore.setState({ isReadOnly: true }))
    hook.rerender()
    expect(hook.result.current.edits.canEdit).toBe(false)
    act(() => hook.result.current.edits.confirmReplace())
    await act(async () => { await vi.advanceTimersByTimeAsync(REVIEW_WRITE_IDLE_MS + 1) })
    expect(editOnNode()).toEqual(OTHER_EDIT)
    act(() => useWorkflowStore.setState({ isReadOnly: false }))
    hook.unmount()
  })

  it("an edit on an earlier plan (no take holds it) is replaced without asking, as before", () => {
    loadUseCase(takes, { ...OTHER_EDIT, basis: "0000000000000000" })
    const hook = renderHook(() => useReview("t1"))
    act(() => hook.result.current.edits.cutRange({ inMs: 5000, outMs: 9000 }))
    expect(hook.result.current.edits.replaceAsked).toBe(false)
    hook.unmount()
  })
})

describe("a review-on Trailer reviews through the cut review (decided 2026-10-14)", () => {
  /** A completed review-on Trailer holding its plan (a trailer EDL) and its Preview. */
  function loadTrailer() {
    useWorkflowStore.setState({
      nodes: [REC, node("tr", "episode-trailer", {
        formats: ["9:16", "1:1"], reviewBeforeRender: true, useCaseJobId: "job-1",
        generatedJson: PLAN, generatedTranscript: TRANSCRIPT, executionStatus: "completed", ...TAKE,
      })] as never,
      edges: [edge("rec", "video", "tr", "media")] as never,
      isReadOnly: false,
      workflowId: null,
    })
  }

  it("opens the cut review: an EDL plan, rendered by Apply EDL to video", async () => {
    loadTrailer()
    const { nodes, edges } = useWorkflowStore.getState()
    expect(reviewKindOf("tr", nodes as never, edges as never)).toBe("edl")
    const own = await reviewOf("tr")
    expect(own.model.planKind).toBe("edl")
    expect(own.model.render?.output).toBe("video")
    expect(own.model.transcript?.words).toHaveLength(3)
  })

  it("an edit made in the review is written to the node", async () => {
    loadTrailer()
    const hook = renderHook(() => useReview("tr"))
    expect(hook.result.current.model.planId).toBe("tr")
    act(() => hook.result.current.edits.cutRange({ inMs: 5000, outMs: 9000 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVIEW_WRITE_IDLE_MS + 1)
    })
    const data = useWorkflowStore.getState().nodes.find((n) => n.id === "tr")!.data as Record<string, unknown>
    expect(data.editedEdl).toMatchObject({ kind: "edl", basis: editPlanBasis(PLAN) })
    hook.unmount()
  })
})
