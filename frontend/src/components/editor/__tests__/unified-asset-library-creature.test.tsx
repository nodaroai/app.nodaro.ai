import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("lucide-react", () => {
  const Icon = (props: any) => <span data-testid="mock-icon" {...props} />
  return {
    Grid3X3: Icon,
    X: Icon,
    Loader2: Icon,
    AlertCircle: Icon,
    Plus: Icon,
    Search: Icon,
    UserCircle: Icon,
    Package: Icon,
    PawPrint: Icon,
    MapPin: Icon,
    SmilePlus: Icon,
    FolderOpen: Icon,
    Images: Icon,
    Film: Icon,
    Music: Icon,
  }
})

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img alt={props.alt} src={props.src} />,
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))

// Stub the shadcn Select so the project-filter dropdown is inert.
vi.mock("@/components/ui/select", () => {
  const Passthrough = ({ children }: any) => <div>{children}</div>
  return {
    Select: Passthrough,
    SelectContent: Passthrough,
    SelectItem: Passthrough,
    SelectTrigger: Passthrough,
    SelectValue: Passthrough,
  }
})

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}))

// React Query: the component calls useQueryClient + useQuery (projects list).
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: [] }),
}))

vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { assets: { all: ["assets"] } } }))
vi.mock("@/lib/asset-to-node", () => ({ assetToUploadNode: () => null }))
vi.mock("../library-media-browser", () => ({ LibraryMediaBrowser: () => <div data-testid="media-browser" /> }))
vi.mock("../character-page-modal", () => ({ CharacterPageModal: () => null }))
vi.mock("../object-page-modal", () => ({ ObjectPageModal: () => null }))
vi.mock("../creature-studio/creature-studio-modal", () => ({ default: () => <div data-testid="creature-studio" /> }))
vi.mock("../location-studio/location-studio-modal", () => ({ default: () => null }))

const addNodeMock = vi.fn(() => "new-node-1")
const updateNodeDataMock = vi.fn()
const selectNodeMock = vi.fn()
let mockNodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }> = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: any) => selector({
      nodes: mockNodes,
      selectNode: selectNodeMock,
      addNode: addNodeMock,
      updateNodeData: updateNodeDataMock,
    }),
    { getState: () => ({ nodes: mockNodes, addNode: addNodeMock, selectNode: selectNodeMock }) },
  ),
}))

type AssetQueryResult = { data: any[]; isLoading: boolean; error: unknown }
const useCharactersMock = vi.fn<() => AssetQueryResult>(() => ({ data: [], isLoading: false, error: null }))
const useObjectsMock = vi.fn<() => AssetQueryResult>(() => ({ data: [], isLoading: false, error: null }))
const useCreaturesMock = vi.fn<() => AssetQueryResult>(() => ({ data: [], isLoading: false, error: null }))
const useLocationsMock = vi.fn<() => AssetQueryResult>(() => ({ data: [], isLoading: false, error: null }))
const useFacesMock = vi.fn<() => AssetQueryResult>(() => ({ data: [], isLoading: false, error: null }))

vi.mock("@/hooks/queries/use-assets-queries", () => ({
  useCharacters: () => useCharactersMock(),
  useObjects: () => useObjectsMock(),
  useCreatures: () => useCreaturesMock(),
  useLocations: () => useLocationsMock(),
  useFaces: () => useFacesMock(),
}))

import { UnifiedAssetLibraryModal } from "../unified-asset-library"

const FOX = {
  id: "cre-1",
  name: "Red Fox",
  species: "red fox",
  category: "wild",
  style: "realistic",
  sourceImageUrl: "https://example.com/fox.png",
  description: "a sly fox",
  projectId: "proj-1",
  angles: [],
  poses: [{ name: "sitting", url: "https://example.com/pose.png" }],
  variations: [],
}

describe("UnifiedAssetLibraryModal — Creatures tab", () => {
  beforeEach(() => {
    addNodeMock.mockClear()
    updateNodeDataMock.mockClear()
    selectNodeMock.mockClear()
    mockNodes = []
    useCharactersMock.mockReturnValue({ data: [], isLoading: false, error: null })
    useObjectsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    useCreaturesMock.mockReturnValue({ data: [FOX], isLoading: false, error: null })
    useLocationsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    useFacesMock.mockReturnValue({ data: [], isLoading: false, error: null })
  })

  it("renders a Creatures filter tab with the creature count", () => {
    render(<UnifiedAssetLibraryModal open onClose={() => {}} />)
    const tab = screen.getByRole("button", { name: /Creatures/ })
    expect(tab).toBeInTheDocument()
    expect(tab).toHaveTextContent("(1)")
  })

  it("clicking the Creatures tab shows the saved creature card", () => {
    render(<UnifiedAssetLibraryModal open onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /Creatures/ }))
    expect(screen.getByText("Red Fox")).toBeInTheDocument()
  })

  it("clicking a creature card (not on canvas) adds a creature node with the creature delta fields", () => {
    render(<UnifiedAssetLibraryModal open onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /Creatures/ }))
    fireEvent.click(screen.getByTitle("View Red Fox"))

    expect(addNodeMock).toHaveBeenCalledWith("creature", expect.any(Object))
    expect(updateNodeDataMock).toHaveBeenCalledWith(
      "new-node-1",
      expect.objectContaining({
        creatureDbId: "cre-1",
        creatureName: "Red Fox",
        species: "red fox",
        poses: [{ name: "sitting", url: "https://example.com/pose.png" }],
      }),
    )
  })
})
