import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react"

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: React.ComponentProps<"img">) => <img alt={props.alt} src={props.src} />,
}))
vi.mock("@/components/ui/input", () => ({ Input: (props: React.ComponentProps<"input">) => <input {...props} /> }))
vi.mock("@/components/ui/select", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return { Select: Passthrough, SelectContent: Passthrough, SelectItem: Passthrough, SelectTrigger: Passthrough, SelectValue: Passthrough }
})
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }))
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: () => ({ data: [] }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
vi.mock("@/lib/query-keys", () => ({ queryKeys: { assets: { all: ["assets"] }, clientApps: { list: () => ["clientApps", "list"] } } }))
vi.mock("@/lib/asset-to-node", () => ({ assetToUploadNode: () => null }))
vi.mock("../library-media-browser", () => ({ LibraryMediaBrowser: () => <div data-testid="media-browser" /> }))
vi.mock("../character-page-modal", () => ({ CharacterPageModal: () => null }))
vi.mock("../object-page-modal", () => ({ ObjectPageModal: () => null }))
vi.mock("../creature-studio/creature-studio-modal", () => ({ default: () => null }))
vi.mock("../location-studio/location-studio-modal", () => ({ default: () => null }))
// A canvas node bound to the fox, so the "On canvas" badge has something to say.
vi.mock("@/hooks/use-workflow-store", () => {
  const nodes = [{ id: "n-fox", type: "creature", position: { x: 0, y: 0 }, data: { creatureDbId: "cre-1" } }]
  return {
    useWorkflowStore: Object.assign(
      (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ nodes, selectNode: vi.fn(), addNode: vi.fn(), updateNodeData: vi.fn() }),
      { getState: () => ({ nodes, addNode: vi.fn(), selectNode: vi.fn() }) },
    ),
  }
})
const FOX = {
  id: "cre-1", name: "Red Fox", species: "red fox", category: "wild", style: "realistic",
  sourceImageUrl: "https://example.com/fox.png", description: "a sly fox", projectId: "proj-1",
  angles: [], poses: [], variations: [],
}
const creatures = vi.fn(() => ({ data: [FOX] as (typeof FOX)[], isLoading: false, error: null as unknown }))
vi.mock("@/hooks/queries/use-assets-queries", () => {
  const empty = () => ({ data: [], isLoading: false, error: null })
  return { useCharacters: empty, useObjects: empty, useCreatures: () => creatures(), useLocations: empty, useFaces: empty }
})

import { UnifiedAssetLibraryModal, UnifiedAssetLibraryButton } from "../unified-asset-library"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

beforeEach(() => {
  creatures.mockReturnValue({ data: [FOX], isLoading: false, error: null })
  act(() => useLocaleStore.getState().setLocale("he"))
})
afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

// The modal had no translation hook at all — title, search, project filter,
// every type tab and every empty state rendered English in a Hebrew UI.
describe("My Library modal in Hebrew", () => {
  it("renders the title, search box, project filter and type tabs in Hebrew", () => {
    render(<UnifiedAssetLibraryModal open onClose={vi.fn()} />)
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(translate("he", "canvas.myLibrary"))
    expect(screen.getByPlaceholderText(translate("he", "assetlib.searchPlaceholder"))).toBeTruthy()
    expect(screen.getByText(translate("he", "assetlib.projectLabel"))).toBeTruthy()
    expect(screen.getByRole("button", { name: /דמויות/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /יצורים/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /מקומות/ })).toBeTruthy()
    for (const en of ["My Library", "Characters", "Objects/Props", "Creatures", "Locations", "Faces", "Images", "Videos", "Audio", "Project:"]) {
      expect(screen.queryByText(en), `raw English "${en}"`).toBeNull()
    }
  })

  it("explains an empty library in Hebrew", () => {
    render(<UnifiedAssetLibraryModal open onClose={vi.fn()} />)
    // The All tab shows the media browser; a definition tab shows the grid's empty state.
    fireEvent.click(screen.getByRole("button", { name: /דמויות/ }))
    expect(screen.getByText(translate("he", "assetlib.noMatching"))).toBeTruthy()
    expect(screen.getByText(translate("he", "assetlib.tryFilters"))).toBeTruthy()
    expect(screen.queryByText("No matching assets")).toBeNull()
  })

  it("labels an asset card's type in Hebrew", () => {
    render(<UnifiedAssetLibraryModal open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /יצורים/ }))
    expect(screen.getByText("Red Fox")).toBeTruthy()
    expect(screen.getByText(translate("he", "assetlib.typeCreature"))).toBeTruthy()
    expect(screen.queryByText("creature")).toBeNull()
  })
})

// The sidebar trigger opens the file's SECOND ~600-line body — the one
// node-toolbar actually mounts. It was localized in step with the modal and
// needs its own render, or a drift between the two bodies passes silently.
describe("My Library from the sidebar button in Hebrew", () => {
  it("renders the opened library in Hebrew, with the card's on-canvas badge", () => {
    render(<UnifiedAssetLibraryButton />)
    fireEvent.click(screen.getByRole("button", { name: new RegExp(translate("he", "toolbar.myLibrary")) }))
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(translate("he", "canvas.myLibrary"))
    expect(screen.getByPlaceholderText(translate("he", "assetlib.searchPlaceholder"))).toBeTruthy()
    expect(screen.getByRole("button", { name: /יצורים/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /דמויות/ }))
    expect(screen.getByText(translate("he", "assetlib.noMatching"))).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /יצורים/ }))
    expect(screen.getByText(translate("he", "assetlib.typeCreature"))).toBeTruthy()
    expect(screen.getByText(translate("he", "assetlib.onCanvas"))).toBeTruthy()
    for (const en of ["My Library", "Characters", "Creatures", "On canvas", "creature"]) {
      expect(screen.queryByText(en), `raw English "${en}"`).toBeNull()
    }
  })

  it("explains a library with nothing saved yet, in Hebrew", () => {
    creatures.mockReturnValue({ data: [], isLoading: false, error: null })
    render(<UnifiedAssetLibraryButton />)
    fireEvent.click(screen.getByRole("button", { name: new RegExp(translate("he", "toolbar.myLibrary")) }))
    // Untouched default tab, no filters: the "nothing saved" branch.
    expect(screen.getByText(translate("he", "assetlib.noSaved"))).toBeTruthy()
    expect(screen.getByText(translate("he", "assetlib.generateHint"))).toBeTruthy()
    expect(screen.queryByText("No saved assets")).toBeNull()
  })
})
