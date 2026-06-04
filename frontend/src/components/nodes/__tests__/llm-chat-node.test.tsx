import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LLMChatNode } from "../llm-chat-node"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${type}-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  NodeToolbar: ({ children }: any) => <div data-testid="node-toolbar">{children}</div>,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({
    children, label, category, credits, id, isRunning, handles,
    topToolbarContent, rawToolbarContent, bottomToolbarContent, enableZoomHandle, keepTopToolbarVisible,
  }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
      data-is-running={isRunning}
      data-enable-zoom-handle={String(!!enableZoomHandle)}
      data-keep-top-toolbar-visible={String(!!keepTopToolbarVisible)}
    >
      {(handles ?? []).filter((h: any) => !h.external).map((h: any) => (
        <div key={`${h.type}-${h.id}`} data-testid={`handle-${h.type}-${h.id}`} data-type={h.type} data-position={h.position} />
      ))}
      {topToolbarContent}
      {rawToolbarContent}
      {bottomToolbarContent}
      {children}
    </div>
  ),
}))

vi.mock("../handle-with-popover", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HandleWithPopover: ({ nodeType, handleId, type, color, label }: any) => (
    <div
      data-testid={`handle-popover-${type}-${handleId}`}
      data-node-type={nodeType}
      data-handle-id={handleId}
      data-type={type}
      data-color={color}
      data-label={label}
    />
  ),
}))

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return {
    MessageSquare: I, Type: I, Loader2: I, AlertCircle: I, X: I, FileText: I,
    Copy: I, Download: I, BookOpen: I, ImageIcon: I, List: I,
    LayoutGrid: I, LayoutTemplate: I, Sparkles: I, ChevronLeft: I, ChevronRight: I,
    Braces: I, Eye: I,
  }
})

// Lazy rendered (Markdown / JSON) view — stub so the test doesn't pull in
// react-markdown. Reports which mode it received.
vi.mock("../llm-output-view", () => ({
  LlmOutputView: ({ text, json }: any) => (
    <div data-testid="llm-output-view" data-mode={json !== undefined ? "json" : "markdown"}>{text}</div>
  ),
}))

vi.mock("../llm-chat-quick-toolbar", () => ({
  LlmChatQuickToolbar: () => <div data-testid="llm-chat-quick-toolbar" />,
}))

vi.mock("../results-thumbnails-panel", () => ({
  ResultsThumbnailsPanel: (p: any) => (
    <div data-testid="results-thumbnails-panel" data-count={p.results?.length ?? 0} data-media-type={p.mediaType} />
  ),
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) => selector({
      updateNodeData: () => {},
      runSingleNode: () => {},
      nodes: [],
      edges: [],
    }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 3 }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/lib/generate-text-templates", () => ({
  getGenerateTextTemplate: (id: string) =>
    id === "custom" || !id
      ? { id: "custom", label: "Custom" }
      : { id: "storyboard", label: "Storyboard Writer" },
  GENERATE_TEXT_TEMPLATES: [
    { id: "custom", label: "Custom" },
    { id: "storyboard", label: "Storyboard Writer" },
  ],
}))

vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom")
  return { ...actual, createPortal: (node: any) => node }
})

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Generate Text", templateId: "custom" },
    selected: false,
    ...overrides,
  } as any
  return render(<LLMChatNode {...defaultProps} />)
}

