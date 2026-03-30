import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ManualEditNode } from "../manual-edit-node"

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

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  return { ...actual }
})

vi.mock("../run-node-button", () => ({
  RunNodeButton: () => <div data-testid="run-node-button" />,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    updateNodeData: () => {},
    runSingleNode: () => {},
    videoAutoplay: false,
    nodes: [],
    edges: [],
  }),
}))

vi.mock("@/hooks/use-model-credits", () => ({ useModelCredits: () => 0 }))
vi.mock("@/hooks/use-full-resolution", () => ({ useFullResolution: () => false }))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/components/ui/cached-image", () => ({ CachedImage: (props: any) => <img {...props} /> }))
vi.mock("@/lib/utils", () => ({ computeDeleteResultUpdates: () => ({}), cn: (...args: any[]) => args.filter(Boolean).join(" ") }))

vi.mock("./editable-node-label", () => ({
  EditableNodeLabel: () => <div data-testid="editable-label" />,
}))
vi.mock("./handle-icon", () => ({
  HandleIcon: () => null,
}))

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: { label: "Manual Edit" },
    selected: false,
    ...overrides,
  } as any
  return render(<ManualEditNode {...defaultProps} />)
}

describe("ManualEditNode", () => {
  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct category", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "processing")
  })

  it("shows idle placeholder", () => {
    renderNode()
    const dashed = document.querySelector(".border-dashed")
    expect(dashed).toBeInTheDocument()
  })

  it("shows spinner when running", () => {
    renderNode({
      data: { label: "Manual Edit", executionStatus: "running" },
    })
    const spinner = document.querySelector(".animate-spin")
    expect(spinner).toBeInTheDocument()
  })

  it("shows awaiting-user state", () => {
    renderNode({
      data: { label: "Manual Edit", executionStatus: "awaiting-user" },
    })
    expect(screen.getByText("Awaiting Edit")).toBeInTheDocument()
  })

  it("shows Failed when failed", () => {
    renderNode({
      data: { label: "Manual Edit", executionStatus: "failed" },
    })
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })
})
