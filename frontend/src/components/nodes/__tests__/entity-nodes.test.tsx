import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
}))

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning, handles }: any) => (
    <div data-testid="base-node" data-label={label} data-category={category} data-credits={credits} data-id={id} data-is-running={String(isRunning)}>
      {handles?.map((h: any) => (
        <div key={h.id} data-testid={`handle-${h.id}`} data-type={h.type} data-position={h.position} />
      ))}
      {children}
    </div>
  ),
}))

vi.mock("lucide-react", () => {
  const Icon = (props: any) => <span data-testid="mock-icon" {...props} />
  return {
    UserCircle: Icon,
    SmilePlus: Icon,
    Package: Icon,
    MapPin: Icon,
    Loader2: (props: any) => <span data-testid="icon-Loader2" {...props} />,
    AlertCircle: (props: any) => <span data-testid="icon-AlertCircle" {...props} />,
    X: Icon,
    ImageIcon: Icon,
    Maximize2: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
  }
})

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: any) => <div data-testid="run-node-button" data-credits={props.credits} />,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    updateNodeData: () => {},
    runSingleNode: () => {},
    nodes: [],
    edges: [],
  }),
}))

vi.mock("@/hooks/use-model-credits", () => ({
  useModelCredits: () => 1,
}))

vi.mock("@/components/ui/delete-confirmation-dialog", () => ({
  DeleteConfirmationDialog: () => null,
}))

vi.mock("@/components/ui/image-lightbox", () => ({
  ImageLightbox: () => null,
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img data-testid="cached-image" src={props.src} alt={props.alt} />,
}))

vi.mock("@/components/editor/save-to-library-button", () => ({
  SaveToLibraryButton: () => null,
}))

import { CharacterNode } from "../character-node"
import { FaceNode } from "../face-node"
import { ObjectNode } from "../object-node"
import { LocationNode } from "../location-node"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderCharacterNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: {
      label: "Character",
      style: "realistic",
      gender: "male",
      characterName: "Hero",
      characters: [],
      objects: [],
    },
    selected: false,
    ...overrides,
  } as any
  return render(<CharacterNode {...defaultProps} />)
}

function renderFaceNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: {
      label: "Face",
      style: "realistic",
      faceName: "Face 1",
    },
    selected: false,
    ...overrides,
  } as any
  return render(<FaceNode {...defaultProps} />)
}

function renderObjectNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: {
      label: "Object",
      style: "realistic",
      objectName: "Sword",
    },
    selected: false,
    ...overrides,
  } as any
  return render(<ObjectNode {...defaultProps} />)
}

function renderLocationNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: "node-1",
    data: {
      label: "Location",
      style: "realistic",
      locationName: "Forest",
    },
    selected: false,
    ...overrides,
  } as any
  return render(<LocationNode {...defaultProps} />)
}

// ---------------------------------------------------------------------------
// CharacterNode
// ---------------------------------------------------------------------------

