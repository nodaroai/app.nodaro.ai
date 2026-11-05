/**
 * Admin → Trends → one trend: "Send the clip as it is first".
 *
 * - Offered only where it can apply: Faces hidden or masking off, the Precise
 *   prompt style, and no person slot. Anywhere else the switch is hidden, and
 *   a value already stored stays stored and has no effect on a run.
 * - Off by default; it saves `noPersonSourceClip: true` with the draft, and off
 *   the key is left out (an old draft loads and saves as before).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import type { AdminTrendData } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, slot, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"
import { noPersonSourceClipOffered } from "../prompt-style"

const BASE = `/v1/admin/trends/${TREND_ID}`
const LABEL = "Send the clip as it is first"
const ROOM = [slot({ key: "room", kind: "location", roleName: "the room", defaults: undefined })]
const FACES = { mode: "always" as const, threshold: 0.4 }

function renderEditor(data: Partial<AdminTrendData>) {
  routes[`GET ${BASE}`] = () => ({ body: { data: detail({}, data) } })
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
  routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
})
afterEach(() => vi.unstubAllGlobals())

describe("noPersonSourceClipOffered", () => {
  it("offers it on a Faces hidden or masking-off Precise trend with no person slot", () => {
    for (const faceMasking of [FACES, { mode: "auto" as const }, undefined, { mode: "off" as const }, { mode: "off" as const, source: "full-depth" as const }]) {
      expect(noPersonSourceClipOffered({ slots: ROOM, faceMasking }), JSON.stringify(faceMasking)).toBe(true)
    }
    expect(noPersonSourceClipOffered({ slots: [], faceMasking: FACES })).toBe(true)
    expect(noPersonSourceClipOffered({ slots: ROOM, faceMasking: FACES, promptStyle: "precise" })).toBe(true)
  })

  it("does not offer it with a person slot, a Flexible prompt style or a depth source", () => {
    expect(noPersonSourceClipOffered({ slots: [...ROOM, slot()], faceMasking: FACES })).toBe(false)
    expect(noPersonSourceClipOffered({ slots: ROOM, faceMasking: FACES, promptStyle: "flexible" })).toBe(false)
    expect(noPersonSourceClipOffered({ slots: ROOM, promptStyle: "flexible" })).toBe(false)
    expect(noPersonSourceClipOffered({ slots: ROOM, faceMasking: { mode: "always", source: "full-depth" } })).toBe(false)
    expect(noPersonSourceClipOffered({ slots: ROOM, faceMasking: { mode: "always", source: "full-depth" }, promptStyle: "precise" })).toBe(false)
    expect(noPersonSourceClipOffered({ slots: ROOM, faceMasking: { mode: "always", source: "keep-people" } })).toBe(false)
  })
})

describe("send the clip as it is first", { timeout: 20_000 }, () => {
  it.each([
    ["a Faces hidden Precise trend", FACES],
    ["a masking-off trend", undefined],
  ])("shows on %s with no person slot, off by default, with its explanation", async (_name, faceMasking) => {
    renderEditor({ slots: ROOM, faceMasking })
    const toggle = await screen.findByRole("switch", { name: LABEL })
    expect(toggle).not.toBeChecked()
    expect(
      screen.getByText(
        "With no person to replace, the first try sends the source clip. If the model refuses the clip or what it would make, the one retry uses this trend's approved mask, or masks for that run if the trend has none: the run's balance must also cover that masking, charged only if the retry runs.",
      ),
    ).toBeInTheDocument()
  })

  it.each<[string, Partial<AdminTrendData>]>([
    ["a person slot", { faceMasking: FACES }],
    ["a Flexible prompt style", { slots: ROOM, faceMasking: FACES, promptStyle: "flexible" }],
    ["a depth source", { slots: ROOM, faceMasking: { mode: "always", source: "full-depth" } }],
  ])("is hidden with %s", async (_name, data) => {
    renderEditor(data)
    await screen.findByRole("switch", { name: "Hide the original" })
    expect(screen.queryByRole("switch", { name: LABEL })).toBeNull()
  })

  it("saves noPersonSourceClip: true once turned on", async () => {
    const user = userEvent.setup()
    renderEditor({ slots: ROOM, faceMasking: FACES })
    await user.click(await screen.findByRole("switch", { name: LABEL }))
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data.noPersonSourceClip).toBe(true)
  })

  it("loads a draft that has it as on, and leaves the key out once turned off", async () => {
    const user = userEvent.setup()
    renderEditor({ slots: ROOM, faceMasking: FACES, noPersonSourceClip: true })
    const toggle = await screen.findByRole("switch", { name: LABEL })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const [body] = sentTo(`PUT ${BASE}/draft`) as Array<{ data: Record<string, unknown> }>
    expect(body.data).not.toHaveProperty("noPersonSourceClip")
  })
})
