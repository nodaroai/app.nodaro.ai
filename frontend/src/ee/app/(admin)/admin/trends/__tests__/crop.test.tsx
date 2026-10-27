/**
 * Admin → Trends → one trend → cropping the source clip to 16:9 or 9:16.
 *
 * - Only the crop that trims is offered: a clip wider than 16:9 gets "Crop to
 *   16:9", one taller than 9:16 "Crop to 9:16", one at 16:9 nothing. The
 *   shape is the clip as shown (its display copy).
 * - The position slider says how many pixels go from each side (centered by
 *   default) and starting sends it with the aspect and the held revision.
 * - The crop runs on the server: the panel says so and reads the trend until
 *   the record is gone (the cropped clip is in the draft) or carries an error
 *   (shown, with Dismiss and Crop again).
 * - It waits while the form has unsaved edits, and warns that the face mask
 *   must be made again.
 * - The preview plays and scrubs to any moment, the crop drawn over it, so the
 *   kept frame is checked across the whole clip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { toast } from "sonner"
import type { AdminTrendData, AdminTrendPendingSourceCrop } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"

const BASE = `/v1/admin/trends/${TREND_ID}`
const SRC = "https://cdn.test/trends/a1/src.mp4"
const display = (width: number, height: number) => ({ videoUrl: "https://cdn.test/trends/a1/display.mp4", posterUrl: "https://cdn.test/trends/a1/display.png", width, height, durationSec: 12 })
const wide = (): Partial<AdminTrendData> => ({ source: { videoUrl: SRC, durationSec: 12, width: 2568, height: 1080, display: display(2568, 1080) } })

let server: { data: Partial<AdminTrendData>; revision: string; sourceCrop: AdminTrendPendingSourceCrop | null }

function serve(data: Partial<AdminTrendData>) {
  server = { data, revision: "rev-1", sourceCrop: null }
  routes[`GET ${BASE}`] = () => ({ body: { data: detail({ revision: server.revision, sourceCrop: server.sourceCrop }, server.data) } })
}

const running = (over: Partial<AdminTrendPendingSourceCrop> = {}): AdminTrendPendingSourceCrop => ({
  aspect: "16:9", position: 0.5, fromUrl: SRC, startedAt: new Date().toISOString(), current: true, running: true, stale: false, ...over,
})

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

beforeEach(() => {
  vi.mocked(toast.warning).mockClear()
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
})
afterEach(() => vi.unstubAllGlobals())

describe("which crop a source clip is offered", () => {
  it("16:9 for a clip wider than 16:9, 9:16 for one taller than 9:16 (as shown), nothing at 16:9", async () => {
    serve(wide())
    const { unmount } = renderEditor()
    const panel = await screen.findByRole("group", { name: "Crop the source clip" })
    expect(within(panel).getByRole("button", { name: "Crop to 16:9" })).toBeInTheDocument()
    unmount()

    // Stored landscape, shown portrait: judged as shown.
    serve({ source: { videoUrl: SRC, durationSec: 12, width: 2568, height: 1080, display: display(1080, 2568) } })
    const second = renderEditor()
    expect(await within(await screen.findByRole("group", { name: "Crop the source clip" })).findByRole("button", { name: "Crop to 9:16" })).toBeInTheDocument()
    second.unmount()

    serve({ source: { videoUrl: SRC, durationSec: 12, width: 1920, height: 1080, display: display(1920, 1080) } })
    renderEditor()
    await waitFor(() => expect(screen.getByText(/1\. Source clip/)).toBeInTheDocument())
    expect(screen.queryByRole("group", { name: "Crop the source clip" })).not.toBeInTheDocument()
  })
})

describe("checking the crop across the clip", () => {
  it("scrubs the preview to any moment (pausing it) and plays it, the readout following", async () => {
    serve(wide())
    renderEditor()
    const panel = await screen.findByRole("group", { name: "Crop the source clip" })
    const video = within(panel).getByLabelText("The source clip") as HTMLVideoElement
    const scrub = within(panel).getByRole("slider", { name: "Moment in the source clip" })
    expect(scrub).toBeDisabled()

    Object.defineProperty(video, "duration", { configurable: true, value: 12 })
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {})
    fireEvent.loadedMetadata(video)
    expect(scrub).toBeEnabled()
    expect(within(panel).getByTestId("crop-time")).toHaveTextContent("0:00.0 / 0:12.0")

    fireEvent.change(scrub, { target: { value: "7.5" } })
    expect(video.currentTime).toBe(7.5)
    expect(pause).toHaveBeenCalled()
    expect(within(panel).getByTestId("crop-time")).toHaveTextContent("0:07.5 / 0:12.0")

    const play = vi.spyOn(video, "play").mockResolvedValue(undefined)
    fireEvent.click(within(panel).getByRole("button", { name: "Play" }))
    expect(play).toHaveBeenCalled()
    fireEvent.play(video)
    expect(within(panel).getByRole("button", { name: "Pause" })).toBeInTheDocument()
  })
})

describe("cropping", { timeout: 20_000 }, () => {
  it("shows the split (centered by default), sends the position, runs on the server and takes the cropped clip when done", async () => {
    const user = userEvent.setup()
    serve({ ...wide(), faceMask: undefined })
    routes[`POST ${BASE}/crop`] = () => {
      server.revision = "rev-2"
      server.sourceCrop = running({ position: 0.2 })
      return { status: 202, body: { data: { version: 1, revision: "rev-2", sourceCrop: server.sourceCrop } } }
    }
    renderEditor()
    const panel = await screen.findByRole("group", { name: "Crop the source clip" })
    expect(within(panel).getByTestId("crop-split")).toHaveTextContent("Cuts 324 px from the left (50 %) and 324 px from the right (50 %)")

    // The slider: ArrowLeft ×30 from 50 → 20.
    const thumb = within(panel).getByRole("slider", { name: /where the kept frame sits/i })
    thumb.focus()
    for (let i = 0; i < 30; i++) fireEvent.keyDown(thumb, { key: "ArrowLeft" })
    await waitFor(() => expect(within(panel).getByTestId("crop-split")).toHaveTextContent("Cuts 128 px from the left (20 %) and 520 px from the right (80 %)"))

    await user.click(within(panel).getByRole("button", { name: "Crop to 16:9" }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/crop`)).toEqual([{ aspect: "16:9", position: 0.2, revision: "rev-1" }]))
    expect(await within(panel).findByTestId("crop-running")).toHaveTextContent("Cropping the source clip to 16:9")
    expect(within(panel).getByRole("button", { name: "Crop to 16:9" })).toBeDisabled()

    // The background finishes: the next read (the poll) has the cropped clip and no record.
    server.revision = "rev-3"
    server.sourceCrop = null
    server.data = { source: { videoUrl: "https://cdn.test/trends/a1/cropped.mp4", durationSec: 12, width: 1920, height: 1080, display: display(1920, 1080) } }
    await waitFor(() => expect(screen.queryByRole("group", { name: "Crop the source clip" })).not.toBeInTheDocument(), { timeout: 5_000 })
  })

  it("says so when the crop cleared the face mask's marks, as a save does", async () => {
    const user = userEvent.setup()
    const masking = { mode: "always" as const }
    const mark = { label: "erased" as const, fromFrame: 10, toFrame: 99, leftPct: 60, topPct: 10, rightPct: 90, bottomPct: 50 }
    serve({ ...wide(), faceMasking: { ...masking, marks: [mark] } })
    routes[`POST ${BASE}/crop`] = () => {
      server.revision = "rev-2"
      server.sourceCrop = running()
      return { status: 202, body: { data: { version: 1, revision: "rev-2", sourceCrop: server.sourceCrop } } }
    }
    renderEditor()
    const panel = await screen.findByRole("group", { name: "Crop the source clip" })
    await user.click(within(panel).getByRole("button", { name: "Crop to 16:9" }))
    expect(await within(panel).findByTestId("crop-running")).toBeInTheDocument()
    expect(screen.queryByText(/erase marks were cleared/i)).not.toBeInTheDocument()

    server.revision = "rev-3"
    server.sourceCrop = null
    server.data = { source: { videoUrl: "https://cdn.test/trends/a1/cropped.mp4", durationSec: 12, width: 1920, height: 1080, display: display(1920, 1080) }, faceMasking: masking }
    expect(await screen.findByText(/erase marks were cleared because the source clip changed/i, {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(toast.warning).toHaveBeenCalledWith("Erase marks were cleared because the source clip changed")
  })

  it("says nothing about marks when there were none", async () => {
    const user = userEvent.setup()
    serve({ ...wide(), faceMasking: { mode: "always" } })
    routes[`POST ${BASE}/crop`] = () => {
      server.revision = "rev-2"
      server.sourceCrop = running()
      return { status: 202, body: { data: { version: 1, revision: "rev-2", sourceCrop: server.sourceCrop } } }
    }
    renderEditor()
    const panel = await screen.findByRole("group", { name: "Crop the source clip" })
    await user.click(within(panel).getByRole("button", { name: "Crop to 16:9" }))
    expect(await within(panel).findByTestId("crop-running")).toBeInTheDocument()
    server.revision = "rev-3"
    server.sourceCrop = null
    server.data = { source: { videoUrl: "https://cdn.test/trends/a1/cropped.mp4", durationSec: 12, width: 1920, height: 1080, display: display(1920, 1080) }, faceMasking: { mode: "always" } }
    await waitFor(() => expect(screen.queryByRole("group", { name: "Crop the source clip" })).not.toBeInTheDocument(), { timeout: 5_000 })
    expect(screen.queryByText(/erase marks were cleared/i)).not.toBeInTheDocument()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it("a failure is shown with Dismiss (sent with the held revision) and Crop again", async () => {
    const user = userEvent.setup()
    serve(wide())
    server.sourceCrop = running({ running: false, error: { code: "media_unreadable", message: "Could not crop the source clip to 16:9." } })
    routes[`DELETE ${BASE}/crop?revision=rev-1`] = () => {
      server.revision = "rev-2"
      server.sourceCrop = null
      return { body: { data: { version: 1, revision: "rev-2", sourceCrop: null } } }
    }
    renderEditor()
    const panel = await screen.findByRole("group", { name: "Crop the source clip" })
    expect(within(panel).getByText(/couldn't crop the source clip: could not crop/i)).toBeInTheDocument()
    expect(within(panel).getByRole("button", { name: "Crop to 16:9 again" })).toBeEnabled()
    await user.click(within(panel).getByRole("button", { name: /dismiss/i }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, init]) => init?.method === "DELETE" && u === `${BASE}/crop?revision=rev-1`)).toBe(true))
    await waitFor(() => expect(within(panel).queryByText(/couldn't crop/i)).not.toBeInTheDocument())
  })

  it("waits while the form has unsaved edits, and warns about a stored face mask", async () => {
    const user = userEvent.setup()
    serve({
      ...wide(),
      faceMask: {
        url: "https://cdn.test/trends/a1/mask.mp4", frames: 288, recipe: { core: "2026-10-25", plugin: "1" }, settingsKey: "v2:abc",
        jobId: "00000000-0000-4000-8000-0000000000f1", stats: { shots: 1, heldFrames: 0, coverage: 0.02, droppedRegions: 0 },
        approvedAt: "2026-10-25T08:00:00.000Z", approvedBy: "admin",
      },
    })
    renderEditor()
    const panel = await screen.findByRole("group", { name: "Crop the source clip" })
    expect(within(panel).getByTestId("crop-warning")).toHaveTextContent("The face mask will need to be made again.")
    await user.type(screen.getByLabelText("Trend prompt"), "!")
    expect(within(panel).getByRole("button", { name: "Crop to 16:9" })).toBeDisabled()
    expect(within(panel).getByText(/save first/i)).toBeInTheDocument()
  })
})
