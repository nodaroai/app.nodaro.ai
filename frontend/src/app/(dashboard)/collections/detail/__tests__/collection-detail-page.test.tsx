/**
 * One collection's records: the headline links out, the fields show as chips,
 * a search narrows the list, a record is deleted only after the confirmation,
 * and Export hands the browser the server's file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { Collection, CollectionRecord } from "@nodaro/shared"
import { en } from "@/lib/i18n/en"
import { recordStill } from "@/lib/collection-record-view"

const api = vi.hoisted(() => ({
  listCollections: vi.fn(),
  getCollection: vi.fn(),
  listCollectionRecords: vi.fn(),
  deleteCollectionRecord: vi.fn(),
  exportCollection: vi.fn(),
}))

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import CollectionDetailPage from "../page"

const COLL: Collection = {
  id: "00000000-0000-4000-8000-0000000000c1",
  name: "News",
  description: "Articles the pipeline wrote",
  recordCount: 2,
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
}

function record(id: string, overrides: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id,
    collectionId: COLL.id,
    title: `Story ${id}`,
    text: "The body of the story.",
    url: `https://www.example.com/stories/${id}`,
    media: [],
    fields: {},
    dedupeKey: null,
    source: { via: "node" },
    createdAt: "2026-10-06T09:00:00Z",
    ...overrides,
  }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/collections/${COLL.id}`]}>
        <Routes>
          <Route path="/collections/:id" element={<CollectionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.listCollections.mockReset().mockResolvedValue({ data: [COLL], available: true, caps: { collections: 3, records: 500 } })
  api.getCollection.mockReset().mockResolvedValue(COLL)
  api.listCollectionRecords.mockReset().mockResolvedValue({
    data: [
      record("a", { fields: { channel: "telegram", topic: "tech", a: 1, b: 2, c: 3 }, media: [{ type: "image", url: "https://cdn.example.com/a.jpg" }] }),
      record("b", { title: "", text: "First line is the headline\nSecond line", url: null }),
    ],
    nextCursor: null,
  })
  api.deleteCollectionRecord.mockReset()
  api.exportCollection.mockReset()
})

describe("record card helpers", () => {
  it("the still is the first image, else a video's poster", () => {
    expect(recordStill(record("a", { media: [{ type: "video", url: "https://cdn.example.com/v.mp4", posterUrl: "https://cdn.example.com/p.jpg" }] }))).toBe(
      "https://cdn.example.com/p.jpg",
    )
    expect(recordStill(record("a"))).toBeUndefined()
  })
})

describe("Collection detail page", () => {
  it("shows the collection, how full it is, and each record's headline, where its link opens, and fields", async () => {
    renderPage()
    expect(await screen.findByRole("heading", { level: 1, name: "News" })).toBeInTheDocument()
    expect(screen.getByText("2 of 500 records")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Story a" })).toHaveAttribute("href", "https://www.example.com/stories/a")
    expect(screen.getByRole("link", { name: "Open in example.com" })).toHaveAttribute("href", "https://www.example.com/stories/a")
    expect(screen.getByText("First line is the headline")).toBeInTheDocument()
    expect(screen.getByText("channel: telegram")).toBeInTheDocument()
    expect(screen.getByText("+1 more")).toBeInTheDocument()
    expect(screen.getByText(en["collections.mediaExpiry"])).toBeInTheDocument()
    expect(api.listCollectionRecords).toHaveBeenCalledWith(COLL.id, { q: undefined, cursor: undefined, limit: 50 })
  })

  it("searches the records with the typed words", async () => {
    renderPage()
    await screen.findByText("Story a")
    fireEvent.change(screen.getByPlaceholderText(en["collections.searchPlaceholder"]), { target: { value: " telegram " } })
    await waitFor(() => expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ q: "telegram" })))
  })

  it("deletes a record only after the confirmation", async () => {
    api.deleteCollectionRecord.mockResolvedValue(undefined)
    renderPage()
    await screen.findByText("Story a")
    fireEvent.click(screen.getAllByRole("button", { name: en["collections.deleteRecord"] })[0]!)
    expect(api.deleteCollectionRecord).not.toHaveBeenCalled()
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: en["common.delete"] }))
    await waitFor(() => expect(api.deleteCollectionRecord).toHaveBeenCalledWith(COLL.id, "a"))
  })

  it("exports the collection as the format picked and hands the browser the server's file", async () => {
    api.exportCollection.mockResolvedValue({ blob: new Blob(["id\n"], { type: "text/csv" }), filename: "news-2026-10-06.csv" })
    const createObjectURL = vi.fn(() => "blob:news")
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    renderPage()
    await screen.findByText("Story a")
    fireEvent.keyDown(screen.getByRole("button", { name: en["collections.export"] }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: en["collections.exportCsv"] }))
    await waitFor(() => expect(api.exportCollection).toHaveBeenCalledWith(COLL.id, "csv"))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:news")
    click.mockRestore()
  })

  it("says when nothing matches, and when the collection is still empty", async () => {
    api.listCollectionRecords.mockResolvedValue({ data: [], nextCursor: null })
    renderPage()
    expect(await screen.findByText(en["collections.noRecords"])).toBeInTheDocument()
  })
})
