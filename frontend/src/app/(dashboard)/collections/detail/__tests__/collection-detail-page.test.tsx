/**
 * One collection's records: numbered cards that say where each record came
 * from (source, workflow, the run), tabs for used / not yet / the Trash with
 * counts, a page at a time, select mode with a bulk delete, the Trash's
 * restore, a search, a day range, and Export handing the browser the file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { Collection, CollectionRecord } from "@nodaro/shared"
import { en } from "@/lib/i18n/en"
import { localDayOf, localDayStartIso, recordSource, recordStill } from "@/lib/collection-record-view"
import { pageWindow } from "@/components/collections/collection-pagination"

const api = vi.hoisted(() => ({
  listCollections: vi.fn(),
  getCollection: vi.fn(),
  listCollectionRecords: vi.fn(),
  deleteCollectionRecord: vi.fn(),
  deleteCollectionRecordForever: vi.fn(),
  restoreCollectionRecord: vi.fn(),
  bulkCollectionRecords: vi.fn(),
  setCollectionRecordUsed: vi.fn(),
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
/** The collection as a server after the usage release answers it: counts for the tabs. */
const COLL_COUNTED: Collection = { ...COLL, usedCount: 1, trashCount: 0 }

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
    usedAt: null,
    usedBy: {},
    deletedAt: null,
    ...overrides,
  }
}

const WF = "00000000-0000-4000-8000-00000000aaa1"
const PROJECT = "00000000-0000-4000-8000-00000000bbb1"
const RUN = "00000000-0000-4000-8000-00000000ccc1"
const FROM_RUN = { via: "node" as const, nodeType: "collection-write", workflowId: WF, projectId: PROJECT, executionId: RUN, workflowName: "News pipeline" }
const FIRST_PAGE = { q: undefined, usage: "all", status: "active", order: "newest", since: undefined, until: undefined, offset: 0, limit: 6 }

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

/** Radix Tabs activate on mouse-down, not on click. */
const pickTab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 })

beforeEach(() => {
  api.listCollections.mockReset().mockResolvedValue({ data: [COLL], available: true, caps: { collections: 3, records: 500 } })
  api.getCollection.mockReset().mockResolvedValue(COLL)
  api.listCollectionRecords.mockReset().mockResolvedValue({
    data: [
      record("a", { fields: { channel: "telegram", topic: "tech", a: 1, b: 2, c: 3 }, media: [{ type: "image", url: "https://cdn.example.com/a.jpg" }] }),
      record("b", { title: "", text: "First line is the headline\nSecond line", url: null }),
    ],
    nextCursor: null,
    total: 2,
  })
  api.deleteCollectionRecord.mockReset().mockResolvedValue(undefined)
  api.deleteCollectionRecordForever.mockReset().mockResolvedValue(undefined)
  api.restoreCollectionRecord.mockReset()
  api.bulkCollectionRecords.mockReset()
  api.setCollectionRecordUsed.mockReset()
  api.exportCollection.mockReset()
})

describe("record card helpers", () => {
  it("the still is the first image, else a video's poster", () => {
    expect(recordStill(record("a", { media: [{ type: "video", url: "https://cdn.example.com/v.mp4", posterUrl: "https://cdn.example.com/p.jpg" }] }))).toBe(
      "https://cdn.example.com/p.jpg",
    )
    expect(recordStill(record("a"))).toBeUndefined()
  })

  it("the source is the link's site, else a source named among the fields, else nothing", () => {
    expect(recordSource(record("a"))).toEqual({ name: "example.com", href: "https://www.example.com/stories/a" })
    expect(recordSource(record("b", { url: null, fields: { primarySource: "The Trump administration" } }))).toEqual({ name: "The Trump administration", href: null })
    expect(recordSource(record("c", { url: null }))).toBeNull()
  })

  it("the page numbers offered are the ends, the current page and its neighbours, with gaps between", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
    expect(pageWindow(5, 12)).toEqual([1, 2, "gap", 4, 5, 6, "gap", 11, 12])
    expect(pageWindow(1, 12)).toEqual([1, 2, "gap", 11, 12])
    expect(pageWindow(12, 12)).toEqual([1, 2, "gap", 11, 12])
  })
})

