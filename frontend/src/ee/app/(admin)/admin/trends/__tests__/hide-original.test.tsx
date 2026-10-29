/**
 * Admin → Trends → one trend: "Hide the original".
 *
 * - The toggle saves `hideOriginal: true` with the draft; off, the key is left
 *   out (an old draft loads and saves as before).
 * - On, with no example saved yet, the editor warns: publishing needs one.
 * - The publish blocker for it reads as a sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { detail, draft, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"
import { describeBlocker, fromForm, toForm } from "../model"

const BASE = `/v1/admin/trends/${TREND_ID}`
const EXAMPLE = {
  videoUrl: "https://cdn.test/trends/a1/ex1.mp4",
  width: 720,
  height: 1280,
  durationSec: 12,
  slots: { dancer: ["https://cdn.test/me.png"] },
  sourceJobId: "00000000-0000-4000-8000-0000000000b1",
}

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}`] = () => ({ body: { data: detail() } })
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
  routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("hide the original", { timeout: 20_000 }, () => {
  it("is off by default and saves hideOriginal: true once turned on, warning while the draft has no example", async () => {
    const user = userEvent.setup()
    renderEditor()
    const toggle = await screen.findByRole("switch", { name: "Hide the original" })
    expect(toggle).not.toBeChecked()
    expect(screen.getByText("Visitors see example 1 as the original; the original clip is never shown.")).toBeInTheDocument()
    expect(document.querySelector("[data-hide-original-warning]")).toBeNull()

    await user.click(toggle)
    expect(toggle).toBeChecked()
    expect(document.querySelector("[data-hide-original-warning]")).toHaveTextContent(/no example yet/)

    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.hideOriginal).toBe(true)
  })

  it("loads a draft that hides its original as on, with no warning when it has an example", async () => {
    routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, { hideOriginal: true, examples: [EXAMPLE] }) } })
    renderEditor()
    const toggle = await screen.findByRole("switch", { name: "Hide the original" })
    expect(toggle).toBeChecked()
    expect(document.querySelector("[data-hide-original-warning]")).toBeNull()
  })

  it("round-trips through the form: on is saved, off leaves the key out", () => {
    expect(fromForm(toForm(draft({ hideOriginal: true }))).hideOriginal).toBe(true)
    expect(fromForm(toForm(draft()))).not.toHaveProperty("hideOriginal")
    expect(fromForm(toForm(draft({ hideOriginal: false })))).not.toHaveProperty("hideOriginal")
  })

  it("describes the publish blocker", () => {
    expect(describeBlocker({ code: "hide_original_needs_example" })).toMatch(/hides its original.*add an example/)
  })
})
