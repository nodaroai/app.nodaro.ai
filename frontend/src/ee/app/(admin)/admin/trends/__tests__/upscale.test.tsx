/**
 * Admin → Trends → one trend → upscaling the source clip and the examples to 1080p.
 *
 * - Each example below 1080p, and the saved source clip, offer "Upscale to
 *   1080p"; a video already 1080p (by its short side) offers nothing.
 * - Starting sends the target, the held revision and a per-click
 *   Idempotency-Key; the job is followed, the before and after play side by
 *   side, and "Use it" sends the job with the revision start returned. "Use
 *   it" runs on the server: the panel says so, the trend is read until the
 *   record is gone (applied) or carries an error (shown, with a retry).
 *   "Discard" drops it.
 * - Using it on the source says first that the face mask must be made again,
 *   and the screen then takes the server's draft: the next save carries the
 *   1080p clip, never the 720p one it replaced.
 * - The source's upscale waits while the form has unsaved edits.
 * - An upscale whose example is gone can only be discarded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import type { AdminTrendData, AdminTrendExample, AdminTrendFaceMask, AdminTrendPendingUpscale } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"
import { needsUpscale } from "../model"

const BASE = `/v1/admin/trends/${TREND_ID}`
const JOB = "00000000-0000-4000-8000-0000000000d1"
const SRC = "https://cdn.test/trends/a1/src.mp4"
const UPSCALED = "https://cdn.test/jobs/up/upscaled.mp4"

const example = (n: number, over: Partial<AdminTrendExample> = {}): AdminTrendExample => ({
  videoUrl: `https://cdn.test/trends/a1/ex${n}.mp4`,
  posterUrl: `https://cdn.test/trends/a1/ex${n}.png`,
  width: 720,
  height: 1280,
  durationSec: 10,
  slots: { dancer: [`https://cdn.test/trends/a1/ex${n}-dancer.png`] },
  sourceJobId: `00000000-0000-4000-8000-0000000000b${n}`,
  ...over,
})

const MASK: AdminTrendFaceMask = {
  url: "https://cdn.test/trends/a1/mask.mp4",
  frames: 288,
  recipe: { core: "2026-10-25", plugin: "1" },
  settingsKey: "v2:abc",
  jobId: "00000000-0000-4000-8000-0000000000f1",
  stats: { shots: 1, heldFrames: 0, coverage: 0.02, droppedRegions: 0 },
  approvedAt: "2026-10-25T08:00:00.000Z",
  approvedBy: "admin",
}

/** What the server holds: GET answers it, the write routes move it. */
let server: { data: Partial<AdminTrendData>; revision: string; upscaleJobs: AdminTrendPendingUpscale[] }

function serve(data: Partial<AdminTrendData>) {
  server = { data, revision: "rev-1", upscaleJobs: [] }
  routes[`GET ${BASE}`] = () => ({ body: { data: detail({ revision: server.revision, upscaleJobs: server.upscaleJobs }, server.data) } })
}

function job(over: Record<string, unknown> = {}) {
  return { body: { data: { id: JOB, status: "completed", progress: 100, output_data: { videoUrl: UPSCALED }, ...over } } }
}

/** Start answers with the job, recorded on the draft at rev-2. */
function startable(target: "source" | "example", fromUrl: string, index?: number) {
  routes[`POST ${BASE}/upscale`] = () => {
    server.revision = "rev-2"
    server.upscaleJobs = [{ jobId: JOB, target, fromUrl, startedAt: "2026-10-25T09:00:00.000Z", current: true, ...(index !== undefined ? { index } : {}) }]
    return { status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-2", recorded: true, draftMoved: false } } }
  }
  routes[`GET /v1/jobs/${JOB}`] = () => job()
}

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
})
afterEach(() => vi.unstubAllGlobals())

describe("needsUpscale", () => {
  it("offers an upscale below a 1080 short side only (an unknown size is offered one)", () => {
    expect(needsUpscale(720, 1280)).toBe(true)
    expect(needsUpscale(1280, 720)).toBe(true)
    expect(needsUpscale(1080, 1920)).toBe(false)
    expect(needsUpscale(1920, 1080)).toBe(false)
    expect(needsUpscale(undefined, undefined)).toBe(true)
  })
})

