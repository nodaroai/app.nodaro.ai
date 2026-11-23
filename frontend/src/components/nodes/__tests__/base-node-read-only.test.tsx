import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react"

// NodeToolbar honours `isVisible`, so what BaseNode would show is observable.
vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ id, type }: any) => <div data-testid={`handle-${id}`} data-type={type} />,
  NodeToolbar: ({ children, isVisible }: any) =>
    isVisible ? <div data-testid="node-toolbar">{children}</div> : null,
  NodeResizeControl: ({ position }: any) => <div data-testid="resize-control" data-position={position} />,
  useStore: (sel: any) => sel({ transform: [0, 0, 1], elementsSelectable: false }),
  useUpdateNodeInternals: () => () => {},
}))
vi.mock("../custom-handle", () => ({ CustomHandle: () => <div data-testid="zoom-handle" /> }))
vi.mock("../node-top-toolbar", () => ({ NodeTopToolbar: () => <div data-testid="top-toolbar" /> }))
vi.mock("@/components/editor/mobile-canvas-context", () => ({ useMobileCanvas: () => ({ isMobile: false }) }))
vi.mock("@/hooks/use-alt-key", () => ({ useAltKeyStore: (selector: any) => selector({ pressed: false }) }))
vi.mock("@/components/editor/workflow-editor/use-node-insert-animation", () => ({ useNodeInsertAnimation: () => undefined }))
vi.mock("@/lib/edition", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/edition")>()), hasCredits: () => true }))

const store = vi.hoisted(() => ({
  setState: vi.fn(),
  openFullscreenSettings: vi.fn(),
}))
vi.mock("@/hooks/use-workflow-store", () => {
  const state = () => ({
    nodes: [{ id: "n1", type: "probe", data: {}, position: { x: 0, y: 0 } }],
    updateNodeWithData: () => {},
    openFullscreenSettings: store.openFullscreenSettings,
    selectNode: () => {},
    newNodeIds: new Set(),
    clearNewNode: () => {},
    selectedNodeId: null,
    inlinePromptMode: false,
  })
  return {
    useWorkflowStore: Object.assign((selector: any) => selector(state()), {
      getState: state,
      setState: store.setState,
    }),
  }
})

import { BaseNode } from "../base-node"
import { CanvasModeContext, type CanvasMode } from "../read-only-canvas-context"

function renderNode(mode: CanvasMode, props: Partial<React.ComponentProps<typeof BaseNode>> = {}) {
  return render(
    <CanvasModeContext.Provider value={mode}>
      <div className="react-flow__node">
        <BaseNode
          id="n1"
          label="Node"
          icon={<span data-testid="icon" />}
          category="ai"
          credits={30}
          handles={[]}
          topToolbarContent={<button type="button">RUNME</button>}
          {...props}
        />
      </div>
    </CanvasModeContext.Provider>,
  )
}

function hover(container: HTMLElement) {
  act(() => {
    fireEvent.mouseEnter(container.querySelector(".react-flow__node")!)
  })
}

describe("BaseNode on a view-only canvas", () => {
  afterEach(() => {
    cleanup()
    store.setState.mockClear()
  })

  it("control: on the editor's canvas, hover shows the run strip, the top toolbar and the resize corners", () => {
    const { container } = renderNode("editor")
    hover(container)
    expect(screen.getByText("RUNME")).toBeInTheDocument()
    expect(screen.getByTestId("top-toolbar")).toBeInTheDocument()
    expect(screen.getAllByTestId("resize-control").length).toBeGreaterThan(0)
  })

  it("shows no run strip, toolbar or resize corner on hover", () => {
    const { container } = renderNode("view")
    hover(container)
    expect(screen.queryByText("RUNME")).toBeNull()
    expect(screen.queryByTestId("top-toolbar")).toBeNull()
    expect(screen.queryByTestId("resize-control")).toBeNull()
  })

  it("shows no run strip even for a node saved mid-run", () => {
    renderNode("view", { isRunning: true })
    expect(screen.queryByText("RUNME")).toBeNull()
  })

  it("quotes no price and opens no settings from the header icon", () => {
    renderNode("view")
    expect(screen.queryByText("30cr")).toBeNull()
    fireEvent.click(screen.getByTestId("icon"))
    expect(store.openFullscreenSettings).not.toHaveBeenCalled()
  })

  it("on the view link's canvas (its own seeded store) still fits its box, as in the editor", () => {
    renderNode("view", { imageAspectRatio: 16 / 9 })
    expect(store.setState).toHaveBeenCalled()
  })

  it("in the sub-workflow viewer, never writes its box into the editor's store", () => {
    renderNode("view-detached", { imageAspectRatio: 16 / 9 })
    expect(store.setState).not.toHaveBeenCalled()
  })
})
