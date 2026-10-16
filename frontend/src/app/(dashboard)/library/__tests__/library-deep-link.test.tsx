/**
 * A link to one item of My Files: `?job=<jobId>` (the file a job made) or
 * `?asset=<assetId>` (the file itself), as a client app sends its user to the
 * result it just made. Found: the card is scrolled to and marked, and its
 * preview opens. Not found (no such job, not this person's, still being made):
 * a toast, and the page renders as usual. Either way the parameter is removed
 * from the address, so a refresh or Back does not run it again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import type { LibraryAsset } from "@/lib/api"
import { en } from "@/lib/i18n/en"

const api = vi.hoisted(() => ({
  getLibraryAssets: vi.fn(),
  getJobStatus: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
const scrollToRow = vi.hoisted(() => vi.fn())

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast }))
vi.mock("@/ee/hooks/queries/use-billing-queries", () => ({
  useStorageProfile: () => ({ data: undefined }),
}))
// Real DOM rows without layout: every item in rows of 3, and the scroll call
// recorded.
vi.mock("@/hooks/use-virtual-grid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-virtual-grid")>()
  return {
    ...actual,
    useVirtualGrid: ({ itemCount }: { itemCount: number }) => ({
      gridRef: () => {},
      virtualRows: Array.from({ length: Math.ceil(itemCount / 3) }, (_, i) => ({
        key: i,
        index: i,
        start: i * 224,
        size: 224,
        end: (i + 1) * 224,
        lane: 0,
      })),
      totalSize: Math.ceil(itemCount / 3) * 224,
      columns: 3,
      scrollMargin: 0,
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      scrollToRow,
    }),
  }
})

import LibraryPage from "../page"
import { LibraryRedirect } from "../library-redirect"
import { DEEP_LINK_MAX_PAGES } from "../library-deep-link"

const JOB_ID = "11111111-1111-4111-8111-111111111111"
const ASSET_ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function asset(n: number, overrides: Partial<LibraryAsset> = {}): LibraryAsset {
  return {
    id: ASSET_ID(n),
    type: "image",
    filename: `file-${n}.png`,
    mimeType: "image/png",
    sizeBytes: 1000,
    url: `https://media.example.com/generated/file-${n}.png`,
    thumbnailUrl: null,
    metadata: {},
    isLibraryItem: false,
    uploadSource: "generated",
    createdAt: "2026-10-01T12:00:00Z",
    ...overrides,
  }
}

function page(items: LibraryAsset[], nextCursor: string | null = null) {
  return { data: items, nextCursor, totalCount: items.length }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderAt(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/library" element={<LibraryRedirect />} />
          <Route
            path="/my-files"
            element={
              <>
                <LibraryPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function cardOf(filename: string): HTMLElement {
  const label = screen.getByTitle(filename)
  const card = label.closest("[data-asset-card]")
  if (!(card instanceof HTMLElement)) throw new Error(`no card for ${filename}`)
  return card
}

function previewImage(): HTMLImageElement | null {
  const dialog = screen.queryByRole("dialog")
  return dialog?.querySelector("img") ?? null
}

beforeEach(() => {
  api.getLibraryAssets.mockReset().mockResolvedValue(page([asset(1), asset(2), asset(3), asset(4), asset(5)]))
  api.getJobStatus.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
  toast.info.mockReset()
  scrollToRow.mockReset()
})

// A test that ends with the preview open unmounts it here, and the preview's
// back-to-close cleanup calls `history.back()`. jsdom runs that traversal on
// two queued timers (the traversal task, then the popstate dispatch); left
// pending, they fire after the file's window is torn down and the dispatch
// throws an unhandled "parameter 1 is not of type 'Event'". Unmount, then let
// both timers run while the window is still alive.
afterEach(async () => {
  cleanup()
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
})

describe("My Files deep link — ?job=", () => {
  it("marks the job's file, scrolls to it and opens its preview", async () => {
    api.getJobStatus.mockResolvedValue({
      id: JOB_ID,
      status: "completed",
      output_data: { imageUrl: asset(5).url },
    })
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(previewImage()?.getAttribute("src")).toContain("file-5.png"))
    expect(cardOf("file-5.png").getAttribute("aria-current")).toBe("true")
    expect(cardOf("file-1.png").getAttribute("aria-current")).toBeNull()
    // Item 5 is index 4: row 1 at 3 columns.
    expect(scrollToRow).toHaveBeenCalledWith(1)
    expect(api.getJobStatus).toHaveBeenCalledWith(JOB_ID)
    expect(toast.error).not.toHaveBeenCalled()
    // Marking is not selecting: nothing is armed for a bulk delete.
    expect(screen.queryByText(en["lib.deleteSelected"].replace("{n}", "1"))).toBeNull()
  })

  it("finds a video job's file by its video", async () => {
    // jsdom has no media playback; the preview autoplays a video.
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
    api.getLibraryAssets.mockResolvedValue(
      page([asset(1), asset(2, { type: "video", url: "https://media.example.com/v/clip.mp4", filename: "clip.mp4" })]),
    )
    api.getJobStatus.mockResolvedValue({
      id: JOB_ID,
      status: "completed",
      output_data: { videoUrl: "https://media.example.com/v/clip.mp4" },
    })
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(cardOf("clip.mp4").getAttribute("aria-current")).toBe("true"))
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("a job that is still being made says so, and the page renders as usual", async () => {
    api.getJobStatus.mockResolvedValue({ id: JOB_ID, status: "processing", output_data: {} })
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(en["lib.deepLinkProcessing"]))
    expect(screen.getByTitle("file-1.png")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByTestId("location").textContent).toBe("/my-files")
  })

  it("a job that made no file says so", async () => {
    api.getJobStatus.mockResolvedValue({ id: JOB_ID, status: "failed", output_data: {} })
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en["lib.deepLinkNoResult"]))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("a job that is not found (or not this person's) shows a toast, and the page is intact", async () => {
    api.getJobStatus.mockRejectedValue(Object.assign(new Error("Job not found"), { status: 404 }))
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en["lib.deepLinkNotFound"]))
    expect(screen.getByTitle("file-3.png")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByTestId("location").textContent).toBe("/my-files")
  })

  it.each([
    ["a server error", Object.assign(new Error("Internal server error"), { status: 503 })],
    ["a network failure", new TypeError("Failed to fetch")],
  ])("%s is not reported as not found", async (_label, err) => {
    api.getJobStatus.mockRejectedValue(err)
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en["lib.deepLinkFailed"]))
    expect(toast.error).not.toHaveBeenCalledWith(en["lib.deepLinkNotFound"])
    expect(screen.getByTitle("file-1.png")).toBeTruthy()
  })

  it("a completed job with no media says it made no file", async () => {
    api.getJobStatus.mockResolvedValue({ id: JOB_ID, status: "completed", output_data: { text: "hello" } })
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en["lib.deepLinkNoResult"]))
    expect(api.getLibraryAssets).toHaveBeenCalledTimes(1)
  })

  it("matches by the row's jobId first, even when the address differs", async () => {
    api.getLibraryAssets.mockResolvedValue(
      page([asset(1), asset(2, { jobId: JOB_ID, url: "https://media.example.com/copied/elsewhere.png" })]),
    )
    api.getJobStatus.mockResolvedValue({
      id: JOB_ID,
      status: "completed",
      output_data: { imageUrl: "https://media.example.com/original.png" },
    })
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(cardOf("file-2.png").getAttribute("aria-current")).toBe("true"))
  })

  it("a row made by another job is not matched by its address", async () => {
    const other = "22222222-2222-4222-8222-222222222222"
    api.getLibraryAssets.mockResolvedValue(page([asset(1, { jobId: other })]))
    api.getJobStatus.mockResolvedValue({
      id: JOB_ID,
      status: "completed",
      output_data: { imageUrl: asset(1).url },
    })
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en["lib.deepLinkNotFound"]))
    expect(cardOf("file-1.png").getAttribute("aria-current")).toBeNull()
  })

  it("a completed job whose file is not in My Files shows the not-found toast", async () => {
    api.getJobStatus.mockResolvedValue({
      id: JOB_ID,
      status: "completed",
      output_data: { imageUrl: "https://media.example.com/elsewhere.png" },
    })
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en["lib.deepLinkNotFound"]))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("an id that is not a job id is not looked up", async () => {
    renderAt("/my-files?job=not-an-id")

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en["lib.deepLinkNotFound"]))
    expect(api.getJobStatus).not.toHaveBeenCalled()
    expect(screen.getByTestId("location").textContent).toBe("/my-files")
  })
})

describe("My Files deep link — ?asset=", () => {
  it("marks the file and opens its preview", async () => {
    renderAt(`/my-files?asset=${ASSET_ID(2)}`)

    await waitFor(() => expect(previewImage()?.getAttribute("src")).toContain("file-2.png"))
    expect(cardOf("file-2.png").getAttribute("aria-current")).toBe("true")
    expect(scrollToRow).toHaveBeenCalledWith(0)
    expect(api.getJobStatus).not.toHaveBeenCalled()
  })

  it("pages forward until the file is loaded", async () => {
    api.getLibraryAssets.mockImplementation(async ({ cursor }: { cursor?: string }) =>
      cursor ? page([asset(4), asset(5)]) : page([asset(1), asset(2), asset(3)], ASSET_ID(3)),
    )
    renderAt(`/my-files?asset=${ASSET_ID(5)}`)

    await waitFor(() => expect(cardOf("file-5.png").getAttribute("aria-current")).toBe("true"))
    expect(api.getLibraryAssets).toHaveBeenCalledTimes(2)
    expect(previewImage()?.getAttribute("src")).toContain("file-5.png")
  })

  it("a file that is not in My Files shows a toast, and the page is intact", async () => {
    renderAt(`/my-files?asset=${ASSET_ID(99)}`)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en["lib.deepLinkNotFound"]))
    expect(screen.getByTitle("file-1.png")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it(`stops looking after ${DEEP_LINK_MAX_PAGES} pages`, async () => {
    let n = 0
    api.getLibraryAssets.mockImplementation(async () => {
      n += 1
      return page([asset(1000 + n)], ASSET_ID(1000 + n))
    })
    renderAt(`/my-files?asset=${ASSET_ID(99)}`)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en["lib.deepLinkNotFound"]), { timeout: 5000 })
    expect(api.getLibraryAssets).toHaveBeenCalledTimes(DEEP_LINK_MAX_PAGES)
  })
})

describe("My Files deep link — while looking", () => {
  it("says it is looking, and changing the filter cancels the search", async () => {
    let resolveJob: (job: unknown) => void = () => {}
    api.getJobStatus.mockReturnValue(new Promise((r) => { resolveJob = r }))
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain(en["lib.deepLinkLooking"]))
    fireEvent.click(screen.getByRole("button", { name: en["lib.filterImage"] }))
    await waitFor(() => expect(screen.queryByText(en["lib.deepLinkLooking"])).toBeNull())

    resolveJob({ id: JOB_ID, status: "completed", output_data: { imageUrl: asset(1).url } })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe("My Files deep link — consumed once", () => {
  it("removes the parameter and keeps the others", async () => {
    renderAt(`/my-files?asset=${ASSET_ID(1)}&ref=app`)

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy())
    expect(screen.getByTestId("location").textContent).toBe("/my-files?ref=app")
  })

  it("closing the preview does not open it again", async () => {
    api.getJobStatus.mockResolvedValue({
      id: JOB_ID,
      status: "completed",
      output_data: { imageUrl: asset(1).url },
    })
    renderAt(`/my-files?job=${JOB_ID}`)

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy())
    fireEvent.click(screen.getByLabelText(en["templates.closePreview"]))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // A later page load (the list refetching) does not re-run the link.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(api.getJobStatus).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("location").textContent).toBe("/my-files")
  })
})

describe("/library", () => {
  it("opens My Files with the link's parameters", async () => {
    renderAt(`/library?asset=${ASSET_ID(3)}`)

    await waitFor(() => expect(cardOf("file-3.png").getAttribute("aria-current")).toBe("true"))
    expect(screen.getByTestId("location").textContent).toBe("/my-files")
  })

  it("without parameters is My Files", async () => {
    renderAt("/library")

    await waitFor(() => expect(screen.getByTitle("file-1.png")).toBeTruthy())
    expect(screen.getByTestId("location").textContent).toBe("/my-files")
    expect(toast.error).not.toHaveBeenCalled()
  })
})
