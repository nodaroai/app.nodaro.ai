import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { buildEffectiveEdl, effectiveRenderBasis } from "@nodaro/render-rules"
import { editPlanBasis, normalizeEdl, renderReadBasis, resolveEditPlanOutput } from "@nodaro/shared"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useWorkflowStore } from "../use-workflow-store"
import { useReviewModel } from "../use-review-model"
import { useReviewEdits } from "../use-review-edits"
import { useReviewChecks, REVIEW_CHECK_DEBOUNCE_MS } from "../use-review-checks"
import { keptSetOf } from "@/lib/edl-review/kept-set"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { REVIEW_WRITE_IDLE_MS } from "@/lib/edl-review/write-review"

/**
 * The review model with no UI (A3-2): the canvas model, the reviewer's K and
 * its debounced write, undo, the lock, and the checks over the pending edit.
 */
const PLAN = {
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
  segments: [
    { id: "s0", inMs: 0, outMs: 4000, video: "cam" },
    { id: "s1", inMs: 5000, outMs: 9000, video: "cam" },
  ],
  dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }],
}
const TRANSCRIPT = {
  version: 1,
  words: [
    { text: "So", startMs: 100, endMs: 400, speaker: "A" },
    { text: "the", startMs: 500, endMs: 800, speaker: "A" },
    { text: "thing", startMs: 900, endMs: 1300, speaker: "A" },
    { text: "um", startMs: 4200, endMs: 4600, speaker: "A" },
    { text: "is", startMs: 5100, endMs: 5400, speaker: "B" },
  ],
}
const at = { x: 0, y: 0 }
const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: at, data })
const EDGES = [
  { id: "t", source: "tr", sourceHandle: "json", target: "plan", targetHandle: "transcript" },
  { id: "e", source: "plan", sourceHandle: "edl", target: "cut", targetHandle: "edl" },
]

function load(opts: { plan?: Record<string, unknown>; cut?: Record<string, unknown>; transcript?: boolean } = {}) {
  const nodes = [
    node("tr", "transcribe", { generatedJson: TRANSCRIPT }),
    node("plan", "edit-plan", { mode: "tighten", generatedJson: PLAN, ...opts.plan }),
    node("cut", "apply-edl", { quality: "proxy", ...opts.cut }),
  ]
  useWorkflowStore.setState({
    nodes: nodes as never,
    edges: (opts.transcript === false ? EDGES.slice(1) : EDGES) as never,
    isReadOnly: false,
    workflowId: null,
  })
}

const planData = () => useWorkflowStore.getState().nodes.find((n) => n.id === "plan")!.data as Record<string, unknown>

function useReview(renderId = "cut") {
  const model = useReviewModel(renderId)
  const edits = useReviewEdits(model)
  const checks = useReviewChecks(model, edits)
  return { model, edits, checks }
}

const SO = { inMs: 100, outMs: 400 }

