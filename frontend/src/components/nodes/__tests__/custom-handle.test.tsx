import { describe, it, expect, vi } from "vitest"
import { render as rtlRender, screen, fireEvent } from "@testing-library/react"
import { ReactFlowProvider } from "@xyflow/react"
import { type ReactElement } from "react"
import { CustomHandle } from "../custom-handle"

const noop = () => {}

// CustomHandle reads `useStore((s) => s.transform[2])` from React Flow's
// internal store to inverse-scale at non-1 viewport zoom — needs a provider.
const render = (ui: ReactElement) => rtlRender(<ReactFlowProvider>{ui}</ReactFlowProvider>)

describe("CustomHandle visibility", () => {
  it("renders the zoom handle", () => {
    render(
      <CustomHandle
        visible
        onDragStart={noop}
        onDragMove={noop}
        onDragEnd={noop}
        onDoubleClick={noop}
      />,
    )
    expect(screen.getByTestId("zoom-handle")).toBeTruthy()
  })

  it("hides when visible=false", () => {
    const { container } = render(
      <CustomHandle
        visible={false}
        onDragStart={noop}
        onDragMove={noop}
        onDragEnd={noop}
        onDoubleClick={noop}
      />,
    )
    expect(container.querySelector('[data-testid="zoom-handle"]')).toBeNull()
  })

  it("uses a zoom cursor (custom SVG with zoom-in fallback)", () => {
    render(
      <CustomHandle visible
        onDragStart={noop} onDragMove={noop} onDragEnd={noop} onDoubleClick={noop} />,
    )
    const cursor = screen.getByTestId("zoom-handle").style.cursor
    // Custom SVG cursor with built-in `zoom-in` as the fallback after the URL.
    expect(cursor).toMatch(/zoom-in/)
    expect(cursor).toMatch(/svg/)
  })
})

function pointer(handle: HTMLElement, type: "down" | "move" | "up", x: number, y: number, pointerId = 1) {
  fireEvent[
    type === "down" ? "pointerDown" : type === "move" ? "pointerMove" : "pointerUp"
  ](handle, { clientX: x, clientY: y, pointerId })
}

describe("CustomHandle pointer events", () => {
  // jsdom doesn't implement Pointer Capture; stub so the component handlers don't throw.
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, writable: true, value: () => {} })
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, writable: true, value: () => {} })

  it("calls onDoubleClick on two pointerdowns within 220ms < 5px apart, NOT onDragStart", () => {
    const onDragStart = vi.fn()
    const onDoubleClick = vi.fn()
    render(
      <CustomHandle visible
        onDragStart={onDragStart} onDragMove={() => {}} onDragEnd={() => {}}
        onDoubleClick={onDoubleClick} />,
    )
    const h = screen.getByTestId("zoom-handle")
    pointer(h, "down", 100, 100)
    pointer(h, "up", 100, 100)
    pointer(h, "down", 102, 102) // < 5px, < 220ms
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
    expect(onDragStart).not.toHaveBeenCalled()
  })

  it("does NOT detect dblclick when second pointerdown is > 5px away", () => {
    const onDoubleClick = vi.fn()
    render(
      <CustomHandle visible
        onDragStart={() => {}} onDragMove={() => {}} onDragEnd={() => {}}
        onDoubleClick={onDoubleClick} />,
    )
    const h = screen.getByTestId("zoom-handle")
    pointer(h, "down", 100, 100)
    pointer(h, "up", 100, 100)
    pointer(h, "down", 110, 100) // > 5px
    expect(onDoubleClick).not.toHaveBeenCalled()
  })

  it("calls onDragStart on the first pointermove after pointerdown (no threshold)", () => {
    const onDragStart = vi.fn()
    const onDragMove = vi.fn()
    render(
      <CustomHandle visible
        onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={() => {}}
        onDoubleClick={() => {}} />,
    )
    const h = screen.getByTestId("zoom-handle")
    pointer(h, "down", 100, 100)
    pointer(h, "move", 101, 100) // first move, any distance — activates immediately
    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(onDragMove).toHaveBeenCalledTimes(1)
    pointer(h, "move", 110, 100)
    expect(onDragMove).toHaveBeenCalledTimes(2)
    expect(onDragStart).toHaveBeenCalledTimes(1) // not called again
  })

  it("calls onDragEnd on pointerup after an active drag", () => {
    const onDragEnd = vi.fn()
    render(
      <CustomHandle visible
        onDragStart={() => {}} onDragMove={() => {}} onDragEnd={onDragEnd}
        onDoubleClick={() => {}} />,
    )
    const h = screen.getByTestId("zoom-handle")
    pointer(h, "down", 100, 100)
    pointer(h, "move", 101, 100) // any move activates drag
    pointer(h, "up", 101, 100)
    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it("does NOT call onDragEnd on pointerup if drag never became active", () => {
    const onDragEnd = vi.fn()
    render(
      <CustomHandle visible
        onDragStart={() => {}} onDragMove={() => {}} onDragEnd={onDragEnd}
        onDoubleClick={() => {}} />,
    )
    const h = screen.getByTestId("zoom-handle")
    pointer(h, "down", 100, 100)
    pointer(h, "up", 100, 100) // no move
    expect(onDragEnd).not.toHaveBeenCalled()
  })
})
