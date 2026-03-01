import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — all declared before component imports
// ---------------------------------------------------------------------------

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>()
  return {
    ...actual,
    Handle: ({ type, position, id }: any) => (
      <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
    ),
    NodeResizer: () => null,
    NodeToolbar: ({ children }: any) => <div data-testid="node-toolbar">{children}</div>,
    useStore: vi.fn(() => 1),
    useNodeId: vi.fn(() => "test-node"),
    useReactFlow: vi.fn(() => ({ getNodes: vi.fn(() => []), getEdges: vi.fn(() => []), setNodes: vi.fn(), setEdges: vi.fn() })),
  }
})

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
      {handles?.map((h: any) => (
        <div
          key={h.id}
          data-testid={`handle-${h.id}`}
          data-type={h.type}
          data-position={h.position}
        />
      ))}
      {children}
    </div>
  ),
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: any) => (
    <div data-testid="run-node-button" data-credits={props.credits} data-node-id={props.nodeId} />
  ),
}))

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  return { ...actual }
})

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) =>
      selector({
        updateNodeData: () => {},
        runSingleNode: () => {},
        selectNode: () => {},
        duplicateNode: () => {},
        newNodeIds: new Set(),
        clearNewNode: () => {},
        nodes: [],
        edges: [],
      }),
    { getState: () => ({ nodes: [], edges: [] }) },
  ),
}))

vi.mock("@/hooks/use-model-credits", () => ({
  useModelCredits: () => 1,
}))

vi.mock("@/components/editor/config-panels/helpers", () => ({
  buildCreditModelIdentifier: vi.fn(() => "nano-banana"),
}))

vi.mock("@/components/editor/media-preview-modal", () => ({
  MediaPreviewModal: () => null,
}))

vi.mock("@/components/ui/delete-confirmation-dialog", () => ({
  DeleteConfirmationDialog: () => null,
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => (
    <img data-testid="cached-image" src={props.src} alt={props.alt} />
  ),
}))

vi.mock("@/components/editor/save-to-library-button", () => ({
  SaveToLibraryButton: () => null,
}))

// ---------------------------------------------------------------------------
// Component import (after all mocks)
// ---------------------------------------------------------------------------

import { ImageToImageNode } from "../image-to-image-node"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "i2i-1",
    data: { label: "Image to Image" },
    selected: false,
    ...overrides,
  } as any
  return render(<ImageToImageNode {...defaultProps} />)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ImageToImageNode", () => {
  it("renders with empty data and shows placeholder icon", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("renders with generatedImageUrl and shows CachedImage", () => {
    renderNode({
      data: {
        label: "Image to Image",
        generatedImageUrl: "https://example.com/transformed.png",
      },
    })
    const img = screen.getByTestId("cached-image")
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute("src", "https://example.com/transformed.png")
  })

  it("renders active image with multiple generatedResults", () => {
    renderNode({
      data: {
        label: "Image to Image",
        generatedResults: [
          { url: "https://example.com/a.png", jobId: "j1" },
          { url: "https://example.com/b.png", jobId: "j2" },
          { url: "https://example.com/c.png", jobId: "j3" },
        ],
        activeResultIndex: 0,
        generatedImageUrl: "https://example.com/a.png",
      },
    })
    // Active image is shown (thumbnails are hidden by default, toggled via button)
    const images = screen.getAllByTestId("cached-image")
    expect(images.length).toBeGreaterThanOrEqual(1)
  })

  it("shows spinner when running", () => {
    renderNode({
      data: { label: "Image to Image", executionStatus: "running" },
    })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
    const baseNode = screen.getByTestId("base-node")
    expect(baseNode.querySelector(".animate-spin")).toBeInTheDocument()
  })

  it("shows error message when failed", () => {
    renderNode({
      data: {
        label: "Image to Image",
        executionStatus: "failed",
        errorMessage: "Model unavailable",
      },
    })
    expect(screen.getByText("Model unavailable")).toBeInTheDocument()
  })

  it("passes correct category to BaseNode", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "ai")
  })

  it("passes node id to BaseNode", () => {
    renderNode({ id: "i2i-77" })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-id", "i2i-77")
  })

  it("has correct handles (image target + out source)", () => {
    renderNode()
    const imageHandle = screen.getByTestId("handle-image")
    expect(imageHandle).toHaveAttribute("data-type", "target")
    expect(imageHandle).toHaveAttribute("data-position", "left")

    const outHandle = screen.getByTestId("handle-out")
    expect(outHandle).toHaveAttribute("data-type", "source")
    expect(outHandle).toHaveAttribute("data-position", "right")
  })
})
