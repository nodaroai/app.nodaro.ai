import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { render, screen } from "@testing-library/react"
import { LLMChatNode } from "../llm-chat-node"
import { MAX_OUTPUT_HEIGHT } from "../text-output-cap"

// Verifies the auto-grow CAP wiring on the Generate Text (llm-chat) node:
// content height is measured (ResizeObserver + scrollHeight, both stubbed here),
// and while the node is auto-sized the scroll region is pinned to
// MAX_OUTPUT_HEIGHT + `nowheel` once content exceeds ~10 lines — otherwise it
// fills via flex-1. Once the node is manually resized (`rf-resized`), the cap is
// lifted regardless of content height. Real scroll/layout is a Radix/CSS
// behavior the whole app relies on and isn't exercised by jsdom.

// Mutable store state the mock reads from (lets each test toggle rf-resized).
let storeNodes: Array<Record<string, unknown>> = []
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        updateNodeData: () => {},
        nodes: storeNodes,
        edges: [],
        selectedNodeId: null,
        userTextTemplates: [],
      }),
    { getState: () => ({ nodes: storeNodes, edges: [] }) },
  ),
}))

// Render children; we only care about what the node puts in the body.
vi.mock("../base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
  NodeToolbar: ({ children }: any) => <div>{children}</div>,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "node-1"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))

vi.mock("../handle-with-popover", () => ({
  HandleWithPopover: () => null,
  HANDLE_COLORS: { reference: "#000", list: "#000" },
  TEXT_HANDLE_COLOR: "#000",
}))

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return {
    MessageSquare: I, Type: I, Loader2: I, AlertCircle: I, X: I, FileText: I,
    Copy: I, Download: I, BookOpen: I, ImageIcon: I, List: I,
    LayoutGrid: I, LayoutTemplate: I, Sparkles: I, Braces: I, Eye: I,
  }
})

vi.mock("../llm-output-view", () => ({
  LlmOutputView: ({ text }: any) => <div>{text}</div>,
}))
vi.mock("../llm-chat-quick-toolbar", () => ({ LlmChatQuickToolbar: () => null }))
vi.mock("../results-thumbnails-panel", () => ({ ResultsThumbnailsPanel: () => null }))
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 3 }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/lib/generate-text-templates", () => ({
  getGenerateTextTemplate: () => ({ id: "custom", label: "Custom" }),
  GENERATE_TEXT_TEMPLATES: [{ id: "custom", label: "Custom" }],
}))
vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom")
  return { ...actual, createPortal: (node: any) => node }
})

// jsdom has no ResizeObserver and reports scrollHeight === 0. Stub both so the
// node's measurement effect reads a controllable natural content height.
let mockScrollHeight = 0
const origScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
beforeEach(() => {
  storeNodes = []
  mockScrollHeight = 0
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => mockScrollHeight,
  })
})
afterAll(() => {
  if (origScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", origScrollHeight)
})

function renderWithResult(opts: { contentHeight: number; resized?: boolean }) {
  mockScrollHeight = opts.contentHeight
  storeNodes = [{ id: "node-1", className: opts.resized ? "rf-resized" : "" }]
  return render(
    <LLMChatNode
      id="node-1"
      data={{ label: "Generate Text", templateId: "custom", generatedText: "result text" }}
      selected={false}
      {...({} as any)}
    />,
  )
}

describe("LLMChatNode output auto-grow cap", () => {
  it("caps + enables wheel-scroll once content exceeds ~10 lines (auto-sized)", () => {
    renderWithResult({ contentHeight: MAX_OUTPUT_HEIGHT + 200 })
    const scroll = screen.getByTestId("llm-output-scroll")
    expect(scroll).toHaveStyle({ height: `${MAX_OUTPUT_HEIGHT}px` })
    expect(scroll.className).toContain("nowheel")
    expect(scroll.className).not.toContain("flex-1")
  })

  it("fills (flex-1) and does not cap while content still fits", () => {
    renderWithResult({ contentHeight: MAX_OUTPUT_HEIGHT - 100 })
    const scroll = screen.getByTestId("llm-output-scroll")
    // No pinned height (Radix sets its own inline vars, but never `height`).
    expect(scroll.style.height).toBe("")
    expect(scroll.className).toContain("flex-1")
    expect(scroll.className).not.toContain("nowheel")
  })

  it("lifts the cap once the node is manually resized, even for tall content", () => {
    renderWithResult({ contentHeight: MAX_OUTPUT_HEIGHT + 5000, resized: true })
    const scroll = screen.getByTestId("llm-output-scroll")
    expect(scroll.style.height).toBe("")
    expect(scroll.className).toContain("flex-1")
    expect(scroll.className).not.toContain("nowheel")
  })
})
