import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, position, id }: any) => (
    <div data-testid={`handle-${type}-${id}`} data-type={type} data-position={position} />
  ),
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
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

vi.mock("../base-node", () => ({
  BaseNode: ({ children, label, category, credits, id, isRunning, handles }: any) => (
    <div data-testid="base-node" data-label={label} data-category={category} data-credits={credits} data-id={id} data-is-running={String(isRunning)}>
      {handles?.filter((h: any) => !h.external).map((h: any) => (
        <div key={`${h.type}-${h.id}`} data-testid={`handle-${h.type}-${h.id}`} data-type={h.type} data-position={h.position} />
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
    // shadcn `Select` (used by CharacterNode's usage-mode dropdown) imports
    // ChevronDownIcon / ChevronUpIcon / CheckIcon under the *Icon suffix.
    ChevronDownIcon: Icon,
    ChevronUpIcon: Icon,
    CheckIcon: Icon,
    Type: Icon,
    FileVideo: Icon,
    FileImage: Icon,
    Share2: Icon,
    Heart: Icon,
    MessageCircle: Icon,
    Send: Icon,
    Expand: Icon,
    Aperture: Icon,
  }
})

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: any) => <div data-testid="run-node-button" data-credits={props.credits} />,
}))

const setCharacterStudioNodeIdMock = vi.fn()
const setObjectStudioNodeIdMock = vi.fn()
const setLocationStudioNodeIdMock = vi.fn()
const updateNodeDataMock = vi.fn()
// Mutable edges for tests that flip the type-handle wire on/off so the
// useConnectionCount selector picks them up.
let mockEdges: Array<{ source: string; target: string; targetHandle?: string }> = []
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    updateNodeData: updateNodeDataMock,
    runSingleNode: () => {},
    setCharacterStudioNodeId: setCharacterStudioNodeIdMock,
    setObjectStudioNodeId: setObjectStudioNodeIdMock,
    setLocationStudioNodeId: setLocationStudioNodeIdMock,
    nodes: [],
    edges: mockEdges,
  }),
}))

