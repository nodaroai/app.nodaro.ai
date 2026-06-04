import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

// Mock React Flow's hooks used by CanvasControls.
const zoomTo = vi.fn()
const setCenter = vi.fn()
const selectNode = vi.fn()
let flowNodes: Array<Record<string, unknown>> = []
let storeState: { width: number; height: number; transform: [number, number, number] } = {
  width: 1000,
  height: 800,
  transform: [0, 0, 1],
}
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomTo,
    getNodes: () => flowNodes,
    setCenter,
  }),
  useStoreApi: () => ({ getState: () => storeState }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: { selectNode: typeof selectNode }) => unknown) =>
    selector({ selectNode }),
}))

import { CanvasControls, ZoomControl } from "../canvas-controls"

// jsdom doesn't implement Pointer Capture; stub so the handlers don't throw.
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, writable: true, value: () => {} })
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, writable: true, value: () => {} })

function pointer(el: HTMLElement, type: "down" | "move" | "up", x: number, y: number, pointerId = 1) {
  fireEvent[type === "down" ? "pointerDown" : type === "move" ? "pointerMove" : "pointerUp"](el, {
    clientX: x,
    clientY: y,
    pointerId,
  })
}

afterEach(() => {
  vi.useRealTimers()
  zoomTo.mockClear()
  setCenter.mockClear()
  selectNode.mockClear()
  flowNodes = []
  storeState = { width: 1000, height: 800, transform: [0, 0, 1] }
})

describe("ZoomControl", () => {
  function setup(zoom = 0.882) {
    const onSetZoom = vi.fn()
    const onReset = vi.fn()
    render(<ZoomControl zoom={zoom} onSetZoom={onSetZoom} onReset={onReset} />)
    return { onSetZoom, onReset, el: screen.getByTestId("zoom-value") }
  }

  it("displays the current zoom percentage", () => {
    setup(0.882)
    expect(screen.getByText("88.2%")).toBeInTheDocument()
  })

  it("double-tap (two quick taps) resets to 100% and does not scrub", () => {
    const { onReset, onSetZoom, el } = setup(0.5)
    pointer(el, "down", 100, 100)
    pointer(el, "up", 100, 100)
    pointer(el, "down", 101, 100) // 2nd tap, < threshold apart → double
    pointer(el, "up", 101, 100)
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(onSetZoom).not.toHaveBeenCalled()
  })

  it("single tap opens the number editor; typing + Enter sets the zoom", () => {
    vi.useFakeTimers()
    const { onSetZoom, el } = setup(0.5)
    pointer(el, "down", 100, 100)
    pointer(el, "up", 100, 100)
    act(() => {
      vi.advanceTimersByTime(260) // tap timer fires → edit mode
    })
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "150" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSetZoom).toHaveBeenCalledWith(1.5, expect.anything())
  })

  it("Escape cancels the editor without changing zoom", () => {
    vi.useFakeTimers()
    const { onSetZoom, el } = setup(0.5)
    pointer(el, "down", 100, 100)
    pointer(el, "up", 100, 100)
    act(() => {
      vi.advanceTimersByTime(260)
    })
    const input = screen.getByRole("textbox")
    fireEvent.keyDown(input, { key: "Escape" })
    expect(onSetZoom).not.toHaveBeenCalled()
  })

  it("dragging up scrubs the zoom higher", () => {
    const { onSetZoom, el } = setup(1)
    pointer(el, "down", 100, 200)
    pointer(el, "move", 100, 100) // moved up 100px → zoom in
    expect(onSetZoom).toHaveBeenCalled()
    const lastZoom = onSetZoom.mock.calls.at(-1)![0]
    expect(lastZoom).toBeGreaterThan(1)
    pointer(el, "up", 100, 100)
  })
})

describe("CanvasControls", () => {
  function renderControls(zoom = 1) {
    return render(
      <CanvasControls
        zoom={zoom}
        showMiniMap={false}
        onToggleMiniMap={() => {}}
        snapEnabled={false}
        onToggleSnap={() => {}}
        alignmentEnabled={false}
        onToggleAlignment={() => {}}
      />,
    )
  }

  it("renders the live zoom percentage", () => {
    renderControls(0.882)
    expect(screen.getByText("88.2%")).toBeInTheDocument()
  })

  it("+ / − snap to the ladder (100% → 125% / 75%)", () => {
    renderControls(1)
    fireEvent.click(screen.getByRole("button", { name: "Zoom In" }))
    expect(zoomTo).toHaveBeenCalledWith(1.25, expect.anything())
    zoomTo.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Zoom Out" }))
    expect(zoomTo).toHaveBeenCalledWith(0.75, expect.anything())
  })

  it("auto-focus centers on the node nearest the screen center and selects it", () => {
    // Pane 1000x800, viewport at origin, zoom 1 → screen center in flow = (500, 400).
    storeState = { width: 1000, height: 800, transform: [0, 0, 1] }
    flowNodes = [
      { id: "far", position: { x: 2000, y: 2000 }, measured: { width: 100, height: 100 } },
      // center (450+50, 350+50) = (500, 400) — exactly the screen center
      { id: "near", position: { x: 450, y: 350 }, measured: { width: 100, height: 100 } },
    ]
    renderControls()
    fireEvent.click(screen.getByRole("button", { name: "Focus nearest node" }))
    expect(setCenter).toHaveBeenCalledWith(500, 400, expect.objectContaining({ zoom: 1 }))
    expect(selectNode).toHaveBeenCalledWith("near")
  })

  it("auto-focus is a no-op when there are no eligible nodes", () => {
    flowNodes = []
    renderControls()
    fireEvent.click(screen.getByRole("button", { name: "Focus nearest node" }))
    expect(setCenter).not.toHaveBeenCalled()
    expect(selectNode).not.toHaveBeenCalled()
  })
})
