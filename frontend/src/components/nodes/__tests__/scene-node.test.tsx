import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { SceneNode } from "../scene-node"

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

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t: any, prop: string) => {
    if (prop === '__esModule') return false
    return (p: any) => <span data-testid={`icon-${prop}`} {...p} />
  },
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    updateNodeData: () => {},
    runSingleNode: () => {},
    characterDefinitions: [],
    addCharacterDefinition: () => {},
    autoOpenEditorNodeId: null,
    setAutoOpenEditorNodeId: () => {},
    nodes: [],
    edges: [],
  }),
}))

vi.mock("@/hooks/use-model-credits", () => ({ useModelCredits: () => 2 }))
vi.mock("@/components/editor/media-preview-modal", () => ({ MediaPreviewModal: () => null }))
vi.mock("@/components/ui/delete-confirmation-dialog", () => ({ DeleteConfirmationDialog: () => null }))
vi.mock("@/components/editor/scene-editor-modal", () => ({ SceneEditorModal: () => null }))
vi.mock("@/components/editor/extract-references-modal", () => ({ ExtractReferencesModal: () => null }))
vi.mock("@/components/editor/save-to-library-button", () => ({ SaveToLibraryButton: () => null }))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img data-testid="cached-image" src={props.src} alt={props.alt} />,
}))

function renderNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: {
      label: "Scene 1",
      sceneName: "Scene 1",
      characters: [],
      objects: [],
      locations: [],
      shotType: "wide",
      duration: 5,
      aspectRatio: "16:9",
    },
    selected: false,
    ...overrides,
  } as any
  return render(<SceneNode {...defaultProps} />)
}

describe("SceneNode", () => {
  it("renders without crashing", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct category", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "scene")
  })

  it("shows idle placeholder", () => {
    renderNode()
    const dashed = document.querySelector(".border-dashed")
    expect(dashed).toBeInTheDocument()
  })

  it("shows spinner when running", () => {
    renderNode({
      data: {
        label: "Scene 1",
        sceneName: "Scene 1",
        characters: [],
        objects: [],
        locations: [],
        shotType: "wide",
        duration: 5,
        aspectRatio: "16:9",
        executionStatus: "running",
      },
    })
    const spinner = document.querySelector(".animate-spin")
    expect(spinner).toBeInTheDocument()
  })

  it("shows Failed when failed", () => {
    renderNode({
      data: {
        label: "Scene 1",
        sceneName: "Scene 1",
        characters: [],
        objects: [],
        locations: [],
        shotType: "wide",
        duration: 5,
        aspectRatio: "16:9",
        executionStatus: "failed",
      },
    })
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("shows shot type badge", () => {
    renderNode()
    expect(screen.getByText("wide")).toBeInTheDocument()
  })

  it("shows duration", () => {
    renderNode()
    expect(screen.getByText("5s")).toBeInTheDocument()
  })

  it("shows scene name as label", () => {
    renderNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "Scene 1")
  })
})