vi.mock("@/ee/hooks/use-model-credits", () => ({
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
  beforeEach(() => {
    setCharacterStudioNodeIdMock.mockClear()
  })

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
    const inHandle = screen.getByTestId("handle-target-in")
    expect(inHandle).toHaveAttribute("data-type", "target")
    expect(inHandle).toHaveAttribute("data-position", "left")

    const refHandle = screen.getByTestId("handle-source-characterRef")
    expect(refHandle).toHaveAttribute("data-type", "source")
    expect(refHandle).toHaveAttribute("data-position", "right")
  })

  it("shows portrait placeholder with border-dashed element when no sourceImageUrl", () => {
    const { container } = renderCharacterNode()
    const placeholder = container.querySelector(".border-dashed")
    expect(placeholder).toBeInTheDocument()
  })

  it("shows spinner when running", () => {
    renderCharacterNode({ data: { label: "Character", style: "realistic", gender: "male", characterName: "Hero", executionStatus: "running", characters: [], objects: [] } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
  })

  it("shows spinner when an asset (motion) is generating", () => {
    renderCharacterNode({ data: { label: "Character", style: "realistic", gender: "male", characterName: "Hero", motionStatus: "running", characters: [], objects: [] } })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
  })

  it("shows style and gender", () => {
    renderCharacterNode()
    expect(screen.getByText("realistic · male")).toBeInTheDocument()
  })

  it("shows characterName text", () => {
    renderCharacterNode()
    expect(screen.getByText("Hero")).toBeInTheDocument()
  })

  it("falls back to 'Unnamed' when no characterName", () => {
    renderCharacterNode({ data: { label: "Character", style: "realistic", gender: "male", characters: [], objects: [] } })
    expect(screen.getByText("Unnamed")).toBeInTheDocument()
  })

  it("shows asset badge counts (Expr / Poses / Motions)", () => {
    renderCharacterNode({
      data: {
        label: "Character", style: "realistic", gender: "male", characterName: "Hero",
        expressions: [{ name: "a", url: "x" }, { name: "b", url: "y" }],
        poses: [{ name: "p", url: "z" }],
        motions: [{ name: "m", url: "v" }, { name: "m2", url: "v2" }, { name: "m3", url: "v3" }],
        characters: [], objects: [],
      },
    })
    expect(screen.getByText("Expr 2")).toBeInTheDocument()
    expect(screen.getByText("Poses 1")).toBeInTheDocument()
    expect(screen.getByText("Motions 3")).toBeInTheDocument()
  })

  it("renders the Studio button and opens the studio for this node on click", () => {
    renderCharacterNode()
    const btn = screen.getByRole("button", { name: "Open Character Studio" })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(setCharacterStudioNodeIdMock).toHaveBeenCalledWith("node-1")
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
    const inHandle = screen.getByTestId("handle-target-in")
    expect(inHandle).toHaveAttribute("data-type", "target")
    expect(inHandle).toHaveAttribute("data-position", "left")

    const refHandle = screen.getByTestId("handle-source-faceRef")
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
  beforeEach(() => {
    setObjectStudioNodeIdMock.mockClear()
    updateNodeDataMock.mockClear()
    mockEdges = []
  })

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

  it("has correct handles (in + type + objectRef)", () => {
    renderObjectNode()
    const inHandle = screen.getByTestId("handle-target-in")
    expect(inHandle).toHaveAttribute("data-type", "target")
    expect(inHandle).toHaveAttribute("data-position", "left")

    const typeHandle = screen.getByTestId("handle-target-type")
    expect(typeHandle).toHaveAttribute("data-type", "target")
    expect(typeHandle).toHaveAttribute("data-position", "left")

    const refHandle = screen.getByTestId("handle-source-objectRef")
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

  // ---- Phase E3 — Studio integration -------------------------------------
  it("renders the Studio button and opens the studio for this node on click", () => {
    renderObjectNode()
    const btn = screen.getByRole("button", { name: "Open Object/Props Studio" })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(setObjectStudioNodeIdMock).toHaveBeenCalledWith("node-1")
  })

  it("shows all 5 asset badges with correct counts (Angles/Materials/Variations/Motion/Refs)", () => {
    renderObjectNode({
      data: {
        label: "Object",
        style: "realistic",
        objectName: "Sword",
        angles: [{ name: "front", url: "a" }, { name: "side", url: "b" }],
        materials: [{ name: "gold", url: "c" }],
        variations: [{ name: "v1", url: "d" }, { name: "v2", url: "e" }, { name: "v3", url: "f" }],
        motionClips: [{ name: "spin", url: "g" }, { name: "swing", url: "h" }, { name: "rotate", url: "i" }, { name: "drop", url: "j" }],
        referencePhotos: [{ url: "x", kind: "front" }],
      },
    })
    expect(screen.getByText("Angles 2")).toBeInTheDocument()
    expect(screen.getByText("Materials 1")).toBeInTheDocument()
    expect(screen.getByText("Variations 3")).toBeInTheDocument()
    expect(screen.getByText("Motion 4")).toBeInTheDocument()
    expect(screen.getByText("Refs 1")).toBeInTheDocument()
  })

  it("Motion badge uses amber tint (video variant) when populated", () => {
    renderObjectNode({
      data: {
        label: "Object",
        style: "realistic",
        objectName: "Sword",
        motionClips: [{ name: "spin", url: "g" }],
      },
    })
    const motionBadge = screen.getByText("Motion 1").parentElement as HTMLElement
    expect(motionBadge).toBeTruthy()
    expect(motionBadge.className).toMatch(/bg-amber/)
    expect(motionBadge.className).toMatch(/text-amber/)
  })

  it("image badges use emerald tint (default image variant) when populated", () => {
    renderObjectNode({
      data: {
        label: "Object",
        style: "realistic",
        objectName: "Sword",
        angles: [{ name: "front", url: "a" }],
      },
    })
    const anglesBadge = screen.getByText("Angles 1").parentElement as HTMLElement
    expect(anglesBadge).toBeTruthy()
    expect(anglesBadge.className).toMatch(/bg-emerald/)
    expect(anglesBadge.className).toMatch(/text-emerald/)
  })

  it("caps badge counts at '99+' when count exceeds 99", () => {
    const manyAngles = Array.from({ length: 100 }, (_, i) => ({ name: `a${i}`, url: `u${i}` }))
    renderObjectNode({
      data: {
        label: "Object",
        style: "realistic",
        objectName: "Sword",
        angles: manyAngles,
      },
    })
    expect(screen.getByText("Angles 99+")).toBeInTheDocument()
  })

  it("shows spinner when motionStatus is running (asset-level)", () => {
    renderObjectNode({
      data: {
        label: "Object",
        style: "realistic",
        objectName: "Sword",
        motionStatus: "running",
      },
    })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
  })

  it("auto-clears legacyPickerSelection when a type-handle edge wires for the first time", () => {
    // Set the edge BEFORE render so the selector picks up typeConnectionCount=1
    // on the initial commit, then the useEffect fires once.
    mockEdges = [{ source: "picker-1", target: "node-1", targetHandle: "type" }]
    renderObjectNode({
      data: {
        label: "Object",
        style: "realistic",
        objectName: "Sword",
        legacyPickerSelection: { kind: "animal", id: "wolf" },
      },
    })
    expect(updateNodeDataMock).toHaveBeenCalledWith("node-1", { legacyPickerSelection: null })
  })

  it("does NOT auto-clear when type handle has no connection (typeConnectionCount=0)", () => {
    mockEdges = []
    renderObjectNode({
      data: {
        label: "Object",
        style: "realistic",
        objectName: "Sword",
        legacyPickerSelection: { kind: "animal", id: "wolf" },
      },
    })
    expect(updateNodeDataMock).not.toHaveBeenCalled()
  })

  it("does NOT re-trigger auto-clear when legacyPickerSelection is already null (user dismissed)", () => {
    mockEdges = [{ source: "picker-1", target: "node-1", targetHandle: "type" }]
    renderObjectNode({
      data: {
        label: "Object",
        style: "realistic",
        objectName: "Sword",
        legacyPickerSelection: null,
      },
    })
    expect(updateNodeDataMock).not.toHaveBeenCalled()
  })

  it("does NOT auto-clear when legacyPickerSelection is undefined (no migration breadcrumb)", () => {
    mockEdges = [{ source: "picker-1", target: "node-1", targetHandle: "type" }]
    renderObjectNode({
      data: {
        label: "Object",
        style: "realistic",
        objectName: "Sword",
        // legacyPickerSelection intentionally omitted (undefined)
      },
    })
    expect(updateNodeDataMock).not.toHaveBeenCalled()
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
    const inHandle = screen.getByTestId("handle-target-in")
    expect(inHandle).toHaveAttribute("data-type", "target")
    expect(inHandle).toHaveAttribute("data-position", "left")

    const refHandle = screen.getByTestId("handle-source-locationRef")
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

  it("shows all 6 asset badges with correct counts (TOD/Weather/Seasons/Angles/Lighting/Motion)", () => {
    renderLocationNode({
      data: {
        label: "Location",
        style: "realistic",
        locationName: "Forest",
        timeOfDay: [{ name: "dawn", url: "x" }, { name: "noon", url: "y" }],
        weather: [{ name: "rain", url: "z" }],
        seasons: [{ name: "fall", url: "a" }, { name: "winter", url: "b" }, { name: "spring", url: "c" }],
        angles: [{ name: "wide", url: "d" }],
        lighting: [{ name: "warm", url: "e" }, { name: "cool", url: "f" }],
        atmosphereMotions: [{ name: "rainfall", url: "v1" }, { name: "fog", url: "v2" }, { name: "wind", url: "v3" }, { name: "snow", url: "v4" }],
      },
    })
    expect(screen.getByText("TOD 2")).toBeInTheDocument()
    expect(screen.getByText("Weather 1")).toBeInTheDocument()
    expect(screen.getByText("Seasons 3")).toBeInTheDocument()
    expect(screen.getByText("Angles 1")).toBeInTheDocument()
    expect(screen.getByText("Lighting 2")).toBeInTheDocument()
    expect(screen.getByText("Motion 4")).toBeInTheDocument()
  })

  it("Motion badge uses amber tint (video variant) when populated", () => {
    renderLocationNode({
      data: {
        label: "Location",
        style: "realistic",
        locationName: "Forest",
        atmosphereMotions: [{ name: "rainfall", url: "v1" }],
      },
    })
    const motionBadge = screen.getByText("Motion 1").parentElement as HTMLElement
    expect(motionBadge).toBeTruthy()
    expect(motionBadge.className).toMatch(/bg-amber/)
    expect(motionBadge.className).toMatch(/text-amber/)
  })

  it("image badges use cyan tint (default image variant) when populated", () => {
    renderLocationNode({
      data: {
        label: "Location",
        style: "realistic",
        locationName: "Forest",
        timeOfDay: [{ name: "dawn", url: "x" }],
      },
    })
    const todBadge = screen.getByText("TOD 1").parentElement as HTMLElement
    expect(todBadge).toBeTruthy()
    expect(todBadge.className).toMatch(/bg-cyan/)
    expect(todBadge.className).toMatch(/text-cyan/)
  })

  it("shows spinner when atmosphereStatus is running (asset-level)", () => {
    renderLocationNode({
      data: {
        label: "Location",
        style: "realistic",
        locationName: "Forest",
        atmosphereStatus: "running",
      },
    })
    expect(screen.getByTestId("base-node")).toHaveAttribute("data-is-running", "true")
  })
})