describe("CharacterNode", () => {
  it("renders without crashing in idle state", () => {
    renderCharacterNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct label to BaseNode", () => {
    renderCharacterNode({ data: { label: "My Character", style: "realistic", gender: "male", characterName: "Hero", characters: [], objects: [] } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "My Character")
  })

  it("passes correct category to BaseNode", () => {
    renderCharacterNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "character")
  })

  it("has correct handles (in + characterRef)", () => {
    renderCharacterNode()
    const inHandle = screen.getByTestId("handle-in")
    expect(inHandle).toHaveAttribute("data-type", "target")
    expect(inHandle).toHaveAttribute("data-position", "left")

    const refHandle = screen.getByTestId("handle-characterRef")
    expect(refHandle).toHaveAttribute("data-type", "source")
    expect(refHandle).toHaveAttribute("data-position", "right")
  })

  it("shows idle placeholder with border-dashed element", () => {
    const { container } = renderCharacterNode()
    const placeholder = container.querySelector(".border-dashed")
    expect(placeholder).toBeInTheDocument()
  })

  it("shows spinner when running", () => {
    renderCharacterNode({ data: { label: "Character", style: "realistic", gender: "male", characterName: "Hero", executionStatus: "running", characters: [], objects: [] } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
  })

  it("shows Failed text in failed state", () => {
    renderCharacterNode({ data: { label: "Character", style: "realistic", gender: "male", characterName: "Hero", executionStatus: "failed", characters: [], objects: [] } })
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("shows style label", () => {
    renderCharacterNode()
    expect(screen.getByText("Realistic")).toBeInTheDocument()
  })

  it("shows characterName text", () => {
    renderCharacterNode()
    expect(screen.getByText("Hero")).toBeInTheDocument()
  })

  it("shows gender", () => {
    renderCharacterNode()
    expect(screen.getByText("male")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// FaceNode
// ---------------------------------------------------------------------------

describe("FaceNode", () => {
  it("renders without crashing in idle state", () => {
    renderFaceNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct label to BaseNode", () => {
    renderFaceNode({ data: { label: "My Face", style: "realistic", faceName: "Face 1" } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "My Face")
  })

  it("passes correct category to BaseNode", () => {
    renderFaceNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "face")
  })

  it("has correct handles (in + faceRef)", () => {
    renderFaceNode()
    const inHandle = screen.getByTestId("handle-in")
    expect(inHandle).toHaveAttribute("data-type", "target")
    expect(inHandle).toHaveAttribute("data-position", "left")

    const refHandle = screen.getByTestId("handle-faceRef")
    expect(refHandle).toHaveAttribute("data-type", "source")
    expect(refHandle).toHaveAttribute("data-position", "right")
  })

  it("shows idle placeholder with border-dashed element", () => {
    const { container } = renderFaceNode()
    const placeholder = container.querySelector(".border-dashed")
    expect(placeholder).toBeInTheDocument()
  })

  it("shows spinner when running", () => {
    renderFaceNode({ data: { label: "Face", style: "realistic", faceName: "Face 1", executionStatus: "running" } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
  })

  it("shows Failed text in failed state", () => {
    renderFaceNode({ data: { label: "Face", style: "realistic", faceName: "Face 1", executionStatus: "failed" } })
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("shows style label", () => {
    renderFaceNode()
    expect(screen.getByText("Realistic")).toBeInTheDocument()
  })

  it("shows faceName text", () => {
    renderFaceNode()
    expect(screen.getByText("Face 1")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// ObjectNode
// ---------------------------------------------------------------------------

describe("ObjectNode", () => {
  it("renders without crashing in idle state", () => {
    renderObjectNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct label to BaseNode", () => {
    renderObjectNode({ data: { label: "My Object", style: "realistic", objectName: "Sword" } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "My Object")
  })

  it("passes correct category to BaseNode", () => {
    renderObjectNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "object")
  })

  it("has correct handles (in + objectRef)", () => {
    renderObjectNode()
    const inHandle = screen.getByTestId("handle-in")
    expect(inHandle).toHaveAttribute("data-type", "target")
    expect(inHandle).toHaveAttribute("data-position", "left")

    const refHandle = screen.getByTestId("handle-objectRef")
    expect(refHandle).toHaveAttribute("data-type", "source")
    expect(refHandle).toHaveAttribute("data-position", "right")
  })

  it("shows idle placeholder with border-dashed element", () => {
    const { container } = renderObjectNode()
    const placeholder = container.querySelector(".border-dashed")
    expect(placeholder).toBeInTheDocument()
  })

  it("shows spinner when running", () => {
    renderObjectNode({ data: { label: "Object", style: "realistic", objectName: "Sword", executionStatus: "running" } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
  })

  it("shows Failed text in failed state", () => {
    renderObjectNode({ data: { label: "Object", style: "realistic", objectName: "Sword", executionStatus: "failed" } })
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("shows style label", () => {
    renderObjectNode()
    expect(screen.getByText("Realistic")).toBeInTheDocument()
  })

  it("shows objectName text", () => {
    renderObjectNode()
    expect(screen.getByText("Sword")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// LocationNode
// ---------------------------------------------------------------------------

describe("LocationNode", () => {
  it("renders without crashing in idle state", () => {
    renderLocationNode()
    expect(screen.getByTestId("base-node")).toBeInTheDocument()
  })

  it("passes correct label to BaseNode", () => {
    renderLocationNode({ data: { label: "My Location", style: "realistic", locationName: "Forest" } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-label", "My Location")
  })

  it("passes correct category to BaseNode", () => {
    renderLocationNode()
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-category", "location")
  })

  it("has correct handles (in + locationRef)", () => {
    renderLocationNode()
    const inHandle = screen.getByTestId("handle-in")
    expect(inHandle).toHaveAttribute("data-type", "target")
    expect(inHandle).toHaveAttribute("data-position", "left")

    const refHandle = screen.getByTestId("handle-locationRef")
    expect(refHandle).toHaveAttribute("data-type", "source")
    expect(refHandle).toHaveAttribute("data-position", "right")
  })

  it("shows idle placeholder with border-dashed element", () => {
    const { container } = renderLocationNode()
    const placeholder = container.querySelector(".border-dashed")
    expect(placeholder).toBeInTheDocument()
  })

  it("shows spinner when running", () => {
    renderLocationNode({ data: { label: "Location", style: "realistic", locationName: "Forest", executionStatus: "running" } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
  })

  it("shows Failed text in failed state", () => {
    renderLocationNode({ data: { label: "Location", style: "realistic", locationName: "Forest", executionStatus: "failed" } })
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("shows style label", () => {
    renderLocationNode()
    expect(screen.getByText("Realistic")).toBeInTheDocument()
  })

  it("shows locationName text", () => {
    renderLocationNode()
    expect(screen.getByText("Forest")).toBeInTheDocument()
  })
})
