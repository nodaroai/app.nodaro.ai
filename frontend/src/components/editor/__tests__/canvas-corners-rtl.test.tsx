import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup, act } from "@testing-library/react"
import { minimapPosition } from "../canvas-corner-layout"

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), fitView: vi.fn(), setCenter: vi.fn(), getNodes: () => [], getViewport: () => ({ x: 0, y: 0, zoom: 1 }) }),
  useStoreApi: () => ({ getState: () => ({ nodeLookup: new Map() }) }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: (s: unknown) => unknown) => sel({ selectNode: vi.fn(), nodes: [] }),
}))

import { CanvasControls } from "../canvas-controls"
import { useLocaleStore } from "@/lib/locale-store"

afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

const controlsProps = {
  zoom: 1, showMiniMap: true, onToggleMiniMap: vi.fn(), snapEnabled: false, onToggleSnap: vi.fn(),
  alignmentEnabled: false, onToggleAlignment: vi.fn(), inlinePromptEnabled: false, onToggleInlinePrompt: vi.fn(), isMobile: false,
}

// The config drawer pins to the inline END. The other corner overlays of the
// canvas column must mirror with it or they collide under RTL: the controls
// bar belongs at the inline START (opposite the drawer), and the React Flow
// MiniMap — which lives inside the LTR-pinned canvas, so logical classes
// cannot reach it — must be told the drawer's corner explicitly.
describe("canvas column corners", () => {
  it("anchors the controls bar to the inline start", () => {
    act(() => useLocaleStore.getState().setLocale("he"))
    const { container } = render(<CanvasControls {...controlsProps} />)
    const bar = container.firstElementChild as HTMLElement
    expect(bar.className).toContain("start-4")
    expect(bar.className).not.toContain("left-4")
    // `start-4` only mirrors because the bar renders OUTSIDE `.react-flow`,
    // whose `direction: ltr` pin would resolve it to the left.
    expect(bar.closest(".react-flow")).toBeNull()
  })

  it("puts the minimap under the drawer's edge in both directions", () => {
    expect(minimapPosition(false)).toBe("bottom-right")
    expect(minimapPosition(true)).toBe("bottom-left")
  })
})