describe("Collection detail page", () => {
  it("shows the collection, how full it is, and each record numbered with its headline, source, text and fields", async () => {
    renderPage()
    expect(await screen.findByRole("heading", { level: 1, name: "News" })).toBeInTheDocument()
    expect(screen.getByText("2 of 500 records")).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 3, name: "Story a" })).toBeInTheDocument()
    // The source is the channel the record names, linked to the record's own link.
    expect(screen.getByRole("link", { name: /telegram/ })).toHaveAttribute("href", "https://www.example.com/stories/a")
    expect(screen.getByText("First line is the headline")).toBeInTheDocument()
    // The channel is shown as the source, so it is not a chip too: topic, a, b and "+1 more".
    expect(screen.queryByText("channel: telegram")).toBeNull()
    expect(screen.getByText("topic: tech")).toBeInTheDocument()
    expect(screen.getByText("+1 more")).toBeInTheDocument()
    expect(screen.getByText("Showing 1–2 of 2")).toBeInTheDocument()
    expect(screen.getByText("2 records")).toBeInTheDocument()
    expect(screen.getAllByText("of 2")).toHaveLength(2)
    expect(screen.getByText(en["collections.mediaExpiry"])).toBeInTheDocument()
    // A server before the usage release answers no counts: no tabs, no mark button, no delete, no select mode.
    expect(screen.queryByRole("tab")).toBeNull()
    expect(screen.queryByRole("button", { name: en["collections.markUsed"] })).toBeNull()
    expect(screen.queryByRole("button", { name: en["common.delete"] })).toBeNull()
    expect(screen.queryByRole("button", { name: en["collections.selectMultiple"] })).toBeNull()
    expect(api.listCollectionRecords).toHaveBeenCalledWith(COLL.id, FIRST_PAGE)
  })

  it("without a count from the server the pages turn one at a time and no totals are shown", async () => {
    api.listCollectionRecords.mockResolvedValue({ data: [record("a"), record("b")], nextCursor: "more" })
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story a" })
    expect(screen.queryByText(/Showing/)).toBeNull()
    expect(screen.queryByText("of 2")).toBeNull()
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: en["collections.nextPage"] })).toBeEnabled()
  })

  it("says which workflow and run saved a record — links to the workflow and to the run in its Executions tab, each in a new tab", async () => {
    api.listCollectionRecords.mockResolvedValue({ data: [record("a", { source: FROM_RUN })], nextCursor: null, total: 1 })
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story a" })
    const workflow = screen.getByRole("link", { name: /News pipeline/ })
    expect(workflow).toHaveAttribute("href", `/projects/${PROJECT}/workflows/${WF}`)
    expect(workflow).toHaveAttribute("target", "_blank")
    const run = screen.getByRole("link", { name: en["collections.openRun"] })
    expect(run).toHaveAttribute("href", `/projects/${PROJECT}/workflows/${WF}?tab=executions&execution=${RUN}`)
    expect(run).toHaveAttribute("target", "_blank")
  })

  it("the source is the one the record names, linked to the record's own link in a new tab; a video named among the fields shows its thumbnail", async () => {
    api.listCollectionRecords.mockResolvedValue({
      data: [
        record("a", { url: "https://t.me/TechNewsHeb/11486", fields: { primarySource: "The New Yorker / Condé Nast", sourceId: "TechNewsHeb/11486" } }),
        record("b", { url: null, fields: { mediaUrl: "https://cdn4.telesco.pe/file/clip.mp4?token=1", mediaKind: "video" } }),
      ],
      nextCursor: null,
      total: 2,
    })
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story a" })
    const source = screen.getByRole("link", { name: /The New Yorker \/ Condé Nast/ })
    expect(source).toHaveAttribute("href", "https://t.me/TechNewsHeb/11486")
    expect(source).toHaveAttribute("target", "_blank")
    const thumb = screen.getByRole("link", { name: en["collections.videoThumb"] })
    expect(thumb).toHaveAttribute("href", "https://cdn4.telesco.pe/file/clip.mp4?token=1")
    expect(thumb.querySelector("video")).toHaveAttribute("src", "https://cdn4.telesco.pe/file/clip.mp4?token=1")
  })

  it("tabs with counts tell used, not yet and the Trash apart; a record is marked used, or not used again, from its card", async () => {
    api.getCollection.mockResolvedValue(COLL_COUNTED)
    api.listCollectionRecords.mockResolvedValue({
      data: [record("a"), record("b", { usedAt: "2026-10-07T10:00:00Z", usedBy: { ...FROM_RUN, workflowName: "Publisher" } })],
      nextCursor: null,
      total: 2,
    })
    api.setCollectionRecordUsed.mockResolvedValue(record("a", { usedAt: "2026-10-08T10:00:00Z", usedBy: { via: "ui" } }))
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story a" })
    expect(screen.getByRole("tab", { name: "All 2" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Used 1" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: `${en["collections.tabUnused"]} 1` })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: `${en["collections.tabTrash"]} 0` })).toBeInTheDocument()
    const [first, second] = screen.getAllByRole("article")
    expect(within(first!).getByRole("button", { name: en["collections.markUsed"] })).toBeInTheDocument()
    expect(within(second!).getByText(en["collections.usedBadge"])).toBeInTheDocument()
    expect(within(second!).getByRole("link", { name: /by Publisher/ })).toHaveAttribute("href", `/projects/${PROJECT}/workflows/${WF}`)

    fireEvent.click(within(first!).getByRole("button", { name: en["collections.markUsed"] }))
    await waitFor(() => expect(api.setCollectionRecordUsed).toHaveBeenCalledWith(COLL.id, "a", true))
    fireEvent.click(within(second!).getByRole("button", { name: en["collections.undoUsed"] }))
    await waitFor(() => expect(api.setCollectionRecordUsed).toHaveBeenCalledWith(COLL.id, "b", false))

    pickTab(`${en["collections.tabUnused"]} 1`)
    await waitFor(() => expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ usage: "unused", status: "active", offset: 0 })))
    pickTab("Used 1")
    await waitFor(() => expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ usage: "used" })))
  })

  it("the Trash lists the records moved there, with Restore in place of Delete", async () => {
    api.getCollection.mockResolvedValue({ ...COLL_COUNTED, trashCount: 1 })
    api.listCollectionRecords.mockImplementation(async (_id: string, params: { status?: string }) =>
      params.status === "trash"
        ? { data: [record("z", { title: "Thrown away", deletedAt: "2026-10-08T20:00:00Z" })], nextCursor: null, total: 1 }
        : { data: [record("a")], nextCursor: null, total: 1 },
    )
    api.restoreCollectionRecord.mockResolvedValue(record("z"))
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story a" })
    pickTab(`${en["collections.tabTrash"]} 1`)
    const heading = await screen.findByRole("heading", { level: 3, name: "Thrown away" })
    const card = heading.closest("article")!
    expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ status: "trash", usage: "all" }))
    expect(within(card).queryByRole("button", { name: en["common.delete"] })).toBeNull()
    expect(within(card).queryByRole("button", { name: en["collections.markUsed"] })).toBeNull()
    expect(screen.getByText(en["collections.trashHint"])).toBeInTheDocument()
    fireEvent.click(within(card).getByRole("button", { name: en["collections.restore"] }))
    await waitFor(() => expect(api.restoreCollectionRecord).toHaveBeenCalledWith(COLL.id, "z"))

    // For good — only after its own confirmation.
    fireEvent.click(within(card).getByRole("button", { name: en["collections.deleteForever"] }))
    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText(en["collections.deleteForeverTitleOne"])).toBeInTheDocument()
    expect(within(confirm).getByText(/“Thrown away”/)).toBeInTheDocument()
    expect(api.deleteCollectionRecordForever).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: en["collections.deleteForever"] }))
    await waitFor(() => expect(api.deleteCollectionRecordForever).toHaveBeenCalledWith(COLL.id, "z"))
  })

  it("moves one record to the Trash only after the confirmation", async () => {
    api.getCollection.mockResolvedValue(COLL_COUNTED)
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story a" })
    const [first] = screen.getAllByRole("article")
    fireEvent.click(within(first!).getByRole("button", { name: en["common.delete"] }))
    expect(api.deleteCollectionRecord).not.toHaveBeenCalled()
    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText(en["collections.trashTitleOne"])).toBeInTheDocument()
    expect(within(confirm).getByText(/“Story a”/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole("button", { name: en["collections.moveToTrash"] }))
    await waitFor(() => expect(api.deleteCollectionRecord).toHaveBeenCalledWith(COLL.id, "a"))
  })

  it("select mode: checkboxes, select all on page, and a bulk move to the Trash after the confirmation", async () => {
    api.getCollection.mockResolvedValue(COLL_COUNTED)
    api.bulkCollectionRecords.mockResolvedValue({ updated: 2 })
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story a" })
    expect(screen.queryByRole("checkbox")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: en["collections.selectMultiple"] }))
    expect(screen.getAllByRole("checkbox")).toHaveLength(2)
    fireEvent.click(screen.getByRole("checkbox", { name: "Select record 1" }))
    expect(screen.getByText(en["collections.selectedCountOne"])).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: en["collections.selectAllPage"] }))
    expect(screen.getByText("2 selected")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Delete 2" }))
    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText("Move 2 records to Trash?")).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole("button", { name: en["collections.moveToTrash"] }))
    await waitFor(() => expect(api.bulkCollectionRecords).toHaveBeenCalledWith(COLL.id, { ids: ["a", "b"], action: "trash" }))
    // The selection is over once the records are gone.
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull())
  })

  it("turns pages: Next and a page number move the offset, a page size change starts over", async () => {
    api.listCollectionRecords.mockImplementation(async (_id: string, params: { offset?: number; limit?: number }) => ({
      data: Array.from({ length: Math.min(params.limit ?? 6, 14 - (params.offset ?? 0)) }, (_, i) => record(`r${(params.offset ?? 0) + i + 1}`)),
      nextCursor: null,
      total: 14,
    }))
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story r1" })
    expect(screen.getByText("Showing 1–6 of 14")).toBeInTheDocument()
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: en["collections.nextPage"] }))
    await waitFor(() => expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ offset: 6, limit: 6 })))
    await screen.findByText("Showing 7–12 of 14")
    // The cards keep counting from the page's offset, never from 1 again (the number column sits beside the card, in its row).
    const seventh = (await screen.findByRole("heading", { level: 3, name: "Story r7" })).closest("article")!.parentElement!
    expect(within(seventh).getByText("7")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }))
    await waitFor(() => expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ offset: 12, limit: 6 })))
    await screen.findByText("Showing 13–14 of 14")
    const thirteenth = screen.getByRole("heading", { level: 3, name: "Story r13" }).closest("article")!.parentElement!
    expect(within(thirteenth).getByText("13")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: en["collections.nextPage"] })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "12" }))
    await waitFor(() => expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ offset: 0, limit: 12 })))
  })

  it("a page picked right after opening stays picked — only a changed search starts the list over", async () => {
    api.listCollectionRecords.mockImplementation(async (_id: string, params: { offset?: number; limit?: number }) => ({
      data: Array.from({ length: Math.min(params.limit ?? 6, 14 - (params.offset ?? 0)) }, (_, i) => record(`r${(params.offset ?? 0) + i + 1}`)),
      nextCursor: null,
      total: 14,
    }))
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story r1" })
    fireEvent.click(screen.getByRole("button", { name: en["collections.nextPage"] }))
    await screen.findByText("Showing 7–12 of 14")
    // Longer than the search box's delay: a reset that fired on opening would land in here.
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(screen.getByText("Showing 7–12 of 14")).toBeInTheDocument()
    expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ offset: 6 }))
    fireEvent.change(screen.getByPlaceholderText(en["collections.searchPlaceholder"]), { target: { value: "story" } })
    await waitFor(() => expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ q: "story", offset: 0 })))
  })

  it("narrows the list to the days picked (the 'to' day included), offers the last 7 days, flips the order, and clears the days", async () => {
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story a" })
    fireEvent.change(screen.getByLabelText(en["collections.dateFrom"]), { target: { value: "2026-10-06" } })
    fireEvent.change(screen.getByLabelText(en["collections.dateTo"]), { target: { value: "2026-10-06" } })
    await waitFor(() =>
      expect(api.listCollectionRecords).toHaveBeenLastCalledWith(
        COLL.id,
        expect.objectContaining({ since: localDayStartIso("2026-10-06"), until: localDayStartIso("2026-10-06", 1) }),
      ),
    )
    const today = localDayOf(new Date().toISOString())
    fireEvent.click(screen.getByRole("button", { name: en["collections.date7"] }))
    await waitFor(() =>
      expect(api.listCollectionRecords).toHaveBeenLastCalledWith(
        COLL.id,
        expect.objectContaining({ since: localDayStartIso(today, -6), until: localDayStartIso(today, 1) }),
      ),
    )
    fireEvent.keyDown(screen.getByRole("combobox", { name: en["collcfg.order"] }), { key: "Enter" })
    fireEvent.keyDown(await screen.findByRole("option", { name: en["collections.sortOldest"] }), { key: "Enter" })
    await waitFor(() => expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ order: "oldest" })))
    fireEvent.click(screen.getByRole("button", { name: en["collections.dateAll"] }))
    await waitFor(() =>
      expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ order: "oldest", since: undefined, until: undefined })),
    )
  })

  it("searches the records with the typed words", async () => {
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story a" })
    fireEvent.change(screen.getByPlaceholderText(en["collections.searchPlaceholder"]), { target: { value: " telegram " } })
    await waitFor(() => expect(api.listCollectionRecords).toHaveBeenLastCalledWith(COLL.id, expect.objectContaining({ q: "telegram", offset: 0 })))
  })

  it("exports the collection as the format picked and hands the browser the server's file", async () => {
    api.exportCollection.mockResolvedValue({ blob: new Blob(["id\n"], { type: "text/csv" }), filename: "news-2026-10-06.csv" })
    const createObjectURL = vi.fn(() => "blob:news")
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    renderPage()
    await screen.findByRole("heading", { level: 3, name: "Story a" })
    fireEvent.keyDown(screen.getByRole("button", { name: en["collections.export"] }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: en["collections.exportCsv"] }))
    await waitFor(() => expect(api.exportCollection).toHaveBeenCalledWith(COLL.id, "csv"))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:news")
    click.mockRestore()
  })

  it("says when the collection is still empty", async () => {
    api.listCollectionRecords.mockResolvedValue({ data: [], nextCursor: null, total: 0 })
    renderPage()
    expect(await screen.findByText(en["collections.noRecords"])).toBeInTheDocument()
  })

  it("says when the Trash is empty", async () => {
    api.getCollection.mockResolvedValue({ ...COLL_COUNTED, trashCount: 0 })
    api.listCollectionRecords.mockResolvedValue({ data: [], nextCursor: null, total: 0 })
    renderPage()
    await screen.findByText(en["collections.noRecords"])
    pickTab(`${en["collections.tabTrash"]} 0`)
    expect(await screen.findByText(en["collections.noTrash"])).toBeInTheDocument()
  })
})
