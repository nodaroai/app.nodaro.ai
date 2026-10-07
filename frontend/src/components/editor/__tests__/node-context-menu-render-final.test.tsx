// Render final from the context menu (A6.1): on a render it names the render
// itself; on an Edit Plan that feeds several renders it asks which, one render
// per entry (TA2 item 4, decided 2026-10-04). Update preview needs the flag.
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

const node = (id: string, type: string, label = id) => ({ id, type, position: { x: 0, y: 0 }, data: { label } })
const edge = (source: string, target: string, targetHandle?: string) => ({ id: `${source}->${target}`, source, target, ...(targetHandle ? { targetHandle } : {}) })
const renderFinal = vi.fn()

function open(nodeId: string, nodes: unknown[], edges: unknown[]) {
  useWorkflowStore.setState({ nodes: nodes as never, edges: edges as never, renderFinal } as never)
  return render(<NodeContextMenu nodeId={nodeId} x={0} y={0} onClose={vi.fn()} />)
}

beforeEach(() => {
  renderFinal.mockClear()
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
})
afterEach(() => {
  cleanup()
  delete window.__NODARO_RUNTIME__
})

describe("NodeContextMenu — Render final", () => {
  it("on a render: Render final and Update preview for that render", () => {
    open("r", [node("p", "edit-plan"), node("r", "apply-edl")], [edge("p", "r", "edl")])
    fireEvent.click(screen.getByText("Render final"))
    fireEvent.click(screen.getByText("Update preview"))
    expect(renderFinal.mock.calls).toEqual([["r", "final"], ["r", "proxy"]])
  })

  it("with the stop-rule flag off, Update preview is hidden and Render final stays (decided 2026-10-06)", () => {
    delete window.__NODARO_RUNTIME__
    open("r", [node("p", "edit-plan"), node("r", "apply-edl")], [edge("p", "r", "edl")])
    expect(screen.queryByText("Update preview")).toBeNull()
    expect(screen.getByText("Render final")).toBeTruthy()
  })

  it("on a plan that feeds one render: plain Render final, for that render", () => {
    open("p", [node("p", "edit-plan"), node("r", "apply-edl", "Apply Cut")], [edge("p", "r", "edl")])
    fireEvent.click(screen.getByText("Render final"))
    expect(renderFinal).toHaveBeenCalledWith("r", "final")
  })

  it("on a plan that feeds several: one entry per render, named, one render per click", () => {
    open(
      "p",
      [node("p", "edit-plan"), node("a", "apply-edl", "Cut A"), node("b", "apply-edl", "Cut B")],
      [edge("p", "a", "edl"), edge("p", "b", "edl")],
    )
    fireEvent.click(screen.getByText("Render final: Cut B"))
    expect(renderFinal.mock.calls).toEqual([["b", "final"]])
    expect(screen.getByText("Render final: Cut A")).toBeTruthy()
  })

  it("nothing on a node that is neither", () => {
    open("t", [node("t", "transcribe")], [])
    expect(screen.queryByText("Render final")).toBeNull()
  })
})
