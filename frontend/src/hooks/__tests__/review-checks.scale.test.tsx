import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

// Count the expensive reads: the render rule (a full run of it over the EDL),
// and the input resolver (which stringifies the transcript and the EDL).
vi.mock("@/components/editor/workflow-editor/render-final-checks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/workflow-editor/render-final-checks")>()
  return { ...actual, renderRuleVerdict: vi.fn(actual.renderRuleVerdict) }
})
vi.mock("@/components/editor/workflow-editor/node-input-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/workflow-editor/node-input-resolver")>()
  return { ...actual, resolveNodeInputs: vi.fn(actual.resolveNodeInputs) }
})

import { useWorkflowStore } from "../use-workflow-store"
import { useReviewModel } from "../use-review-model"
import { useReviewEdits } from "../use-review-edits"
import { useReviewChecks, REVIEW_CHECK_DEBOUNCE_MS } from "../use-review-checks"
import { renderRuleVerdict } from "@/components/editor/workflow-editor/render-final-checks"
import { resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { threeHourSession } from "@/lib/edl-review/__tests__/three-hour-fixture"

/**
 * The review's checks on the 3-hour episode while the canvas keeps changing
 * under the open inspector (§2.1: the verdict is debounced). A run's progress
 * and status ticks, and changes to nodes the render does not read, must not
 * recompute the gate, the freshness check, the transcript or the sources.
 */
const { base, transcript } = threeHourSession()
const plan = JSON.parse(JSON.stringify(base)) as unknown
const at = { x: 0, y: 0 }

function load() {
  useWorkflowStore.setState({
    nodes: [
      { id: "tr", type: "transcribe", position: at, data: { generatedJson: transcript } },
      { id: "plan", type: "edit-plan", position: at, data: { mode: "tighten", generatedJson: plan } },
      { id: "cut", type: "apply-edl", position: at, data: { quality: "proxy" } },
      { id: "other", type: "text", position: at, data: { text: "" } },
    ] as never,
    edges: [
      { id: "t", source: "tr", sourceHandle: "json", target: "plan", targetHandle: "transcript" },
      { id: "e", source: "plan", sourceHandle: "edl", target: "cut", targetHandle: "edl" },
    ] as never,
    isReadOnly: false,
    workflowId: null,
  })
}

function useReview() {
  const model = useReviewModel("cut")
  const edits = useReviewEdits(model)
  const checks = useReviewChecks(model, edits)
  return { model, edits, checks }
}

const verdictCalls = () => vi.mocked(renderRuleVerdict).mock.calls.length
const resolverCalls = () => vi.mocked(resolveNodeInputs).mock.calls.length
/** Resolutions of the plan's own inputs: the transcript read. */
const transcriptReads = () => vi.mocked(resolveNodeInputs).mock.calls.filter(([n]) => n.id === "plan").length

beforeEach(() => {
  vi.useFakeTimers()
  resetUndoStacks()
  load()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("the review's checks on the 3-hour fixture, under a changing canvas", () => {
  it("20 status and progress patches recompute the checks at most once, and still lock edits", () => {
    const { result } = renderHook(() => useReview())
    act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS * 2))
    expect(result.current.checks.verdict).toEqual({ ok: true })
    const verdicts = verdictCalls()
    const resolves = resolverCalls()
    for (let i = 0; i < 20; i++) {
      // Spaced wider than the debounce: each tick would settle on its own.
      act(() => {
        const store = useWorkflowStore.getState()
        store.updateNodeData(i % 2 === 0 ? "cut" : "plan", { executionStatus: "pending", currentJobProgress: i * 5 } as never)
        store.updateNodeData("tr", { currentJobProgress: i } as never)
      })
      act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS + 50))
    }
    expect(verdictCalls() - verdicts).toBeLessThanOrEqual(1)
    expect(resolverCalls() - resolves).toBeLessThanOrEqual(1)
    // The lock still reads the live run state (R9 a).
    expect(result.current.model.locked).toBe(true)
    expect(result.current.checks.verdict).toEqual({ ok: true })
  })

  it("20 edits to a node the render does not read recompute nothing", () => {
    renderHook(() => useReview())
    act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS * 2))
    const verdicts = verdictCalls()
    const resolves = resolverCalls()
    for (let i = 0; i < 20; i++) {
      act(() => useWorkflowStore.getState().updateNodeData("other", { text: `draft ${i}` } as never))
      act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS + 50))
    }
    expect(verdictCalls() - verdicts).toBe(0)
    expect(resolverCalls() - resolves).toBe(0)
  })

  it("a burst of review edits recomputes the checks once, after the edits pause", () => {
    const { result } = renderHook(() => useReview())
    act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS * 2))
    const verdicts = verdictCalls()
    const words = transcript.words
    for (let i = 0; i < 20; i++) {
      const w = words[i * 30]!
      act(() => result.current.edits.cutRange({ inMs: w.startMs, outMs: w.endMs }))
      act(() => vi.advanceTimersByTime(20))
    }
    expect(verdictCalls() - verdicts).toBe(0)
    act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS))
    expect(verdictCalls() - verdicts).toBe(1)
  })

  it("the review's own writes to the plan do not re-read the transcript", () => {
    const { result } = renderHook(() => useReview())
    act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS * 2))
    const reads = transcriptReads()
    for (let i = 0; i < 5; i++) {
      const w = transcript.words[i * 30]!
      act(() => result.current.edits.cutRange({ inMs: w.startMs, outMs: w.endMs }))
      act(() => result.current.edits.flush())
      act(() => vi.advanceTimersByTime(REVIEW_CHECK_DEBOUNCE_MS))
    }
    expect((useWorkflowStore.getState().nodes.find((n) => n.id === "plan")!.data as Record<string, unknown>).editedEdl).toBeDefined()
    expect(transcriptReads() - reads).toBe(0)
    expect(result.current.model.transcript?.words.length).toBe(transcript.words.length)
  })
})
