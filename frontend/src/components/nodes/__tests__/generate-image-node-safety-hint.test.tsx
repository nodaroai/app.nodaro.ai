import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mocks — all declared before component imports. Mirrors the scaffold in
// generate-image-node.test.tsx; only the workflow-store mock differs (spies
// instead of no-ops, so the "Try on <provider>" click can be asserted).
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
    useUpdateNodeInternals: vi.fn(() => vi.fn()),
    useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
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
      {handles?.filter((h: any) => !h.external).map((h: any) => (
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

// One stable, mutable store object (zustand-shaped) so tests can assert on
// the spies and reset them between cases without re-mocking the module.
const store = vi.hoisted(() => ({
  state: {
    updateNodeData: vi.fn(),
    runSingleNode: vi.fn(),
    selectNode: () => {},
    duplicateNode: () => {},
    newNodeIds: new Set(),
    clearNewNode: () => {},
    nodes: [] as unknown[],
    edges: [] as unknown[],
    characterDefinitions: [] as unknown[],
    addCharacterDefinition: () => {},
    autoOpenEditorNodeId: null,
    setAutoOpenEditorNodeId: () => {},
    videoAutoplay: false,
    selectedNodeId: null as string | null,
  },
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) => selector(store.state),
    { getState: () => store.state },
  ),
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
  useModelCredits: () => 1,
}))

vi.mock("@/components/editor/config-panels/helpers", () => ({
  buildCreditModelIdentifier: vi.fn(() => "nano-banana"),
}))

vi.mock("@/ee/hooks/use-providers-credits-sum", () => ({
  useProvidersCreditsSum: () => 0,
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

vi.mock("@/components/editor/canvas-zoom-context", () => ({
  useCanvasZoom: () => ({ zoom: 1 }),
}))

vi.mock("@/components/editor/extract-references-modal", () => ({
  ExtractReferencesModal: () => null,
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverAnchor: ({ children }: any) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/hooks/use-handle-connections", () => ({
  useHandleConnections: () => [],
}))

vi.mock("@/hooks/use-result-generation-settings", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/hooks/use-result-generation-settings")
  >()
  return {
    ...actual,
    useResultGenerationSettings: () => ({ data: undefined, isLoading: false }),
  }
})

// ---------------------------------------------------------------------------
// Component import (after all mocks). `getModel` is the REAL @nodaro/shared
// catalog lookup — not mocked — so the label assertion below pins the actual
// catalog entry, not a stub.
// ---------------------------------------------------------------------------

import { GenerateImageNode } from "../generate-image-node"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "gen-img-1",
    data: { label: "Generate Image" },
    selected: false,
    ...overrides,
  } as any
  return render(<GenerateImageNode {...defaultProps} />)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GenerateImageNode — safety-block hint", () => {
  beforeEach(() => {
    cleanup()
    store.state.updateNodeData.mockReset()
    store.state.runSingleNode.mockReset()
  })

  it("failed + hint with suggestedProvider: shows the retried sentence and a fallback button; clicking swaps the provider and runs once", () => {
    renderNode({
      data: {
        label: "Generate Image",
        provider: "gpt-image-2",
        executionStatus: "failed",
        errorMessage: "Blocked by provider safety filter after retry",
        errorHint: {
          kind: "safety-block",
          class: "copyright",
          retried: true,
          suggestedProvider: "nano-banana-pro",
        },
      },
    })

    expect(screen.getByText("Prohibited")).toBeInTheDocument()
    expect(
      screen.getByText(
        "The provider's safety filter blocked this output twice. It is not always consistent — try another model or adjust the prompt.",
      ),
    ).toBeInTheDocument()

    const button = screen.getByText("Try on Nano Banana Pro")
    expect(button).toBeInTheDocument()

    fireEvent.click(button)

    expect(store.state.updateNodeData).toHaveBeenCalledTimes(1)
    expect(store.state.updateNodeData).toHaveBeenCalledWith("gen-img-1", {
      provider: "nano-banana-pro",
      errorMessage: undefined,
      errorHint: undefined,
      executionStatus: "idle",
    })
    expect(store.state.runSingleNode).toHaveBeenCalledTimes(1)
    expect(store.state.runSingleNode).toHaveBeenCalledWith("gen-img-1")
  })

  it("failed + hint without suggestedProvider: shows the sentence but no fallback button", () => {
    renderNode({
      data: {
        label: "Generate Image",
        executionStatus: "failed",
        errorMessage: "Blocked by provider safety filter after retry",
        errorHint: {
          kind: "safety-block",
          class: "safety",
          retried: true,
        },
      },
    })

    expect(screen.getByText("Prohibited")).toBeInTheDocument()
    expect(
      screen.getByText(
        "The provider's safety filter blocked this output twice. It is not always consistent — try another model or adjust the prompt.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Try on /)).not.toBeInTheDocument()
    expect(store.state.updateNodeData).not.toHaveBeenCalled()
    expect(store.state.runSingleNode).not.toHaveBeenCalled()
  })

  it("failed with only the legacy content-policy message: shows the old amber text, no button", () => {
    renderNode({
      data: {
        label: "Generate Image",
        executionStatus: "failed",
        errorMessage: "Content policy violation: prohibited content",
      },
    })

    expect(screen.getByText("Prohibited")).toBeInTheDocument()
    expect(
      screen.getByText("Blocked by provider safety filter. Try a different prompt or image."),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Try on /)).not.toBeInTheDocument()
  })
})
