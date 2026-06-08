import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"

// Configurable canvas (viewport) zoom via transform[2].
const h = vi.hoisted(() => ({ canvasZoom: 2 }))
vi.mock("@xyflow/react", () => ({ useStore: (sel: (s: unknown) => unknown) => sel({ transform: [0, 0, h.canvasZoom] }) }))
vi.mock("@/components/editor/config-panels/node-preset-dropdown", () => ({
  PresetDropdown: ({ zoom }: { zoom?: number }) => <div data-testid="preset" data-zoom={zoom} />,
}))
vi.mock("lucide-react", () => ({ MoreHorizontal: (p: Record<string, unknown>) => <span data-testid="more" {...p} /> }))

import { NodeTopToolbar } from "../node-top-toolbar"

const renderToolbar = (showActions = true) =>
  render(
    <NodeTopToolbar
      nodeId="n1"
      showActions={showActions}
      onMoreMenu={() => {}}
      onEnter={() => {}}
      onLeave={() => {}}
      onPresetOpenChange={() => {}}
    />,
  )

describe("NodeTopToolbar", () => {
  // The pill must be the SAME size as the floating title (EditableNodeLabel), which scales with the
  // canvas zoom only (floored at NODE_VISUAL_SCALE_FLOOR), NOT the per-node zoom. There is no
  // nodeZoom prop precisely so the pill can't drift from the title when a node is individually zoomed.
  it("scales by canvas zoom 1:1 above the floor (matches the floating title)", () => {
    h.canvasZoom = 2
    renderToolbar()
    expect(screen.getByTestId("preset").getAttribute("data-zoom")).toBe("2")
    // 3-dots glyph = round(2 × 13) = 26
    expect(screen.getByTestId("more").getAttribute("size")).toBe("26")
  })

  it("floors the scale at NODE_VISUAL_SCALE_FLOOR when zoomed out (matches EditableNodeLabel's floor)", () => {
    h.canvasZoom = 0.3 // below the 0.6 floor
    renderToolbar()
    expect(screen.getByTestId("preset").getAttribute("data-zoom")).toBe(String(NODE_VISUAL_SCALE_FLOOR))
  })

  it("shows only the preset pill (no ⋯ menu) when showActions is false", () => {
    h.canvasZoom = 1
    renderToolbar(false)
    expect(screen.getByTestId("preset")).toBeInTheDocument()
    expect(screen.queryByTestId("more")).toBeNull()
  })
})
