// Review cut (a Tighten EDL) and Review clips (a clip set, A4-2) in the node
// context menu (A3-5, R17 a): on a render with an Edit Plan cut behind it, and on
// that plan (one entry per render it feeds, named when there are several: one
// render per click, like Render final).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({ useReactFlow: () => ({ screenToFlowPosition: (p: unknown) => p }) }))
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }))
vi.mock("@/lib/node-docs/node-docs", () => ({ nodeDocsLinksShown: () => false, useNodeDocsUrl: () => null }))
vi.mock("../node-thumbnail", () => ({ nodeThumbnailUrl: () => null }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

import { NodeContextMenu } from "../node-context-menu"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useReviewOpenStore } from "@/hooks/use-review-open-store"

const TIGHTEN = { version: 1, clock: "master", sources: [], segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "cam" }], dropped: [] }
const node = (id: string, type: string, label = id, extra: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label, ...extra } })
const plan = (id = "p", generatedJson: unknown = TIGHTEN) => node(id, "edit-plan", id, { generatedJson })
const edge = (source: string, target: string, targetHandle?: string) => ({ id: `${source}->${target}`, source, target, ...(targetHandle ? { targetHandle } : {}) })

const onClose = vi.fn()
function open(nodeId: string, nodes: unknown[], edges: unknown[]) {
  useWorkflowStore.setState({ nodes: nodes as never, edges: edges as never, renderFinal: vi.fn() } as never)
  return render(<NodeContextMenu nodeId={nodeId} x={0} y={0} onClose={onClose} />)
}

beforeEach(() => {
  onClose.mockClear()
  useReviewOpenStore.setState({ hostMounted: true, renderId: null })
})
afterEach(() => {
  cleanup()
  useReviewOpenStore.setState({ hostMounted: false, renderId: null })
})

describe("NodeContextMenu — Review cut", () => {
  it("on a render: opens the review of that render and closes the menu", () => {
    open("r", [plan(), node("r", "apply-edl")], [edge("p", "r", "edl")])
    fireEvent.click(screen.getByText("Review cut"))
    expect(useReviewOpenStore.getState().renderId).toBe("r")
    expect(onClose).toHaveBeenCalled()
  })

  it("on a plan that feeds one render: plain Review cut, for that render", () => {
    open("p", [plan(), node("r", "apply-edl", "Apply Cut")], [edge("p", "r", "edl")])
    fireEvent.click(screen.getByText("Review cut"))
    expect(useReviewOpenStore.getState().renderId).toBe("r")
  })

  it("on a plan that feeds several: one entry per render, named, one render per click", () => {
    open(
      "p",
      [plan(), node("a", "apply-edl", "Cut A"), node("b", "apply-edl", "Cut B")],
      [edge("p", "a", "edl"), edge("p", "b", "edl")],
    )
    fireEvent.click(screen.getByText("Review cut: Cut B"))
    expect(useReviewOpenStore.getState().renderId).toBe("b")
    expect(screen.getByText("Review cut: Cut A")).toBeTruthy()
  })

  it("is above Render final", () => {
    open("r", [plan(), node("r", "apply-edl")], [edge("p", "r", "edl")])
    const review = screen.getByText("Review cut")
    const final = screen.getByText("Render final")
    expect(review.compareDocumentPosition(final) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("on a clip set: Review clips, never Review cut, opening the same review of that render (A4-2)", () => {
    open("r", [plan("p", [TIGHTEN]), node("r", "apply-edl")], [edge("p", "r", "edl")])
    expect(screen.queryByText("Review cut")).toBeNull()
    fireEvent.click(screen.getByText("Review clips"))
    expect(useReviewOpenStore.getState().renderId).toBe("r")
    expect(onClose).toHaveBeenCalled()
  })

  it("on a clip set's plan that feeds several renders: Review clips, named per render", () => {
    open(
      "p",
      [plan("p", [TIGHTEN]), node("a", "apply-edl", "Clip A"), node("b", "apply-edl", "Clip B")],
      [edge("p", "a", "edl"), edge("p", "b", "edl")],
    )
    fireEvent.click(screen.getByText("Review clips: Clip B"))
    expect(useReviewOpenStore.getState().renderId).toBe("b")
    expect(screen.getByText("Review clips: Clip A")).toBeTruthy()
  })

  it("is not offered on a chapter list, a render with no plan, or a node of another kind", () => {
    open("r", [plan("p", { version: 1, chapters: [] }), node("r", "apply-edl")], [edge("p", "r", "edl")])
    expect(screen.queryByText("Review cut")).toBeNull()
    expect(screen.queryByText("Review clips")).toBeNull()
    cleanup()
    open("r", [node("r", "apply-edl")], [])
    expect(screen.queryByText("Review cut")).toBeNull()
    cleanup()
    open("t", [node("t", "transcribe")], [])
    expect(screen.queryByText("Review cut")).toBeNull()
  })

  it("is not offered where no inspector is mounted", () => {
    useReviewOpenStore.setState({ hostMounted: false })
    open("r", [plan(), node("r", "apply-edl")], [edge("p", "r", "edl")])
    expect(screen.queryByText("Review cut")).toBeNull()
  })
})
