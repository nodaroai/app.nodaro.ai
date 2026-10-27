/**
 * Admin → Trends → one trend → 6. Clip preparation → Full depth → the approved
 * clip's stored scene descriptions (SceneDescriptionEditor.tsx).
 *
 * - Full depth with its scene from a description shows both texts ("Full run",
 *   "Preview (4 s)"); Save sends the edited text with the held revision, and
 *   the screen adopts the revision it gets back.
 * - A clip made before descriptions existed says to make it again; a preview
 *   text made for another preview start says runs use the full one cut.
 * - Another scene source, or Faces hidden, shows no description; a trend with
 *   no preview shows no preview text.
 * - It writes the saved draft: while the form has unsaved edits, Save waits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import type { AdminTrendData, AdminTrendFaceMask } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"

const BASE = `/v1/admin/trends/${TREND_ID}`
const FULL = { mode: "always" as const, source: "full-depth" as const }

const STORED: AdminTrendFaceMask = {
  url: "https://cdn.test/trends/a1/depth.mp4",
  frames: 360,
  recipe: { core: null, plugin: "1" },
  settingsKey: "v2:abc",
  jobId: "00000000-0000-4000-8000-0000000000f1",
  stats: { shots: 0, heldFrames: 0, coverage: 1, droppedRegions: 0 },
  approvedAt: "2026-10-28T10:00:00.000Z",
  approvedBy: "admin",
  sceneDescription: "A neon kitchen. 0-12 s: the woman dances.",
  previewSceneDescription: "0-4 s: the woman spins.",
  // The harness draft's preview start.
  previewSceneDescriptionStart: 2,
}

function serve(data: Partial<AdminTrendData>) {
  routes[`GET ${BASE}`] = () => ({ body: { data: detail({ faceMaskState: { status: "approved", reasons: [] } }, data) } })
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

describe("the stored scene description", { timeout: 20_000 }, () => {
  it("shows both texts and saves an edit with the held revision, adopting the next", async () => {
    const user = userEvent.setup()
    serve({ faceMasking: FULL, faceMask: STORED })
    routes[`PUT ${BASE}/face-mask/scene-description`] = () => ({
      body: { data: { version: 1, revision: "rev-2", faceMask: STORED, faceMaskState: { status: "approved", reasons: [] } } },
    })
    routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-3" } } })
    renderEditor()

    expect(await screen.findByText(/each run rewrites it for the new cast/i)).toBeInTheDocument()
    const full = screen.getByLabelText("Full run")
    expect(full).toHaveValue(STORED.sceneDescription)
    expect(screen.getByLabelText("Preview (4 s)")).toHaveValue(STORED.previewSceneDescription)
    expect(screen.queryByText(/the preview start changed/i)).not.toBeInTheDocument()
    const [saveFull, savePreview] = screen.getAllByRole("button", { name: /^save$/i })
    expect(saveFull).toBeDisabled()

    await user.type(screen.getByLabelText("Preview (4 s)"), " Then waves.")
    expect(saveFull).toBeDisabled()
    await user.click(savePreview!)
    await waitFor(() =>
      expect(sentTo(`PUT ${BASE}/face-mask/scene-description`)).toEqual([
        { which: "preview", text: "0-4 s: the woman spins. Then waves.", revision: "rev-1" },
      ]),
    )

    // The next draft write carries the revision the save returned.
    await user.type(screen.getByLabelText("Trend prompt"), "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    expect((sentTo(`PUT ${BASE}/draft`)[0] as { revision: string }).revision).toBe("rev-2")
  })

  it("a preview text made for another start says runs use the full description cut to the preview", async () => {
    serve({ faceMasking: FULL, faceMask: STORED, previewStart: 5 })
    renderEditor()
    expect(
      await screen.findByText("The preview start changed since this was made; runs use the full description cut to the preview"),
    ).toBeInTheDocument()
  })

  it("a clip made before descriptions existed says to make it again", async () => {
    const { sceneDescription: _s, previewSceneDescription: _p, ...older } = STORED
    serve({ faceMasking: FULL, faceMask: older })
    renderEditor()
    expect(await screen.findByLabelText("Full run")).toHaveValue("")
    expect(screen.getAllByText("Make the depth clip again to get a description.")).toHaveLength(2)
  })

  it("waits while the form has unsaved edits", async () => {
    const user = userEvent.setup()
    serve({ faceMasking: FULL, faceMask: STORED })
    renderEditor()
    await user.type(await screen.findByLabelText("Full run"), " More.")
    await user.type(screen.getByLabelText("Trend prompt"), "!")
    expect(screen.getAllByRole("button", { name: /^save$/i })[0]).toBeDisabled()
    expect(screen.getByText("Save the draft first.")).toBeInTheDocument()
  })

  it("a trend with no preview shows the full run's text only", async () => {
    const { previewSceneDescription: _p, ...noPreview } = STORED
    serve({ faceMasking: FULL, faceMask: noPreview, previewStart: null })
    renderEditor()
    expect(await screen.findByLabelText("Full run")).toBeInTheDocument()
    expect(screen.queryByLabelText("Preview (4 s)")).not.toBeInTheDocument()
  })

  it("another scene source, or a face mask, shows no description", async () => {
    serve({ faceMasking: { ...FULL, scene: "original" }, faceMask: STORED })
    const view = renderEditor()
    expect(await screen.findByTestId("face-mask-status")).toHaveTextContent("Approved")
    expect(screen.queryByLabelText("Full run")).not.toBeInTheDocument()
    view.unmount()

    serve({ faceMasking: { mode: "always" }, faceMask: STORED })
    renderEditor()
    expect(await screen.findByTestId("face-mask-status")).toHaveTextContent("Approved")
    expect(screen.queryByLabelText("Full run")).not.toBeInTheDocument()
  })
})