beforeEach(() => {
  vi.useFakeTimers()
  resetUndoStacks()
  load()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("useReviewModel: the canvas model (§2.1)", () => {
  it("finds the plan behind the render, its planner's EDL and the transcript on its wire (R5 a)", () => {
    const { result } = renderHook(() => useReviewModel("cut"))
    const m = result.current
    expect(m.planId).toBe("plan")
    expect(m.planKind).toBe("edl")
    expect(m.base).toEqual(normalizeEdl(PLAN))
    expect(m.basis).toBe(editPlanBasis(PLAN))
    expect(m.reviewable).toBe(true)
    expect(m.editStatus).toBe("none")
    expect(m.seedKept).toEqual(keptSetOf(normalizeEdl(PLAN)))
    expect(m.transcript?.words).toHaveLength(5)
    expect(m.paragraphs.map((p) => p.speaker)).toEqual(["A", "B"])
    expect(m.render).toEqual({ output: "video", crossfadeMs: 0, sources: [] })
    expect(m.planProblems).toEqual([])
    expect(m.locked).toBe(false)
    expect(m.newerRun).toBeNull()
  })

  it("with no transcript on the plan's wire, opens in Cuts-only mode", () => {
    load({ transcript: false })
    const { result } = renderHook(() => useReviewModel("cut"))
    expect(result.current.transcript).toBeNull()
    expect(result.current.paragraphs).toEqual([])
  })

  it("a render no Edit Plan feeds has no plan, and nothing to edit", () => {
    useWorkflowStore.setState({ edges: [] as never })
    const { result } = renderHook(() => useReview())
    expect(result.current.model.planId).toBeNull()
    expect(result.current.edits.kept).toBeNull()
    expect(result.current.edits.canEdit).toBe(false)
  })

  it("shows the take on display, and the newest Preview beside a Final", () => {
    load({
      cut: {
        quality: "final",
        generatedResults: [
          { url: "https://cdn.test/final.mp4", quality: "final" },
          { url: "https://cdn.test/preview.mp4", quality: "proxy" },
        ],
        activeResultIndex: 0,
      },
    })
    const { result } = renderHook(() => useReviewModel("cut"))
    expect(result.current.take).toMatchObject({ url: "https://cdn.test/final.mp4", quality: "final" })
    expect(result.current.previewTake).toMatchObject({ url: "https://cdn.test/preview.mp4", quality: "proxy" })
  })

  it("locks edits while a live run includes the render or its plan, and on a read-only canvas (R9 a)", () => {
    load({ cut: { executionStatus: "pending" } })
    expect(renderHook(() => useReviewModel("cut")).result.current.locked).toBe(true)
    load({ plan: { currentJobId: "job-1" } })
    expect(renderHook(() => useReviewModel("cut")).result.current.locked).toBe(true)
    load()
    useWorkflowStore.setState({ isReadOnly: true })
    expect(renderHook(() => useReviewModel("cut")).result.current.locked).toBe(true)
  })
})

describe("useReviewEdits: K, its debounced write and undo (§2.2)", () => {
  it("a cut changes K at once and is written to the plan once the edits pause", () => {
    const { result } = renderHook(() => useReview())
    act(() => result.current.edits.cutRange(SO))
    expect(result.current.edits.kept).toEqual([{ inMs: 0, outMs: 100 }, { inMs: 400, outMs: 4000 }, { inMs: 5000, outMs: 9000 }])
    expect(planData().editedEdl).toBeUndefined()
    act(() => vi.advanceTimersByTime(REVIEW_WRITE_IDLE_MS))
    const stored = planData().editedEdl as { basis: string; kind: string }
    expect(stored).toMatchObject({ v: 1, kind: "edl", basis: editPlanBasis(PLAN) })
    expect(resolveEditPlanOutput(PLAN, stored).status).toBe("applied")
  })

  it("flush writes the pending edit now (before a run, a close, a reload)", () => {
    const { result } = renderHook(() => useReview())
    act(() => result.current.edits.cutRange(SO))
    act(() => result.current.edits.flush())
    expect(planData().editedEdl).toBeDefined()
  })

  it("unmounting and pagehide flush too", () => {
    const first = renderHook(() => useReview())
    act(() => first.result.current.edits.cutRange(SO))
    first.unmount()
    expect(planData().editedEdl).toBeDefined()

    load()
    const second = renderHook(() => useReview())
    act(() => second.result.current.edits.cutRange({ inMs: 500, outMs: 800 }))
    act(() => {
      window.dispatchEvent(new Event("pagehide"))
    })
    expect(planData().editedEdl).toBeDefined()
  })

  it("K back at the plan's clears the review (R7 a): an un-edited plan never shows EDITED", () => {
    const { result } = renderHook(() => useReview())
    act(() => result.current.edits.cutRange(SO))
    act(() => result.current.edits.flush())
    expect(planData().editedEdl).toBeDefined()
    act(() => result.current.edits.undo())
    act(() => result.current.edits.flush())
    expect(planData().editedEdl).toBeUndefined()
  })

  it("Reset to plan clears the review now, and is a step undo can take back", () => {
    const { result } = renderHook(() => useReview())
    act(() => result.current.edits.cutRange(SO))
    act(() => result.current.edits.resetToPlan())
    expect(planData().editedEdl).toBeUndefined()
    expect(result.current.edits.kept).toEqual(keptSetOf(normalizeEdl(PLAN)))
    act(() => result.current.edits.undo())
    expect(result.current.edits.kept).not.toEqual(keptSetOf(normalizeEdl(PLAN)))
  })

  it("undo outlives the dialog: reopening the same plan gets the history back (R8 a)", () => {
    const first = renderHook(() => useReview())
    act(() => first.result.current.edits.cutRange(SO))
    first.unmount()
    const second = renderHook(() => useReview())
    expect(second.result.current.edits.kept).toEqual(first.result.current.edits.kept)
    expect(second.result.current.edits.canUndo).toBe(true)
    act(() => second.result.current.edits.undo())
    expect(second.result.current.edits.kept).toEqual(keptSetOf(normalizeEdl(PLAN)))
    act(() => second.result.current.edits.redo())
    expect(second.result.current.edits.kept).toEqual(first.result.current.edits.kept)
  })

  it("restores a reason, and a whole-word selection", () => {
    const { result } = renderHook(() => useReview())
    act(() => {
      result.current.edits.restoreReason("filler")
    })
    expect(result.current.edits.kept).toEqual([{ inMs: 0, outMs: 9000 }])
    act(() => result.current.edits.cutReason("filler"))
    expect(result.current.edits.kept).toEqual(keptSetOf(normalizeEdl(PLAN)))
    // The selection "um" (word 3) is struck; restoring it keeps exactly its time.
    act(() => {
      result.current.edits.restoreSelection({ anchor: 3, focus: 3 })
    })
    expect(result.current.edits.kept).toEqual([{ inMs: 0, outMs: 4000 }, { inMs: 4200, outMs: 4600 }, { inMs: 5000, outMs: 9000 }])
    act(() => result.current.edits.cutSelection({ anchor: 3, focus: 3 }))
    expect(result.current.edits.kept).toEqual(keptSetOf(normalizeEdl(PLAN)))
  })

  it("while locked, every operation is a no-op", () => {
    load({ cut: { executionStatus: "pending" } })
    const { result } = renderHook(() => useReview())
    expect(result.current.edits.canEdit).toBe(false)
    act(() => result.current.edits.cutRange(SO))
    act(() => {
      result.current.edits.restoreReason("filler")
    })
    expect(result.current.edits.kept).toEqual(keptSetOf(normalizeEdl(PLAN)))
    act(() => result.current.edits.flush())
    expect(planData().editedEdl).toBeUndefined()
  })

  it("reopens on the applied edit's K", () => {
    const first = renderHook(() => useReview())
    act(() => first.result.current.edits.cutRange(SO))
    first.unmount()
    resetUndoStacks()
    const second = renderHook(() => useReview())
    expect(second.result.current.model.editStatus).toBe("applied")
    expect(second.result.current.edits.kept).toEqual(first.result.current.edits.kept)
  })

  it("a re-plan reseeds K from the new plan and drops the old history; an edit on the old plan is stale", () => {
    const { result } = renderHook(() => useReview())
    act(() => result.current.edits.cutRange(SO))
    act(() => result.current.edits.flush())
    const replanned = { ...PLAN, dropped: [{ inMs: 4000, outMs: 5000, reason: "silence" }] }
    act(() => {
      useWorkflowStore.getState().updateNodeData("plan", { generatedJson: replanned })
    })
    expect(result.current.model.editStatus).toBe("stale")
    expect(result.current.edits.kept).toEqual(keptSetOf(normalizeEdl(replanned)))
    expect(result.current.edits.canUndo).toBe(false)
    act(() => result.current.edits.discardStaleEdit())
    expect(planData().editedEdl).toBeUndefined()
  })

  it("a write still pending when a re-plan lands is dropped, never stored as a stale edit", () => {
    const { result } = renderHook(() => useReview())
    act(() => result.current.edits.cutRange(SO))
    act(() => {
      useWorkflowStore.getState().updateNodeData("plan", { generatedJson: { ...PLAN, meta: { title: "new" } } })
    })
    act(() => vi.advanceTimersByTime(REVIEW_WRITE_IDLE_MS))
    expect(planData().editedEdl).toBeUndefined()
  })
})

describe("useReviewChecks: the gate and the take's freshness over the pending edit", () => {
  /** A take stamped as a render of the plan value `value` would be, with the node's defaults. */
  function stampedTake(value: Record<string, unknown>) {
    const effective = buildEffectiveEdl(normalizeEdl(value), { crossfadeMs: 0, sourceOverrides: [] })
    return {
      url: "https://cdn.test/preview.mp4",
      quality: "proxy",
      planBasis: renderReadBasis(value),
      renderBasis: effectiveRenderBasis(effective, { output: "video", crossfadeMs: 0 }),
    }
  }

  it("the gate passes a plan the render can draw, and refuses an empty cut", () => {
    // The plan keeps one word; cutting it leaves nothing to render.
    load({ plan: { generatedJson: { ...PLAN, segments: [{ id: "s0", inMs: 100, outMs: 400, video: "cam" }], dropped: [] } } })
    const { result } = renderHook(() => useReview())
    expect(result.current.checks.verdict).toEqual({ ok: true })
    act(() => result.current.edits.cutRange(SO))
    expect(result.current.edits.kept).toEqual([])
    act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS))
    expect(result.current.checks.verdict?.ok).toBe(false)
    // Nothing was written yet: the gate read the pending edit.
    expect(planData().editedEdl).toBeUndefined()
  })

  it("hands the header the renders the Run would make, with the pending edit in place", () => {
    const { result } = renderHook(() => useReview())
    expect(result.current.checks.renders).toHaveLength(1)
    act(() => result.current.edits.cutRange(SO))
    act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS))
    const edl = result.current.checks.renders[0]!.edl
    const wired = (typeof edl === "string" ? JSON.parse(edl) : edl) as { segments: Array<{ inMs: number }> }
    // The edit cut "So" (100–400): the render reads the edit, not the stored plan.
    expect(wired.segments.map((g) => g.inMs)).toContain(400)
    expect(JSON.stringify(wired)).toContain("manual")
    expect(planData().editedEdl).toBeUndefined()
  })

  it("has no renders with no plan behind the render", () => {
    useWorkflowStore.setState({ edges: [] as never })
    const { result } = renderHook(() => useReview())
    expect(result.current.checks.renders).toEqual([])
  })

  it("a take cut from the plan as it stands is fresh, with a clock map; an edit makes it stale", () => {
    load({ cut: { generatedResults: [stampedTake(PLAN)], activeResultIndex: 0 } })
    const { result } = renderHook(() => useReview())
    expect(result.current.checks.fresh).toBe(true)
    expect(result.current.checks.staleTake).toBe(false)
    expect(result.current.checks.clockMap?.segments).toHaveLength(2)
    act(() => result.current.edits.cutRange(SO))
    act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS))
    expect(result.current.checks.fresh).toBe(false)
    expect(result.current.checks.staleTake).toBe(true)
    expect(result.current.checks.clockMap).toBeNull()
  })

  it("the newest Preview beside a Final on display gets its own freshness and clock map (A3-4's second tab)", () => {
    const final = { url: "https://cdn.test/final.mp4", quality: "final" }
    load({ cut: { generatedResults: [final, stampedTake(PLAN)], activeResultIndex: 0 } })
    const { result } = renderHook(() => useReview())
    expect(result.current.model.previewTake?.url).toBe("https://cdn.test/preview.mp4")
    // The Final carries no stamp: unknown, with no map. The Preview is fresh.
    expect(result.current.checks.clockMap).toBeNull()
    expect(result.current.checks.previewClockMap?.segments).toHaveLength(2)
    act(() => result.current.edits.cutRange(SO))
    act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS))
    expect(result.current.checks.previewClockMap).toBeNull()
  })

  it("a change to the render's own settings makes the take stale too (R19 a)", () => {
    load({ cut: { crossfadeMs: 300, generatedResults: [stampedTake(PLAN)], activeResultIndex: 0 } })
    const { result } = renderHook(() => useReview())
    expect(result.current.checks.fresh).toBe(false)
  })

  it("an unstamped take reads stale only once the plan holds an edit (fails open)", () => {
    load({ cut: { generatedResults: [{ url: "https://cdn.test/old.mp4", quality: "proxy" }], activeResultIndex: 0 } })
    const { result } = renderHook(() => useReview())
    expect(result.current.checks.fresh).toBeUndefined()
    expect(result.current.checks.staleTake).toBe(false)
    act(() => result.current.edits.cutRange(SO))
    act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS))
    expect(result.current.checks.staleTake).toBe(true)
  })
})
