import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Stub every lucide icon the gallery uses to a plain span.
vi.mock("lucide-react", () => {
  const Icon = (props: any) => <span data-testid="mock-icon" {...props} />
  return {
    PawPrint: Icon,
    X: Icon,
    Loader2: Icon,
    AlertCircle: Icon,
    Plus: Icon,
  }
})

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img alt={props.alt} src={props.src} />,
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}))

// Mutable workflow-store mock fields so each test can assert on the actions.
const addNodeMock = vi.fn(() => "new-node-1")
const updateNodeDataMock = vi.fn()
const selectNodeMock = vi.fn()
const setCreatureStudioNodeIdMock = vi.fn()
let mockNodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }> = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({
    nodes: mockNodes,
    selectNode: selectNodeMock,
    addNode: addNodeMock,
    updateNodeData: updateNodeDataMock,
    projectId: "proj-1",
    setCreatureStudioNodeId: setCreatureStudioNodeIdMock,
  }),
}))

// useCreatures is the data source the gallery renders.
const useCreaturesMock = vi.fn()
vi.mock("@/hooks/queries/use-assets-queries", () => ({
  useCreatures: (...args: unknown[]) => useCreaturesMock(...args),
}))

import { CreatureGalleryButton } from "../creature-gallery"

const FOX = {
  id: "cre-1",
  userId: "user-1",
  nodeId: "n1",
  projectId: "proj-1",
  name: "Red Fox",
  description: "a sly fox",
  species: "red fox",
  category: "wild",
  style: "realistic",
  sourceImageUrl: "https://example.com/fox.png",
  angles: [],
  poses: [{ name: "sitting", url: "https://example.com/pose.png" }],
  variations: [],
  motionClips: [],
  referencePhotos: [],
  canonicalDescription: "",
  styleLock: true,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
}

function mockCreatures(data: unknown[], extra: Record<string, unknown> = {}) {
  useCreaturesMock.mockReturnValue({ data, isLoading: false, error: null, refetch: vi.fn(), ...extra })
}

describe("CreatureGalleryButton", () => {
  beforeEach(() => {
    addNodeMock.mockClear()
    updateNodeDataMock.mockClear()
    selectNodeMock.mockClear()
    setCreatureStudioNodeIdMock.mockClear()
    useCreaturesMock.mockReset()
    mockNodes = []
  })

  it("renders the Animal/Creature trigger button with a count badge", () => {
    mockCreatures([FOX])
    render(<CreatureGalleryButton />)
    const btn = screen.getByRole("button", { name: /Animal\/Creature/ })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent("1")
  })

  it("opens the library and lists saved creatures by name", () => {
    mockCreatures([FOX])
    render(<CreatureGalleryButton />)
    fireEvent.click(screen.getByRole("button", { name: /Animal\/Creature/ }))
    expect(screen.getByText("Animal/Creature Library")).toBeInTheDocument()
    expect(screen.getByText("Red Fox")).toBeInTheDocument()
  })

  it("shows the empty state when there are no creatures", () => {
    mockCreatures([])
    render(<CreatureGalleryButton />)
    fireEvent.click(screen.getByRole("button", { name: /Animal\/Creature/ }))
    expect(screen.getByText("No saved creatures")).toBeInTheDocument()
  })

  it("clicking a creature (not on canvas) adds a creature node, populates it with the creature delta fields, and opens the Creature Studio", () => {
    mockCreatures([FOX])
    render(<CreatureGalleryButton />)
    fireEvent.click(screen.getByRole("button", { name: /Animal\/Creature/ }))
    fireEvent.click(screen.getByTitle("View Red Fox"))

    // adds a creature node
    expect(addNodeMock).toHaveBeenCalledWith("creature", expect.any(Object))
    // populates with creature DELTA fields (creatureDbId/creatureName/species/poses)
    expect(updateNodeDataMock).toHaveBeenCalledWith(
      "new-node-1",
      expect.objectContaining({
        creatureDbId: "cre-1",
        creatureName: "Red Fox",
        species: "red fox",
        poses: [{ name: "sitting", url: "https://example.com/pose.png" }],
      }),
    )
    // opens the Creature Studio (object-gallery's open-studio equivalent)
    expect(setCreatureStudioNodeIdMock).toHaveBeenCalledWith("new-node-1")
  })

  it("clicking a creature already on canvas opens its Studio without adding a node", () => {
    mockNodes = [
      { id: "existing-1", type: "creature", position: { x: 0, y: 0 }, data: { creatureDbId: "cre-1" } },
    ]
    mockCreatures([FOX])
    render(<CreatureGalleryButton />)
    fireEvent.click(screen.getByRole("button", { name: /Animal\/Creature/ }))
    fireEvent.click(screen.getByTitle("View Red Fox"))

    expect(setCreatureStudioNodeIdMock).toHaveBeenCalledWith("existing-1")
    expect(addNodeMock).not.toHaveBeenCalled()
  })

  it("the '+' button adds the creature to the canvas without opening the Studio", () => {
    mockCreatures([FOX])
    render(<CreatureGalleryButton />)
    fireEvent.click(screen.getByRole("button", { name: /Animal\/Creature/ }))
    fireEvent.click(screen.getByTitle("Add Red Fox to canvas"))

    expect(addNodeMock).toHaveBeenCalledWith("creature", expect.any(Object))
    expect(updateNodeDataMock).toHaveBeenCalledWith(
      "new-node-1",
      expect.objectContaining({ creatureDbId: "cre-1", poses: expect.any(Array) }),
    )
    expect(selectNodeMock).toHaveBeenCalledWith("new-node-1")
    // "+" must NOT open the studio (mirrors object-gallery's handleAddToCanvas)
    expect(setCreatureStudioNodeIdMock).not.toHaveBeenCalled()
  })
})
