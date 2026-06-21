import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const bindSpy = vi.fn().mockResolvedValue(true)
vi.mock("@/lib/entity-node-data", () => ({
  bindEntityNodeFromLibrary: (...a: unknown[]) => bindSpy(...a),
}))

const getCharacters = vi.fn()
const cloneCommunityListing = vi.fn()
const browseCommunity = vi.fn()
const getMyClonesOfListing = vi.fn()
const deleteSpy = vi.fn()
vi.mock("@/lib/api", () => ({
  getCharacters: (...a: unknown[]) => getCharacters(...a),
  getObjects: vi.fn().mockResolvedValue({ objects: [] }),
  getCreatures: vi.fn().mockResolvedValue({ creatures: [] }),
  getLocations: vi.fn().mockResolvedValue({ locations: [] }),
  deleteCharacter: (...a: unknown[]) => deleteSpy(...a),
  deleteObject: (...a: unknown[]) => deleteSpy(...a),
  deleteCreature: (...a: unknown[]) => deleteSpy(...a),
  deleteLocation: (...a: unknown[]) => deleteSpy(...a),
  browseCommunity: (...a: unknown[]) => browseCommunity(...a),
  cloneCommunityListing: (...a: unknown[]) => cloneCommunityListing(...a),
  getMyClonesOfListing: (...a: unknown[]) => getMyClonesOfListing(...a),
}))

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { AssetPickerModal } from "../asset-picker-modal"

function renderModal(props: Partial<React.ComponentProps<typeof AssetPickerModal>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <AssetPickerModal kind="character" nodeId="n1" currentDbId={null} open onOpenChange={onOpenChange} {...props} />
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

const HERO = { id: "listing-9", title: "Hero", creator_display_name: "Ann", clone_count: 3, preview_media_url: "p", preview_images: [] }

beforeEach(() => {
  bindSpy.mockClear().mockResolvedValue(true)
  getCharacters.mockReset().mockResolvedValue({ characters: [{ id: "c1", name: "Kira", sourceImageUrl: "img" }] })
  browseCommunity.mockReset().mockResolvedValue({ data: [], nextCursor: null })
  cloneCommunityListing.mockReset().mockResolvedValue({ entityType: "character", id: "clone-1" })
  getMyClonesOfListing.mockReset().mockResolvedValue({ clones: [] })
  deleteSpy.mockReset().mockResolvedValue({ success: true, archived: true })
})

describe("AssetPickerModal", () => {
  it("My Library: clicking an asset binds the node and closes", async () => {
    const { onOpenChange } = renderModal()
    const item = await screen.findByTitle("Kira")
    fireEvent.click(item)
    await waitFor(() => expect(bindSpy).toHaveBeenCalledWith("character", "n1", "c1"))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("Public Gallery: a never-cloned listing clones, then binds the clone", async () => {
    browseCommunity.mockResolvedValue({ data: [HERO], nextCursor: null })
    const user = userEvent.setup()
    const { onOpenChange } = renderModal()

    await user.click(screen.getByRole("tab", { name: /Public Gallery/i }))
    await screen.findByPlaceholderText(/Search the public gallery/i)
    await user.click(await screen.findByText("Hero"))

    await waitFor(() => expect(cloneCommunityListing).toHaveBeenCalledWith("listing-9", "character"))
    await waitFor(() => expect(bindSpy).toHaveBeenCalledWith("character", "n1", "clone-1"))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("Public Gallery: an already-cloned listing offers a choice; 'use my copy' binds without cloning", async () => {
    browseCommunity.mockResolvedValue({ data: [HERO], nextCursor: null })
    getMyClonesOfListing.mockResolvedValue({ clones: [{ id: "mine-1", name: "Hero (mine)", sourceImageUrl: "x" }] })
    const user = userEvent.setup()
    const { onOpenChange } = renderModal()

    await user.click(screen.getByRole("tab", { name: /Public Gallery/i }))
    await user.click(await screen.findByText("Hero"))

    // choice panel renders the existing copy
    await user.click(await screen.findByText("Hero (mine)"))
    await waitFor(() => expect(bindSpy).toHaveBeenCalledWith("character", "n1", "mine-1"))
    expect(cloneCommunityListing).not.toHaveBeenCalled()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("Public Gallery: 'make a new copy' clones even when a copy exists", async () => {
    browseCommunity.mockResolvedValue({ data: [HERO], nextCursor: null })
    getMyClonesOfListing.mockResolvedValue({ clones: [{ id: "mine-1", name: "Hero (mine)", sourceImageUrl: "x" }] })
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole("tab", { name: /Public Gallery/i }))
    await user.click(await screen.findByText("Hero"))
    await user.click(await screen.findByRole("button", { name: /Make a new copy/i }))

    await waitFor(() => expect(cloneCommunityListing).toHaveBeenCalledWith("listing-9", "character"))
    await waitFor(() => expect(bindSpy).toHaveBeenCalledWith("character", "n1", "clone-1"))
  })

  it("My Library: delete asks to confirm, then soft-deletes and does not bind", async () => {
    const user = userEvent.setup()
    renderModal()
    await screen.findByTitle("Kira")

    await user.click(screen.getByRole("button", { name: /Delete Kira/i }))
    await user.click(await screen.findByRole("button", { name: /^Delete$/ }))

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("c1"))
    expect(bindSpy).not.toHaveBeenCalled()
  })

  it("empty library shows a helpful prompt, not a crash", async () => {
    getCharacters.mockResolvedValue({ characters: [] })
    renderModal()
    expect(await screen.findByText(/No saved characters yet/i)).toBeInTheDocument()
  })
})
