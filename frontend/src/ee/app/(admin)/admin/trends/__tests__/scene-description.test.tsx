/**
 * Admin → Trends → one trend → 6. Clip preparation → Full depth → the approved
 * clip's stored scene description (SceneDescriptionEditor.tsx).
 *
 * - Full depth with its scene from a description shows the one text ("Full
 *   run"), with "Previews use these lines, cut to the 4 s window." under it
 *   and a disclosure of what a preview keeps; Save sends the edited text with
 *   the held revision, and the screen adopts the revision it gets back.
 * - There is no preview text: an older make's stored one is never shown.
 * - A clip made before descriptions existed says to make it again.
 * - "Description + original" shows it too; another scene source, or Faces
 *   hidden, shows no description; a trend with no preview has no preview line.
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
  // An older make's preview text: stored, never shown.
  previewSceneDescription: "0-4 s: the woman spins.",
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
  it("shows the Full run text alone, says previews cut it, and saves an edit with the held revision, adopting the next", async () => {
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
    expect(full).toHaveAccessibleDescription("Previews use these lines, cut to the 4 s window.")
    // An older make's preview text is never shown.
    expect(screen.queryByLabelText("Preview (4 s)")).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(STORED.previewSceneDescription!)).not.toBeInTheDocument()
    const save = screen.getByRole("button", { name: /^save$/i })
    expect(save).toBeDisabled()

    await user.type(full, " Then waves.")
    await user.click(save)
    await waitFor(() =>
      expect(sentTo(`PUT ${BASE}/face-mask/scene-description`)).toEqual([
        { which: "full", text: "A neon kitchen. 0-12 s: the woman dances. Then waves.", revision: "rev-1" },
      ]),
    )

    // The next draft write carries the revision the save returned.
    await user.type(screen.getByLabelText("Trend prompt"), "!")
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    expect((sentTo(`PUT ${BASE}/draft`)[0] as { revision: string }).revision).toBe("rev-2")
  })

  it("shows what a preview keeps of the text in the box: its shots cut to the 4 s window and re-timed", async () => {
    const user = userEvent.setup()
    const text = "A neon kitchen.\nThe woman wears red.\n0-3s: she walks in.\n3-6s: she spins.\n6-12s: she bows."
    serve({ faceMasking: FULL, faceMask: { ...STORED, sceneDescription: text } })
    renderEditor()
    await screen.findByLabelText("Full run")
    await user.click(screen.getByText("What a preview keeps (from 2 s)"))
    // The harness's preview starts at 2 on a 12 s clip: window 2–6 s.
    expect(screen.getByTestId("scene-preview-cut").textContent).toBe("A neon kitchen.\nThe woman wears red.\n0-1s: she walks in.\n1-4s: she spins.")
    // It follows the text as it is edited.
    await user.clear(screen.getByLabelText("Full run"))
    await user.paste("[0.0-2.5 s] wide. A.\n[2.5-12.0 s] close. B.")
    expect(screen.getByTestId("scene-preview-cut").textContent).toBe("[0.0-0.5 s] wide. A.\n[0.5-4.0 s] close. B.")
  })

  it("a ~5 s clip's disclosure shows the cut a run gets: the whole clip's window is sent, so it is cut too", async () => {
    const user = userEvent.setup()
    serve({
      faceMasking: FULL,
      faceMask: { ...STORED, sceneDescription: "A kitchen.\n0-2s: a.\n2-5s: b." },
      source: { videoUrl: "https://cdn.test/trends/a1/src.mp4", durationSec: 5, width: 720, height: 1280 },
      previewStart: 1,
    })
    renderEditor()
    await screen.findByLabelText("Full run")
    await user.click(screen.getByText("What a preview keeps (from 1 s)"))
    expect(screen.getByTestId("scene-preview-cut").textContent).toBe("A kitchen.\n0-1s: a.\n1-4s: b.")
  })

  it("a clip made before descriptions existed says to make it again", async () => {
    serve({ faceMasking: FULL, faceMask: { ...STORED, sceneDescription: undefined, previewSceneDescription: undefined } })
    renderEditor()
    expect(await screen.findByLabelText("Full run")).toHaveValue("")
    expect(screen.getAllByText("Make the depth clip again to get a description.")).toHaveLength(1)
    expect(screen.queryByText(/what a preview keeps/i)).not.toBeInTheDocument()
  })

  it("waits while the form has unsaved edits", async () => {
    const user = userEvent.setup()
    serve({ faceMasking: FULL, faceMask: STORED })
    renderEditor()
    await user.type(await screen.findByLabelText("Full run"), " More.")
    await user.type(screen.getByLabelText("Trend prompt"), "!")
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled()
    expect(screen.getByText("Save the draft first.")).toBeInTheDocument()
  })

  it("a trend with no preview shows the full run's text with no preview line", async () => {
    serve({ faceMasking: FULL, faceMask: STORED, previewStart: null })
    renderEditor()
    expect(await screen.findByLabelText("Full run")).toBeInTheDocument()
    expect(screen.queryByText("Previews use these lines, cut to the 4 s window.")).not.toBeInTheDocument()
    expect(screen.queryByText(/what a preview keeps/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Preview (4 s)")).not.toBeInTheDocument()
  })

  it("the description beside the original shows and edits the stored description too", async () => {
    serve({ faceMasking: { ...FULL, scene: "description-and-original" }, faceMask: STORED })
    renderEditor()
    expect(await screen.findByLabelText("Full run")).toHaveValue(STORED.sceneDescription)
    expect(screen.getByLabelText("Full run")).toHaveAccessibleDescription("Previews use these lines, cut to the 4 s window.")
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
