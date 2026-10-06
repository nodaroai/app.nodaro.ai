/**
 * The Collections page: the person's collections with their record counts and
 * how full each is against the plan's cap; create, edit and delete (which asks
 * first); the empty state and the "not on this server yet" state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { Collection, ListCollectionsResult } from "@nodaro/shared"
import { en } from "@/lib/i18n/en"

const api = vi.hoisted(() => ({
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
}))

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import CollectionsPage from "../page"

function collection(id: string, overrides: Partial<Collection> = {}): Collection {
  return {
    id,
    name: `Collection ${id}`,
    description: "",
    recordCount: 0,
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-06T08:00:00Z",
    ...overrides,
  }
}

function page(data: Collection[], overrides: Partial<ListCollectionsResult> = {}): ListCollectionsResult {
  return { data, available: true, caps: { collections: 3, records: 500 }, ...overrides }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CollectionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.listCollections.mockReset().mockResolvedValue(page([collection("a", { name: "News", description: "Articles", recordCount: 500 }), collection("b", { name: "Leads", recordCount: 1 })]))
  api.createCollection.mockReset()
  api.updateCollection.mockReset()
  api.deleteCollection.mockReset()
})

describe("Collections page", () => {
  it("lists the collections with how full each is, and the plan's collection count", async () => {
    renderPage()
    expect(await screen.findByText("News")).toBeInTheDocument()
    expect(screen.getByText("Articles")).toBeInTheDocument()
    expect(screen.getByText("500 of 500 records")).toBeInTheDocument()
    expect(screen.getByText(en["collections.capReached"])).toBeInTheDocument()
    expect(screen.getByText("1 of 500 records")).toBeInTheDocument()
    expect(screen.getByText("2 of 3 collections")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /News/ })).toHaveAttribute("href", "/collections/a")
  })

  it("says how to start when there are no collections", async () => {
    api.listCollections.mockResolvedValue(page([]))
    renderPage()
    expect(await screen.findByText(en["collections.empty"])).toBeInTheDocument()
  })

  it("says collections are not on this server yet, and offers no New button", async () => {
    api.listCollections.mockResolvedValue(page([], { available: false }))
    renderPage()
    expect(await screen.findByText(en["collections.notAvailable"])).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: en["collections.new"] })).not.toBeInTheDocument()
  })

  it("creates a collection from the dialog", async () => {
    api.createCollection.mockResolvedValue(collection("c", { name: "World" }))
    renderPage()
    await screen.findByText("News")
    fireEvent.click(screen.getByRole("button", { name: en["collections.new"] }))

    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByPlaceholderText(en["collections.namePlaceholder"]), { target: { value: "  World " } })
    fireEvent.change(within(dialog).getByPlaceholderText(en["collections.descriptionPlaceholder"]), { target: { value: "Everything else" } })
    fireEvent.click(within(dialog).getByRole("button", { name: en["collections.create"] }))

    await waitFor(() => expect(api.createCollection).toHaveBeenCalledWith({ name: "World", description: "Everything else" }))
  })

  it("keeps the New button off once the plan's collection cap is reached", async () => {
    api.listCollections.mockResolvedValue(page([collection("a"), collection("b"), collection("c")]))
    renderPage()
    await screen.findByText("Collection a")
    expect(screen.getByRole("button", { name: en["collections.new"] })).toBeDisabled()
  })

  it("deletes a collection only after the confirmation", async () => {
    api.deleteCollection.mockResolvedValue(undefined)
    renderPage()
    await screen.findByText("Leads")
    const menus = screen.getAllByRole("button", { name: en["common.more"] })
    fireEvent.keyDown(menus[1]!, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: en["collections.deleteCollection"] }))
    expect(api.deleteCollection).not.toHaveBeenCalled()

    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText(en["collections.deleteConfirmTitle"])).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole("button", { name: en["common.delete"] }))
    await waitFor(() => expect(api.deleteCollection).toHaveBeenCalledWith("b"))
  })
})
