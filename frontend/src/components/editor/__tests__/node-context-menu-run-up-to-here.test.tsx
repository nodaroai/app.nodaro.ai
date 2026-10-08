// "Run up to here" in the node context menu (decided 2026-10-08): offered on a
// node with upstream nodes that have not run yet; one click hands the node to
// the editor's run-up-to-here action; hidden when there is nothing to run.
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

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const edge = (source: string, target: string) => ({ id: `${source}->${target}`, source, target })
const ranImage = { generatedResults: [{ url: "https://cdn/x.png" }], activeResultIndex: 0 }
const runUpToHere = vi.fn()

function open(nodeId: string, nodes: unknown[], edges: unknown[], fn: unknown = runUpToHere) {
  useWorkflowStore.setState({ nodes: nodes as never, edges: edges as never, runUpToHere: fn as never } as never)
  const onClose = vi.fn()
  render(<NodeContextMenu nodeId={nodeId} x={0} y={0} onClose={onClose} />)
  return onClose
}

beforeEach(() => runUpToHere.mockClear())
afterEach(() => cleanup())

describe("NodeContextMenu — Run up to here", () => {
  it("offered on a node with upstream nodes that have not run; one click runs them", () => {
    const onClose = open("b", [node("a", "generate-image"), node("b", "generate-image")], [edge("a", "b")])
    fireEvent.click(screen.getByText("Run up to here"))
    expect(runUpToHere).toHaveBeenCalledWith("b")
    expect(onClose).toHaveBeenCalled()
  })

  it("not offered on a node with nothing upstream", () => {
    open("a", [node("a", "generate-image"), node("b", "generate-image")], [edge("a", "b")])
    expect(screen.queryByText("Run up to here")).toBeNull()
  })

  it("not offered when everything upstream has already run", () => {
    open("b", [node("a", "generate-image", ranImage), node("b", "generate-image")], [edge("a", "b")])
    expect(screen.queryByText("Run up to here")).toBeNull()
  })

  it("not offered on a read-only canvas (no action registered)", () => {
    open("b", [node("a", "generate-image"), node("b", "generate-image")], [edge("a", "b")], null)
    expect(screen.queryByText("Run up to here")).toBeNull()
  })
})
