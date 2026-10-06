import { describe, it, expect, vi } from "vitest"
import { resolveEditPlanOutput } from "@nodaro/shared"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useWorkflowStore } from "../use-workflow-store"
import { cutRange, keptSetOf } from "@/lib/edl-review/kept-set"
import { restoreReason } from "@/lib/edl-review/restore"
import { transcriptOffsetMs } from "@/lib/edl-review/word-index"
import { reviewOf, writeReview } from "@/lib/edl-review/write-review"
import { budgetMs, fastestMs, threeHourSession, THREE_HOUR_RENDER } from "@/lib/edl-review/__tests__/three-hour-fixture"

/**
 * The flushed write on the 3-hour episode (§8 of the inspectors design: A3-2
 * measures the flushed write and the autosave size). A review of a long
 * episode is 0.3–1 MB, and every write of it wakes the editor, which is why the
 * inspector writes debounced. These bound the write itself and the size it
 * adds to the saved workflow.
 */
describe("the flushed review write on the 3-hour fixture", () => {
  const { base, transcript } = threeHourSession()
  const plan = JSON.parse(JSON.stringify(base)) as unknown
  const off = transcriptOffsetMs(base, transcript)
  // A heavy review: every filler restored, and a cut every 60th word.
  let kept = restoreReason(keptSetOf(base), base, "filler", THREE_HOUR_RENDER).kept
  for (let w = 0; w < transcript.words.length; w += 60) {
    const word = transcript.words[w]!
    kept = cutRange(kept, { inMs: word.startMs + off, outMs: word.endMs + off }, transcript.words, off)
  }
  const at = { x: 0, y: 0 }
  const load = () =>
    useWorkflowStore.setState({
      nodes: [
        { id: "tr", type: "transcribe", position: at, data: { generatedJson: transcript } },
        { id: "plan", type: "edit-plan", position: at, data: { mode: "tighten", generatedJson: plan } },
        { id: "cut", type: "apply-edl", position: at, data: {} },
      ] as never,
      edges: [{ id: "e", source: "plan", sourceHandle: "edl", target: "cut", targetHandle: "edl" }] as never,
      isReadOnly: false,
    })

  it("the stored edit stays near the design's 0.3–1 MB, and applies", () => {
    const review = reviewOf(plan, base, kept)!
    const bytes = JSON.stringify(review).length
    expect(resolveEditPlanOutput(plan, review).status).toBe("applied")
    expect(bytes).toBeGreaterThan(100_000)
    expect(bytes).toBeLessThan(1_500_000)
  })

  it("the write itself (building the edit and the store update) stays well inside a frame budget of a few frames", () => {
    load()
    const ms = fastestMs(() => {
      load()
      writeReview("plan", plan, base, kept)
    })
    expect((useWorkflowStore.getState().nodes[1]!.data as Record<string, unknown>).editedEdl).toBeDefined()
    expect(ms).toBeLessThan(budgetMs(100))
  })

  it("the review adds what it weighs to the saved workflow, and no more", () => {
    load()
    const before = JSON.stringify(useWorkflowStore.getState().nodes).length
    writeReview("plan", plan, base, kept)
    const after = JSON.stringify(useWorkflowStore.getState().nodes).length
    const review = JSON.stringify(reviewOf(plan, base, kept)).length
    expect(after - before).toBeLessThanOrEqual(review + 32)
  })
})
