import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("lucide-react", () => {
  const Icon = (props: any) => <span data-testid="mock-icon" {...props} />
  return {
    X: Icon,
    Loader2: Icon,
    AlertCircle: Icon,
    Search: Icon,
    UserCircle: Icon,
    Package: Icon,
    PawPrint: Icon,
    MapPin: Icon,
    SmilePlus: Icon,
  }
})

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img alt={props.alt} src={props.src} />,
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
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

import { AssetSelectionModal } from "../asset-selection-modal"

const FOX = {
  id: "cre-1",
  name: "Red Fox",
  species: "red fox",
  sourceImageUrl: "https://example.com/fox.png",
  description: "a sly fox",
}

describe("AssetSelectionModal — creature support", () => {
  beforeEach(() => {
    useCharactersMock.mockReturnValue({ data: [], isLoading: false, error: null })
    useObjectsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    useCreaturesMock.mockReturnValue({ data: [FOX], isLoading: false, error: null })
    useLocationsMock.mockReturnValue({ data: [], isLoading: false, error: null })
    useFacesMock.mockReturnValue({ data: [], isLoading: false, error: null })
  })

  it("renders an Animal/Creature filter tab with the creature count", () => {
    render(<AssetSelectionModal isOpen onClose={() => {}} onSelect={() => {}} />)
    expect(screen.getByRole("button", { name: /Animal\/Creature \(1\)/ })).toBeInTheDocument()
  })

  it("lists saved creatures as selectable assets", () => {
    render(<AssetSelectionModal isOpen onClose={() => {}} onSelect={() => {}} />)
    expect(screen.getByText("Red Fox")).toBeInTheDocument()
  })

  it("calls onSelect with type 'creature' when a creature is picked", () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<AssetSelectionModal isOpen onClose={onClose} onSelect={onSelect} />)
    // The card button's accessible name is the creature name.
    fireEvent.click(screen.getByRole("button", { name: /Red Fox/ }))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cre-1",
        name: "Red Fox",
        type: "creature",
        thumbnailUrl: "https://example.com/fox.png",
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it("filtering to the creature tab keeps creatures and hides other types", () => {
    useObjectsMock.mockReturnValue({
      data: [{ id: "obj-1", name: "Sword", sourceImageUrl: "https://example.com/sword.png", description: "" }],
      isLoading: false,
      error: null,
    })
    render(<AssetSelectionModal isOpen onClose={() => {}} onSelect={() => {}} />)
    // Both visible under "All".
    expect(screen.getByText("Sword")).toBeInTheDocument()
    expect(screen.getByText("Red Fox")).toBeInTheDocument()
    // Switch to the creature filter.
    fireEvent.click(screen.getByRole("button", { name: /Animal\/Creature \(1\)/ }))
    expect(screen.getByText("Red Fox")).toBeInTheDocument()
    expect(screen.queryByText("Sword")).not.toBeInTheDocument()
  })
})
