import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { LLMChatNode } from "../llm-chat-node"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning, handles }: any) => (
    <div
      data-testid="base-node"
      data-label={label}
      data-category={category}
      data-credits={credits}
      data-id={id}
      data-is-running={isRunning}
    >
      {/* Render the declared handles so tests can assert on handle ids */}
      {(handles ?? []).map((h: any) => (
        <div key={h.id} data-testid={`handle-${h.id}`} data-type={h.type} data-position={h.position} />
      ))}
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return {
    MessageSquare: I, Type: I, Loader2: I, AlertCircle: I, X: I, FileText: I,
    Copy: I, Download: I, BookOpen: I, AlignLeft: I, List: I, Layers: I, ListOrdered: I,
  }
})

vi.mock("../run-node-button", () => ({
  RunNodeButton: () => <div data-testid="run-node-button" />,
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
    const handle = screen.getByTestId("handle-text")
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveAttribute("data-type", "source")
  })

  it("renders the items source handle (fan-out list output)", () => {
    renderNode()
    const handle = screen.getByTestId("handle-items")
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
})
