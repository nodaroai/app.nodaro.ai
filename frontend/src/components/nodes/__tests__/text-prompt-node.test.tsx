import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TextPromptNode } from "../text-prompt-node"

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Handle: ({ type, position, id }: any) => (
      <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
    ),
    NodeResizer: () => null,
    NodeResizeControl: () => null,
    NodeToolbar: ({ children, isVisible }: any) => isVisible ? <div data-testid="node-toolbar">{children}</div> : null,
    useStore: vi.fn(() => 1),
    useNodeId: vi.fn(() => "test-node"),
    useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
    // useConnection is invoked by HandleWithPopover (now rendered for the
    // typed source pip on text-prompt). Stub to "no drag in progress" so
    // the validity-check returns false without touching the React Flow
    // store-provider, which isn't mounted in these isolated tests.
    useConnection: vi.fn(() => ({ inProgress: false })),
    // useUpdateNodeInternals is invoked on mount to recompute the pip
    // position after the migration from invisible Handle to HandleWithPopover.
    // Stub to a no-op so the hook returns without touching the React Flow
    // store-provider, which isn't mounted in these isolated tests.
    useUpdateNodeInternals: vi.fn(() => () => {}),
  }
})

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  return { ...actual }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    updateNodeData: () => {},
    nodes: [],
    edges: [],
  }),
}))

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Text Prompt", text: "", variables: {} },
    selected: false,
    ...overrides,
  } as any
  return render(<TextPromptNode {...defaultProps} />)
}

describe("TextPromptNode", () => {
  it("renders with label", () => {
    renderNode({ data: { label: "My Prompt", text: "hello", variables: {} } })
    expect(screen.getByText("My Prompt")).toBeInTheDocument()
  })

  it("renders text content from data", () => {
    renderNode({ data: { label: "Prompt", text: "A sunset scene", variables: {} } })
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
    expect(textarea.value).toBe("A sunset scene")
  })

  it("shows placeholder when text is empty", () => {
    renderNode({ data: { label: "Prompt", text: "", variables: {} } })
    expect(screen.getByPlaceholderText("Enter your prompt...")).toBeInTheDocument()
  })

  it("shows placeholder when text is undefined", () => {
    renderNode({ data: { label: "Prompt", variables: {} } })
    expect(screen.getByPlaceholderText("Enter your prompt...")).toBeInTheDocument()
  })

  it("renders a textarea element", () => {
    renderNode({ data: { label: "Prompt", text: "test", variables: {} } })
    expect(screen.getByRole("textbox")).toBeInTheDocument()
  })

  it("renders the output handle", () => {
    renderNode({ data: { label: "Prompt", text: "test", variables: {} } })
    const handle = screen.getByTestId("handle-prompt")
    expect(handle).toHaveAttribute("data-type", "source")
    expect(handle).toHaveAttribute("data-position", "right")
  })

  it("renders textarea with text value", () => {
    renderNode({ data: { label: "Prompt", text: "A very long prompt text", variables: {} } })
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
    expect(textarea.value).toBe("A very long prompt text")
  })

  it("renders the 3-dots More options button when selected", () => {
    renderNode({ selected: true })
    expect(screen.getByLabelText("More options")).toBeInTheDocument()
  })

  it("dispatches open-node-context-menu when the 3-dots button is clicked", () => {
    const handler = vi.fn()
    window.addEventListener("open-node-context-menu", handler)
    renderNode({ selected: true })
    fireEvent.click(screen.getByLabelText("More options"))
    window.removeEventListener("open-node-context-menu", handler)
    expect(handler).toHaveBeenCalledTimes(1)
    const evt = handler.mock.calls[0][0] as CustomEvent
    expect(evt.detail.nodeId).toBe("node-1")
  })
})