describe("LLMChatNode", () => {
  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct category", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "ai")
  })

  it("renders the text source handle", () => {
    renderNode()
    const handle = screen.getByTestId("handle-popover-source-text")
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute("data-type", "source")
  })

  it("renders the items source handle (fan-out list output)", () => {
    renderNode()
    const handle = screen.getByTestId("handle-popover-source-items")
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute("data-type", "source")
  })

  it("shows idle placeholder", () => {
    renderNode()
    expect(screen.getByText("No output yet")).toBeInTheDocument()
  })

  it("renders the template badge for a non-custom template", () => {
    renderNode({ data: { label: "Generate Text", templateId: "storyboard" } })
    expect(screen.getByText("Storyboard Writer")).toBeInTheDocument()
  })

  it("does not render a template badge for the custom template", () => {
    renderNode({ data: { label: "Generate Text", templateId: "custom" } })
    expect(screen.queryByText("Custom")).not.toBeInTheDocument()
  })

  it("does not render a template badge when templateId is unset", () => {
    renderNode({ data: { label: "Generate Text" } })
    expect(screen.queryByText("Custom")).not.toBeInTheDocument()
  })

  it("shows generated text preview", () => {
    renderNode({
      data: {
        label: "Generate Text",
        templateId: "custom",
        generatedText: "Hello world from LLM",
        generatedResults: [{ text: "Hello world from LLM", jobId: "j1" }],
        activeResultIndex: 0,
      },
    })
    expect(screen.getByText("Hello world from LLM")).toBeInTheDocument()
  })

  it("shows Failed when failed", () => {
    renderNode({
      data: {
        label: "Generate Text",
        templateId: "custom",
        executionStatus: "failed",
      },
    })
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("opts into the bottom-left zoom magnifier", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-enable-zoom-handle", "true")
  })

  it("renders the quick toolbar", () => {
    renderNode()
    expect(screen.getByTestId("llm-chat-quick-toolbar")).toBeInTheDocument()
  })

  it("does not render the results browser with a single result", () => {
    renderNode({
      data: { label: "Generate Text", templateId: "custom", generatedResults: [{ text: "a" }], activeResultIndex: 0 },
    })
    expect(screen.queryByTestId("results-thumbnails-panel")).not.toBeInTheDocument()
    // No "Show outputs" toggle with a single result.
    expect(screen.queryByLabelText("Show outputs")).not.toBeInTheDocument()
  })

  it("hides the results browser by default but offers a Show outputs toggle with multiple results", () => {
    renderNode({
      data: {
        label: "Generate Text",
        templateId: "custom",
        generatedResults: [{ text: "a" }, { text: "b" }],
        activeResultIndex: 0,
      },
    })
    // Off by default (mirrors Generate Image).
    expect(screen.queryByTestId("results-thumbnails-panel")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Show outputs")).toBeInTheDocument()
  })

  it("reveals the float-above text results browser after toggling Show outputs", () => {
    renderNode({
      data: {
        label: "Generate Text",
        templateId: "custom",
        generatedResults: [{ text: "a" }, { text: "b" }],
        activeResultIndex: 0,
      },
    })
    fireEvent.click(screen.getByLabelText("Show outputs"))
    const panel = screen.getByTestId("results-thumbnails-panel")
    expect(panel).toHaveAttribute("data-count", "2")
    expect(panel).toHaveAttribute("data-media-type", "text")
  })

  it("defaults to raw text and toggles to a rendered Markdown view", async () => {
    renderNode({
      data: {
        label: "Generate Text",
        templateId: "custom",
        generatedText: "# Heading\n\nsome **bold** text",
        generatedResults: [{ text: "# Heading\n\nsome **bold** text", jobId: "j1" }],
        activeResultIndex: 0,
      },
    })
    // Raw by default — rendered view not mounted.
    expect(screen.queryByTestId("llm-output-view")).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("View as Markdown"))
    const view = await screen.findByTestId("llm-output-view")
    expect(view).toHaveAttribute("data-mode", "markdown")
  })

  it("offers a JSON view when the output parses as JSON", async () => {
    renderNode({
      data: {
        label: "Generate Text",
        templateId: "custom",
        generatedText: '{"a":1,"b":[2,3]}',
        generatedResults: [{ text: '{"a":1,"b":[2,3]}', jobId: "j1" }],
        activeResultIndex: 0,
      },
    })
    fireEvent.click(screen.getByLabelText("View as JSON"))
    const view = await screen.findByTestId("llm-output-view")
    expect(view).toHaveAttribute("data-mode", "json")
  })

  it("shows the per-result model and template badges", () => {
    renderNode({
      data: {
        label: "Generate Text",
        templateId: "custom",
        generatedResults: [
          { text: "hi", model: "gemini-3-flash", templateId: "storyboard" },
        ],
        activeResultIndex: 0,
      },
    })
    // Template id "storyboard" resolves via the mocked template lookup.
    expect(screen.getByText("Storyboard Writer")).toBeInTheDocument()
  })
})
