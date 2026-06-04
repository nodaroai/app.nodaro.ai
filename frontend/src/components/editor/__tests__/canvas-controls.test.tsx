import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Mock React Flow's hook — CanvasControls only uses useReactFlow().
const zoomTo = vi.fn()
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomTo,
  }),
}))

import { CanvasControls, formatZoomPercent } from "../canvas-controls"

describe("formatZoomPercent", () => {
  it("formats a 1.0 zoom as a round 100%", () => {
    expect(formatZoomPercent(1)).toBe("100%")
  })

  it("keeps one decimal for non-round zooms", () => {
    expect(formatZoomPercent(0.882)).toBe("88.2%")
    expect(formatZoomPercent(1.8)).toBe("180%")
  })

  it("drops the trailing .0 for whole percentages", () => {
    expect(formatZoomPercent(0.75)).toBe("75%")
    expect(formatZoomPercent(0.2)).toBe("20%")
    expect(formatZoomPercent(8)).toBe("800%")
  })

  it("rounds to a single decimal place", () => {
    expect(formatZoomPercent(0.8823)).toBe("88.2%")
    expect(formatZoomPercent(0.33337)).toBe("33.3%")
  })
})

describe("CanvasControls zoom indicator", () => {
  beforeEach(() => zoomTo.mockClear())

  function renderControls(zoom = 0.882) {
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

  it("shows the current zoom percentage", () => {
    renderControls(0.882)
    expect(screen.getByText("88.2%")).toBeInTheDocument()
  })

  it("resets the canvas to 100% when the percentage is clicked", () => {
    renderControls(0.5)
    fireEvent.click(screen.getByRole("button", { name: /reset to 100%/i }))
    expect(zoomTo).toHaveBeenCalledWith(1, expect.objectContaining({ duration: expect.any(Number) }))
  })
})
