import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// canvas (viewport) zoom = 2 via transform[2]
vi.mock("@xyflow/react", () => ({ useStore: (sel: (s: unknown) => unknown) => sel({ transform: [0, 0, 2] }) }))
vi.mock("@/components/editor/config-panels/node-preset-dropdown", () => ({
  PresetDropdown: ({ zoom }: { zoom?: number }) => <div data-testid="preset" data-zoom={zoom} />,
}))
vi.mock("lucide-react", () => ({ MoreHorizontal: (p: Record<string, unknown>) => <span data-testid="more" {...p} /> }))

import { NodeTopToolbar } from "../node-top-toolbar"

describe("NodeTopToolbar", () => {
  it("scales content by canvasZoom × nodeZoom so it tracks the node title", () => {
    render(
      <NodeTopToolbar
        nodeId="n1"
        nodeZoom={2}
        showActions
        onMoreMenu={() => {}}
        onEnter={() => {}}
        onLeave={() => {}}
        onPresetOpenChange={() => {}}
      />,
    )
    // canvasZoom(2) × nodeZoom(2) = 4
    expect(screen.getByTestId("preset").getAttribute("data-zoom")).toBe("4")
    // 3-dots glyph = round(4 × 13) = 52
    expect(screen.getByTestId("more").getAttribute("size")).toBe("52")
  })

  it("shows only the preset pill (no ⋯ menu) when showActions is false", () => {
    render(
      <NodeTopToolbar
        nodeId="n1"
        nodeZoom={1}
        showActions={false}
        onMoreMenu={() => {}}
        onEnter={() => {}}
        onLeave={() => {}}
        onPresetOpenChange={() => {}}
      />,
    )
    expect(screen.getByTestId("preset")).toBeInTheDocument()
    expect(screen.queryByTestId("more")).toBeNull()
  })
})
