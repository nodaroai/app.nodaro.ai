/**
 * Admin → Trends → one trend → 6. Face masking → the stored face mask.
 *
 * - "Make face mask" starts the job for the saved draft; the job is followed
 *   and its masked clip plays with its stats; Approve stores it with the
 *   revision the screen holds, and the screen adopts the revision it gets back.
 * - A job that found no face offers no Approve; a failed one says why.
 * - The status chip is the server's: none / approved / out of date (with why).
 * - It acts on the SAVED draft: while the form has unsaved edits it waits.
 * - Publish refused for the face mask reads as a sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { toast } from "sonner"
import type { AdminTrendFaceMask } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"

const BASE = `/v1/admin/trends/${TREND_ID}`
const JOB = "00000000-0000-4000-8000-0000000000f1"
const MASKING = { mode: "always" as const }

const STORED: AdminTrendFaceMask = {
  url: "https://cdn.test/trends/a1/mask.mp4",
  frames: 360,
  recipe: { core: "2026-10-25", plugin: "1" },
  settingsKey: "v1:abc",
  jobId: JOB,
  stats: { shots: 2, heldFrames: 7, coverage: 0.042, droppedRegions: 0 },
  approvedAt: "2026-10-25T10:00:00.000Z",
  approvedBy: "admin",
}

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

function job(over: Record<string, unknown> = {}, output: Record<string, unknown> = {}) {
  return {
    body: {
      data: {
        id: JOB,
        status: "completed",
        progress: 100,
        output_data: { maskedUrl: "https://out.test/mask.mp4", frames: 360, stats: { shots: 3, heldFrames: 12, coverage: 0.031 }, ...output },
        ...over,
      },
    },
  }
}

beforeEach(() => {
  resetRoutes()
  vi.mocked(toast.warning).mockClear()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "none", reasons: [] } }, { faceMasking: MASKING }) } })
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
})
afterEach(() => vi.unstubAllGlobals())

describe("the stored face mask", { timeout: 20_000 }, () => {
  it("makes one, shows it with its stats, and approves it with the held revision, adopting the next", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/face-mask`] = () => ({ status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-2", recorded: true, draftMoved: false } } })
    routes[`GET /v1/jobs/${JOB}`] = () => job()
    routes[`POST ${BASE}/face-mask/approve`] = () => ({
      body: { data: { version: 1, revision: "rev-3", faceMask: STORED, faceMaskState: { status: "approved", reasons: [] } } },
    })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-4" } } })
    renderEditor()

    expect(await screen.findByTestId("face-mask-status")).toHaveTextContent("No face mask")
    await user.click(screen.getByRole("button", { name: /make face mask/i }))
    await waitFor(() => expect(sentTo(`POST ${BASE}/face-mask`)).toEqual([{ revision: "rev-1" }]))

    expect(await screen.findByLabelText("The new face mask")).toHaveAttribute("src", "https://out.test/mask.mp4")
    expect(screen.getByTestId("face-mask-stats")).toHaveTextContent("3 shots · 12 held frames · 3.1 % covered")
    await user.click(screen.getByRole("button", { name: /^approve$/i }))
    // Recording the job moved the draft: the approval carries the revision that start returned.
    await waitFor(() => expect(sentTo(`POST ${BASE}/face-mask/approve`)).toEqual([{ jobId: JOB, revision: "rev-2" }]))

    // The next draft write carries the revision the approval returned.
    await user.type(screen.getByLabelText("Trend prompt"), "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [saved] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown>; revision: string }>
    expect(saved.revision).toBe("rev-3")
    expect(saved.data).not.toHaveProperty("faceMask")
    expect(saved.data).not.toHaveProperty("faceMaskJob")
  })

  it("offers no Approve when the job found no face, and says why a failed one stopped", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/face-mask`] = () => ({ status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-2", recorded: true, draftMoved: false } } })
    routes[`GET /v1/jobs/${JOB}`] = () => job({}, { maskedUrl: null, reason: "no_faces" })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /make face mask/i }))
    expect(await screen.findByText(/no face was found to cover/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument()

    const JOB2 = "00000000-0000-4000-8000-0000000000f2"
    routes[`POST ${BASE}/face-mask`] = () => ({ status: 202, body: { data: { jobId: JOB2, version: 1, revision: "rev-3", recorded: true, draftMoved: false } } })
    routes[`GET /v1/jobs/${JOB2}`] = () => job({ id: JOB2, status: "failed", error_message: "The source clip could not be read." }, { maskedUrl: undefined })
    await user.click(screen.getByRole("button", { name: /make again/i }))
    expect(await screen.findByText(/the source clip could not be read/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument()
  })

  it("once the server names the job it started, the server's reading wins: a settings save hides Approve", async () => {
    const user = userEvent.setup()
    let pending: { jobId: string; startedAt: string; current: boolean } | null = null
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "none", reasons: [] }, faceMaskJob: pending, revision: pending ? "rev-2" : "rev-1" }, { faceMasking: MASKING }) },
    })
    routes[`POST ${BASE}/face-mask`] = () => {
      pending = { jobId: JOB, startedAt: "2026-10-25T09:00:00.000Z", current: true }
      return { status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-2", recorded: true, draftMoved: false } } }
    }
    routes[`GET /v1/jobs/${JOB}`] = () => job()
    routes[`PUT ${BASE}/draft`] = () => {
      // The saved settings differ from the ones the job was started for.
      pending = { jobId: JOB, startedAt: "2026-10-25T09:00:00.000Z", current: false }
      return { body: { data: { version: 1, revision: "rev-3" } } }
    }
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /make face mask/i }))
    expect(await screen.findByRole("button", { name: /^approve$/i })).toBeInTheDocument()

    await user.type(screen.getByLabelText("Trend prompt"), "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    expect(await screen.findByText(/made from older settings or another source clip/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: /make again/i })).toBeEnabled())
  })

  it("after a reload, follows the job recorded on the draft and offers Approve", async () => {
    routes[`GET ${BASE}`] = () => ({
      body: {
        data: detail(
          { faceMaskState: { status: "none", reasons: [] }, faceMaskJob: { jobId: JOB, startedAt: "2026-10-25T09:00:00.000Z", current: true } },
          { faceMasking: MASKING },
        ),
      },
    })
    routes[`GET /v1/jobs/${JOB}`] = () => job()
    renderEditor()
    expect(await screen.findByLabelText("The new face mask")).toHaveAttribute("src", "https://out.test/mask.mp4")
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeEnabled()
  })

  it("a recorded job made from older settings is shown as such, with Make again only", async () => {
    routes[`GET ${BASE}`] = () => ({
      body: {
        data: detail(
          { faceMaskState: { status: "none", reasons: [] }, faceMaskJob: { jobId: JOB, startedAt: "2026-10-25T09:00:00.000Z", current: false } },
          { faceMasking: MASKING },
        ),
      },
    })
    routes[`GET /v1/jobs/${JOB}`] = () => job()
    renderEditor()
    expect(await screen.findByText(/made from older settings or another source clip/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /make again/i })).toBeEnabled()
  })

  it("reloads the trend when another write landed while the job was recorded", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/face-mask`] = () => ({ status: 202, body: { data: { jobId: JOB, version: 1, revision: "rev-9", recorded: true, draftMoved: true } } })
    routes[`GET /v1/jobs/${JOB}`] = () => job()
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /make face mask/i }))
    await waitFor(() => expect(toast.warning).toHaveBeenCalled())
  })

  it("shows the approved mask, and an out-of-date one with why, as the server says", async () => {
    routes[`GET ${BASE}`] = () => ({
      body: {
        data: detail(
          { faceMaskState: { status: "out_of_date", reasons: [{ why: "settings" }, { why: "plugin_recipe", env: "production" }] } },
          { faceMasking: MASKING, faceMask: STORED },
        ),
      },
    })
    renderEditor()
    expect(await screen.findByTestId("face-mask-status")).toHaveTextContent("Out of date")
    const why = screen.getByRole("list", { name: /why the face mask is out of date/i })
    expect(within(why).getByText(/face masking settings changed/i)).toBeInTheDocument()
    expect(within(why).getByText(/production's cast swap engine masks faces differently/i)).toBeInTheDocument()
    expect(screen.getByLabelText("The approved face mask")).toHaveAttribute("src", STORED.url)
    expect(screen.getByTestId("face-mask-stats")).toHaveTextContent("2 shots · 7 held frames · 4.2 % covered")
    expect(screen.getByRole("button", { name: /make again/i })).toBeEnabled()
  })

  it("removes the approved mask with the held revision", async () => {
    const user = userEvent.setup()
    routes[`GET ${BASE}`] = () => ({
      body: { data: detail({ faceMaskState: { status: "approved", reasons: [] } }, { faceMasking: MASKING, faceMask: STORED }) },
    })
    routes[`DELETE ${BASE}/face-mask?revision=rev-1`] = () => ({
      body: { data: { version: 1, revision: "rev-2", faceMaskState: { status: "none", reasons: [] } } },
    })
    renderEditor()
    expect(await screen.findByTestId("face-mask-status")).toHaveTextContent("Approved")
    await user.click(screen.getByRole("button", { name: /^remove$/i }))
    await waitFor(() => expect(sentTo(`DELETE ${BASE}/face-mask?revision=rev-1`)).toHaveLength(1))
  })

  it("waits while the form has unsaved edits, and is not offered when masking is off", async () => {
    const user = userEvent.setup()
    renderEditor()
    const make = await screen.findByRole("button", { name: /make face mask/i })
    expect(make).toBeEnabled()
    await user.type(screen.getByLabelText("Trend prompt"), "!")
    expect(make).toBeDisabled()
    expect(screen.getByText(/the face mask is made from the saved draft/i)).toBeInTheDocument()
  })

  it("is not shown on a trend that does not mask", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail() } })
    renderEditor()
    expect(await screen.findByRole("button", { name: /save draft/i })).toBeInTheDocument()
    expect(screen.queryByTestId("face-mask-status")).not.toBeInTheDocument()
  })

  it("a publish refused for the face mask reads as a sentence", async () => {
    const user = userEvent.setup()
    routes[`POST ${BASE}/publish`] = () => ({
      status: 409,
      body: {
        error: {
          code: "publish_blocked",
          message: "This trend cannot be published yet.",
          reasons: [
            { code: "face_mask_missing", message: "x" },
            { code: "face_mask_out_of_date", why: "core_recipe", message: "x" },
            { code: "engine_unsupported", env: "staging", need: "storedFaceMask" },
          ],
        },
      },
    })
    renderEditor()
    await user.click(await screen.findByRole("button", { name: /^publish$/i }))
    const reasons = await screen.findByRole("list", { name: /why it can't be published/i })
    expect(within(reasons).getByText(/make its face mask and approve it/i)).toBeInTheDocument()
    expect(within(reasons).getByText(/the face mask is out of date: video mask changed/i)).toBeInTheDocument()
    expect(within(reasons).getByText(/staging: stored face masks not supported yet/i)).toBeInTheDocument()
  })
})
