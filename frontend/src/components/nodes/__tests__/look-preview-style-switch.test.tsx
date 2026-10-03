/**
 * The real / illustration switch on a look-picker node.
 *
 *  1. Cloud: the switch sits beside the option title and the node shows its
 *     render; clicking the pen writes `previewStyle: "illustration"` on THIS
 *     node, clears its height (the card re-fits) and remembers the choice for
 *     the next node of the same type.
 *  2. A node saved as "illustration" shows the drawing, not the render.
 *  3. The switch never appears where it can do nothing: a self-hosted install
 *     (no renders registered) or a render-only picker (Era).
 *  4. Mood: the illustration is the emoji beside the label.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { LOOK_PREVIEW_SETS, registerLookPreviews, resetLookPreviewsForTests } from "@nodaro/picker-ui"

let mockNodes: Array<{ id: string; type: string; data: Record<string, unknown> }> = []
const updateNodeData = vi.fn()
const updateNode = vi.fn()
const setStickyLookPreviewStyle = vi.fn()

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "n1"),
  useUpdateNodeInternals: vi.fn(() => vi.fn()),
  useConnection: vi.fn(() => ({ inProgress: false })),
}))

vi.mock("@/lib/parameter-node-prefs", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setStickyLookPreviewStyle: (...args: unknown[]) => setStickyLookPreviewStyle(...args),
}))

vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: () => null,
}))
vi.mock("../handle-icon", () => ({ HandleIcon: () => null }))
vi.mock("../base-node", () => ({ BaseNode: ({ children }: any) => <div>{children}</div> }))
vi.mock("../run-node-button", () => ({ RunNodeButton: () => null }))

vi.mock("@/hooks/use-workflow-store", () => ({
  EXECUTION_DATA_KEYS: new Set(["executionStatus"]),
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({ updateNodeData, updateNode, runFromHere: () => {}, openFullscreenSettings: () => {}, nodes: mockNodes, edges: [], loadGeneration: 0 }),
    { getState: () => ({ nodes: mockNodes, edges: [] }) },
  ),
}))

import { StyleNode } from "../style-node"
import { EraNode } from "../era-node"
import { MoodNode } from "../mood-node"

const REAL = "Preview: Real preview"
const ILLUSTRATION = "Preview: Illustration"

function renderNode(Node: any, type: string, data: Record<string, unknown>) {
  mockNodes = [{ id: "n1", type, data }]
  return render(<Node id="n1" data={data} selected type={type} {...({} as any)} />)
}

beforeEach(() => {
  updateNodeData.mockClear()
  updateNode.mockClear()
  setStickyLookPreviewStyle.mockClear()
})
afterEach(() => resetLookPreviewsForTests())

describe("look preview style switch on the node", () => {
  it("cloud: shows the render with Real selected, and switching writes the node + the sticky default", () => {
    registerLookPreviews(LOOK_PREVIEW_SETS)
    const { container } = renderNode(StyleNode, "style", { label: "Style", style: "anime" })
    expect(container.querySelector("img")?.getAttribute("srcset")).toContain("cdn.nodaro.ai")
    expect(screen.getByLabelText(REAL)).toHaveAttribute("aria-selected", "true")

    fireEvent.click(screen.getByLabelText(ILLUSTRATION))
    expect(updateNodeData).toHaveBeenCalledWith("n1", { previewStyle: "illustration" })
    expect(updateNode).toHaveBeenCalledWith("n1", { height: undefined })
    expect(setStickyLookPreviewStyle).toHaveBeenCalledWith("style", "illustration")
  })

  it("a node saved as illustration shows the drawing, not the render", () => {
    registerLookPreviews(LOOK_PREVIEW_SETS)
    const { container } = renderNode(StyleNode, "style", { label: "Style", style: "anime", previewStyle: "illustration" })
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByLabelText(ILLUSTRATION)).toHaveAttribute("aria-selected", "true")
  })

  it("self-hosted: no renders registered, so no switch", () => {
    renderNode(StyleNode, "style", { label: "Style", style: "anime" })
    expect(screen.queryByLabelText(REAL)).toBeNull()
  })

  it("a render-only picker (Era) gets no switch", () => {
    registerLookPreviews(LOOK_PREVIEW_SETS)
    renderNode(EraNode, "era", { label: "Era", era: "1920s-flapper" })
    expect(screen.queryByLabelText(REAL)).toBeNull()
  })

  it("mood: illustration puts the emoji back beside the label", () => {
    registerLookPreviews(LOOK_PREVIEW_SETS)
    const real = renderNode(MoodNode, "mood", { label: "Mood", mood: "calm" })
    expect(real.container.querySelector("img")).not.toBeNull()
    real.unmount()
    const drawn = renderNode(MoodNode, "mood", { label: "Mood", mood: "calm", previewStyle: "illustration" })
    expect(drawn.container.querySelector("img")).toBeNull()
    expect(drawn.container.querySelector("span[aria-hidden]")?.textContent ?? "").not.toBe("")
  })
})
