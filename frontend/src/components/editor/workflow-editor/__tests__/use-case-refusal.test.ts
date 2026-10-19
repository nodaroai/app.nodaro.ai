import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * A use-case continuation refused before any work (every clip dropped in the
 * review, decided 2026-10-18) is no failed run: on the live run's repaint and
 * on a reopen the node keeps its Preview and its state — its list rebuilt from
 * its takes (a Render final clears it when it starts) — so Render final is
 * there again once a clip is kept; the live lane says the refusal once.
 */
const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_c, nodes) => nodes),
  applyEdgeChanges: vi.fn((_c, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyBackendExecutionState } from "@/hooks/use-workflow-persistence"
import { usecaseRenderFinalOffered } from "@/lib/use-case-render-final-target"
import { paintRunStates } from "../run-handlers"

const WRAPPER = "00000000-0000-4000-8000-0000000000c1"
const SETTINGS = { reviewBeforeRender: true, captions: true }
const take = (i: number) => ({ url: `https://r2/p${i}.mp4`, quality: "proxy", jobId: WRAPPER, clipKey: `k${i}`, planBasis: `pb${i}`, useCaseSettings: SETTINGS })
/** The node as a Render final leaves it when it starts: its takes kept, its list cleared, pending. */
const startedFinal = () => ({
  id: "cp", type: "clip-pack", position: { x: 0, y: 0 },
  data: { label: "Clip Pack", ...SETTINGS, executionStatus: "pending", useCaseJobId: WRAPPER, generatedResults: [take(0), take(1)], activeResultIndex: 0 },
})
const REFUSED = { status: "failed", errorCode: "use_case_nothing_kept", error: "Every clip was dropped in the review: keep at least one clip to render the final." }
const LIST = {
  __listResults: ["https://r2/p0.mp4", "https://r2/p1.mp4"],
  __listResultStamps: [{ quality: "proxy", clipKey: "k0", planBasis: "pb0", jobId: WRAPPER }, { quality: "proxy", clipKey: "k1", planBasis: "pb1", jobId: WRAPPER }],
}
const cp = () => useWorkflowStore.getState().nodes.find((n) => n.id === "cp")!

beforeEach(() => {
  toastError.mockClear()
  useWorkflowStore.setState({ nodes: [startedFinal()] as never, edges: [], isReadOnly: false })
})
afterEach(() => useWorkflowStore.setState({ nodes: [], edges: [] }))

describe("the live run's repaint", () => {
  it("puts the node back as it was — completed, its Preview, its list — and says the refusal once", () => {
    paintRunStates({ cp: REFUSED } as never, { runId: "exec-1" })
    const data = cp().data as Record<string, unknown>
    expect(data).toMatchObject({ executionStatus: "completed", generatedResults: [take(0), take(1)], ...LIST })
    expect(data.errorCode).toBeUndefined()
    expect(data.errorMessage).toBeUndefined()
    expect(usecaseRenderFinalOffered(cp())).toBe(true)
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith("Every clip was dropped in the review: keep at least one clip to render the final.", { id: "use-case-refused-cp" })
    // Every later repaint of that run finds it landed: nothing written, nothing said again.
    const before = cp().data
    paintRunStates({ cp: REFUSED } as never, { runId: "exec-1" })
    expect(cp().data).toBe(before)
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it("any other failure is still a failed run", () => {
    paintRunStates({ cp: { status: "failed", errorCode: "render_final_not_preview", error: "x" } } as never, { runId: "exec-2" })
    expect((cp().data as Record<string, unknown>).executionStatus).toBe("failed")
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe("a reopen of that run", () => {
  it("lands the node as it was, never failed (and says nothing: the refusal was the click's)", () => {
    const [node] = applyBackendExecutionState([startedFinal()] as never, { cp: REFUSED } as never, { runId: "exec-1" })
    const data = node!.data as Record<string, unknown>
    expect(data).toMatchObject({ executionStatus: "completed", ...LIST })
    expect(data.errorCode).toBeUndefined()
    expect(usecaseRenderFinalOffered(node)).toBe(true)
    expect(toastError).not.toHaveBeenCalled()
  })
})
