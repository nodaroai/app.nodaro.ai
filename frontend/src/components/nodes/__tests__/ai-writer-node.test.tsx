import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { AIWriterNode } from "../ai-writer-node"

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
  BaseNode: ({ children, label, category, credits, id, isRunning }: any) => (
    <div data-testid="base-node" data-label={label} data-category={category} data-credits={credits} data-id={id} data-is-running={isRunning}>
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", () => {
  const I = (p: any) => <span data-testid="mock-icon" {...p} />
  return {
    Sparkles: I, Loader2: I, AlertCircle: I, X: I, FileText: I, Square: I, Type: I,
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

vi.mock("@/hooks/use-model-credits", () => ({ useModelCredits: () => 2 }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/lib/ai-writer-templates", () => ({
  getAIWriterTemplate: () => ({ id: "blog-post", label: "Blog Post" }),
}))
vi.mock("@/lib/api", () => ({ generateAIWriterStream: vi.fn() }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom")
  return { ...actual, createPortal: (node: any) => node }
})

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "AI Writer", provider: "gemini", templateId: "blog-post" },
    selected: false,
    ...overrides,
  } as any
  return render(<AIWriterNode {...defaultProps} />)
}

describe("AIWriterNode", () => {
  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct category", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "ai")
  })

  it("shows idle placeholder", () => {
    renderNode()
    const dashed = document.querySelector(".border-dashed")
    expect(dashed).toBeInTheDocument()
  })

  it("shows template label", () => {
    renderNode()
    const matches = screen.getAllByText("Blog Post")
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it("shows generated text preview", () => {
    renderNode({
      data: {
        label: "AI Writer",
        provider: "gemini",
        templateId: "blog-post",
        generatedText: "Hello world from AI",
        generatedResults: [{ text: "Hello world from AI", jobId: "j1" }],
        activeResultIndex: 0,
      },
    })
    expect(screen.getByText("Hello world from AI")).toBeInTheDocument()
  })

  it("shows Failed when failed", () => {
    renderNode({
      data: {
        label: "AI Writer",
        provider: "gemini",
        templateId: "blog-post",
        executionStatus: "failed",
      },
    })
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("shows error message", () => {
    renderNode({
      data: {
        label: "AI Writer",
        provider: "gemini",
        templateId: "blog-post",
        executionStatus: "failed",
        errorMessage: "API error",
      },
    })
    expect(screen.getByText("API error")).toBeInTheDocument()
  })
})