describe("upscaling an example", { timeout: 20_000 }, () => {
  it("is offered on a 720p example only; start, follow, before/after, Use it with the revision start returned", async () => {
    const user = userEvent.setup()
    serve({ examples: [example(1), example(2, { width: 1080, height: 1920 })] })
    startable("example", example(1).videoUrl, 0)
    routes[`POST ${BASE}/upscale/apply`] = () => {
      // Marked applying (rev-3); the background then finishes quickly (rev-4) before the trend is read.
      server.revision = "rev-4"
      server.upscaleJobs = []
      server.data = { ...server.data, examples: [example(1, { videoUrl: "https://cdn.test/trends/a1/up.mp4", width: 1080, height: 1920 }), example(2, { width: 1080, height: 1920 })] }
      return { status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-3", applying: true, upscaleJobs: [] } } }
    }
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-5" } } })
    renderEditor()

    const first = await screen.findByRole("group", { name: "Upscale example 1" })
    expect(screen.queryByRole("group", { name: "Upscale example 2" })).not.toBeInTheDocument()
    await user.click(within(first).getByRole("button", { name: /upscale to 1080p/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/upscale`)).toEqual([{ target: "example", index: 0, revision: "rev-1" }]))
    // One Idempotency-Key per click.
    const keyOf = (i: number) =>
      new Headers(fetchMock.mock.calls.filter(([u, init]) => init?.method === "POST" && u === `${BASE}/upscale`)[i]![1]!.headers as HeadersInit).get("Idempotency-Key")
    expect(keyOf(0)).toMatch(/^[0-9a-f-]{20,}$/)

    expect(await screen.findByLabelText("After: example 1 upscaled")).toHaveAttribute("src", UPSCALED)
    expect(screen.getByLabelText("Before: example 1")).toHaveAttribute("src", example(1).videoUrl)
    await user.click(screen.getByRole("button", { name: /use it/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/upscale/apply`)).toEqual([{ jobId: JOB, revision: "rev-2" }]))
    // The card now shows the 1080p video, and offers no further upscale.
    await waitFor(() => expect(screen.getAllByText(/1080×1920 · 10\.0 s/)).toHaveLength(2))
    await waitFor(() => expect(screen.queryByRole("group", { name: "Upscale example 1" })).not.toBeInTheDocument())

    // The next draft write carries the revision the server holds now.
    await user.type(screen.getByLabelText("Trend prompt"), "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    expect((sentTo(`PUT ${BASE}/draft`)[0] as { revision: string }).revision).toBe("rev-4")
  })

  it("while Use it runs on the server it says so and reads the trend until it is done; an error is shown with a retry", async () => {
    const user = userEvent.setup()
    serve({ examples: [example(1)] })
    server.upscaleJobs = [{ jobId: JOB, target: "example", fromUrl: example(1).videoUrl, startedAt: "2026-10-25T09:00:00.000Z", current: true, index: 0 }]
    routes[`GET /v1/jobs/${JOB}`] = () => job()
    const applying = { startedAt: new Date().toISOString(), stale: false }
    routes[`POST ${BASE}/upscale/apply`] = () => {
      server.revision = "rev-2"
      server.upscaleJobs = [{ ...server.upscaleJobs[0]!, applying }]
      return { status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-2", applying: true, upscaleJobs: server.upscaleJobs } } }
    }
    renderEditor()
    const card = await screen.findByRole("group", { name: "Upscale example 1" })
    await user.click(await within(card).findByRole("button", { name: /^use it$/i }))
    expect(await within(card).findByTestId("upscale-applying")).toHaveTextContent("Putting the 1080p video in the draft")
    expect(within(card).getByRole("button", { name: /use it/i })).toBeDisabled()

    // The background failed: the next read (the poll) carries the error.
    const reads = () => fetchMock.mock.calls.filter(([u, init]) => (init?.method ?? "GET") === "GET" && u === BASE).length
    const before = reads()
    server.revision = "rev-3"
    server.upscaleJobs = [{ ...server.upscaleJobs[0]!, applying: undefined, error: { code: "media_unreadable", message: "Could not resize the upscaled video to 1080p." } }]
    expect(await within(card).findByText(/couldn't use the upscale: could not resize/i, {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(reads()).toBeGreaterThan(before)
    expect(within(card).queryByTestId("upscale-applying")).not.toBeInTheDocument()

    // Tried again: this time the server finishes before the trend is read again.
    routes[`POST ${BASE}/upscale/apply`] = () => {
      server.revision = "rev-5"
      server.upscaleJobs = []
      server.data = { ...server.data, examples: [example(1, { videoUrl: "https://cdn.test/trends/a1/up.mp4", width: 1080, height: 1920 })] }
      return { status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-4", applying: true, upscaleJobs: [] } } }
    }
    await user.click(within(card).getByRole("button", { name: /try use it again/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/upscale/apply`)).toEqual([{ jobId: JOB, revision: "rev-1" }, { jobId: JOB, revision: "rev-3" }]))
    expect(await screen.findByText(/1080×1920 · 10\.0 s/)).toBeInTheDocument()
  }, 20_000)

  it("a failed upscale says why and offers Upscale again; Discard drops it with the held revision", async () => {
    const user = userEvent.setup()
    serve({ examples: [example(1)] })
    startable("example", example(1).videoUrl, 0)
    routes[`GET /v1/jobs/${JOB}`] = () => job({ status: "failed", error_message: "The video is too large to upscale.", output_data: null })
    routes[`DELETE ${BASE}/upscale/${JOB}?revision=rev-2`] = () => {
      server.revision = "rev-3"
      server.upscaleJobs = []
      return { body: { data: { version: 1, revision: "rev-3", upscaleJobs: [] } } }
    }
    renderEditor()
    const card = await screen.findByRole("group", { name: "Upscale example 1" })
    await user.click(within(card).getByRole("button", { name: /upscale to 1080p/i }))
    expect(await within(card).findByText(/the video is too large to upscale/i)).toBeInTheDocument()
    expect(within(card).getByRole("button", { name: /upscale again/i })).toBeEnabled()
    expect(within(card).queryByRole("button", { name: /use it/i })).not.toBeInTheDocument()
    await user.click(within(card).getByRole("button", { name: /discard/i }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, init]) => init?.method === "DELETE" && u === `${BASE}/upscale/${JOB}?revision=rev-2`)).toBe(true))
    expect(await within(card).findByRole("button", { name: /upscale to 1080p/i })).toBeInTheDocument()
  })

  it("follows a recorded upscale after a reload, while it runs", async () => {
    serve({ examples: [example(1)] })
    server.upscaleJobs = [{ jobId: JOB, target: "example", fromUrl: example(1).videoUrl, startedAt: "2026-10-25T09:00:00.000Z", current: true, index: 0 }]
    routes[`GET /v1/jobs/${JOB}`] = () => job({ status: "processing", progress: 42, output_data: null })
    renderEditor()
    const card = await screen.findByRole("group", { name: "Upscale example 1" })
    expect(await within(card).findByRole("status")).toHaveTextContent("Upscaling to 1080p… 42 %")
    expect(within(card).queryByRole("button", { name: /upscale to 1080p/i })).not.toBeInTheDocument()
  })

  it("an upscale whose example is gone can only be discarded", async () => {
    serve({ examples: [example(1)] })
    server.upscaleJobs = [{ jobId: JOB, target: "example", fromUrl: "https://cdn.test/trends/a1/removed.mp4", startedAt: "2026-10-25T09:00:00.000Z", current: false }]
    renderEditor()
    const stale = await screen.findByLabelText("Upscales of removed examples")
    expect(within(stale).getByText(/since removed or replaced/i)).toBeInTheDocument()
    expect(within(stale).getByRole("button", { name: /discard/i })).toBeEnabled()
  })
})

describe("upscaling the source clip", { timeout: 20_000 }, () => {
  it("warns the face mask must be made again; using it reloads the form, so the next save carries the 1080p clip", async () => {
    const user = userEvent.setup()
    serve({ faceMasking: { mode: "always" }, faceMask: MASK })
    startable("source", SRC)
    const NEW_SRC = "https://cdn.test/trends/a1/src-1080.mp4"
    const display = { videoUrl: "https://cdn.test/trends/a1/d.mp4", posterUrl: "https://cdn.test/trends/a1/d.png", width: 1080, height: 1920, durationSec: 12 }
    routes[`POST ${BASE}/upscale/apply`] = () => {
      server.revision = "rev-3"
      server.upscaleJobs = [{ jobId: JOB, target: "source", fromUrl: SRC, startedAt: "2026-10-25T09:00:00.000Z", current: true, applying: { startedAt: new Date().toISOString(), stale: false } }]
      // The background finishes on the server after this answer: the poll sees it.
      setTimeout(() => {
        server.revision = "rev-4"
        server.upscaleJobs = []
        server.data = { ...server.data, source: { videoUrl: NEW_SRC, durationSec: 12, width: 1080, height: 1920, display } }
      }, 100)
      return { status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-3", applying: true, upscaleJobs: server.upscaleJobs } } }
    }
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-5" } } })
    renderEditor()

    const panel = await screen.findByRole("group", { name: "Upscale the source clip" })
    await user.click(within(panel).getByRole("button", { name: /upscale to 1080p/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/upscale`)).toEqual([{ target: "source", revision: "rev-1" }]))
    expect(await screen.findByTestId("upscale-source-warning")).toHaveTextContent("The face mask will need to be made again.")
    expect(screen.getByLabelText("Before: the source clip")).toHaveAttribute("src", SRC)

    await user.click(screen.getByRole("button", { name: /use it/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/upscale/apply`)).toEqual([{ jobId: JOB, revision: "rev-2" }]))
    // The form took the server's draft once the poll found it done: the new clip, 1080p, and no further upscale offered.
    expect(await screen.findByText("1080×1920", {}, { timeout: 5_000 })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("group", { name: "Upscale the source clip" })).not.toBeInTheDocument())

    await user.type(screen.getByLabelText("Trend prompt"), "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [saved] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: AdminTrendData; revision: string }>
    expect(saved.revision).toBe("rev-4")
    expect(saved.data.source).toMatchObject({ videoUrl: NEW_SRC, width: 1080, height: 1920, display })
    expect(saved.data).not.toHaveProperty("upscaleJobs")
  })

  it("says nothing of a face mask when none is stored", async () => {
    const user = userEvent.setup()
    serve({})
    startable("source", SRC)
    renderEditor()
    await user.click(within(await screen.findByRole("group", { name: "Upscale the source clip" })).getByRole("button", { name: /upscale to 1080p/i }))
    const warning = await screen.findByTestId("upscale-source-warning")
    expect(warning).toHaveTextContent("Using it replaces the source clip")
    expect(warning).not.toHaveTextContent(/face mask/i)
  })

  it("waits while the form has unsaved edits", async () => {
    const user = userEvent.setup()
    serve({})
    renderEditor()
    const panel = await screen.findByRole("group", { name: "Upscale the source clip" })
    expect(within(panel).getByRole("button", { name: /upscale to 1080p/i })).toBeEnabled()
    await user.type(screen.getByLabelText("Trend prompt"), "!")
    expect(within(panel).getByRole("button", { name: /upscale to 1080p/i })).toBeDisabled()
    expect(within(panel).getByText(/save first/i)).toBeInTheDocument()
  })

  it("is not offered for a source clip already 1080p", async () => {
    serve({ source: { videoUrl: SRC, durationSec: 12, width: 1920, height: 1080 } })
    renderEditor()
    expect(await screen.findByText("1920×1080")).toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "Upscale the source clip" })).not.toBeInTheDocument()
  })
})
