/**
 * Admin → Nodaro Motion: the face masking per engine (Pro, Lite) for every
 * run people start themselves. Off until saved; each engine edited with the
 * trend editor's controls; Save sends the whole setting, keyed by the public
 * engine ids, and is held while a value is out of range.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import { toSaved } from "../model"

const URL = "/v1/admin/nodaro-motion/masking"
const ENGINES = [
  { id: "motion-pro", name: "Nodaro Motion Pro", internal: "seedance-2-5" },
  { id: "motion-lite", name: "Nodaro Motion Lite", internal: "kling-4" },
]

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${URL}`] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
})
afterEach(() => vi.unstubAllGlobals())

const section = async (name: RegExp) => (await screen.findByRole("heading", { name })).closest("section") as HTMLElement

describe("Admin → Nodaro Motion", () => {
  it("shows both engines by name, with the model each runs on, Off until saved", async () => {
    renderWith(<AdminNodaroMotionPage />)
    expect(await screen.findByRole("heading", { name: "Nodaro Motion Pro (Seedance 2.5)" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Nodaro Motion Lite (Kling 4)" })).toBeInTheDocument()
    expect(screen.getByText(/never saved: no engine masks faces/i)).toBeInTheDocument()
    for (const name of [/Pro/, /Lite/]) {
      expect(within(await section(name)).getByRole("combobox", { name: "Mode" })).toHaveTextContent("Off")
    }
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("saves one engine's setting, keyed by its public id, the others left out", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL}`] = (init) => ({
      body: { data: { masking: JSON.parse(String(init?.body)).masking, updatedAt: "2026-10-25T12:00:00.000Z", engines: ENGINES } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const lite = await section(/Lite/)
    await user.click(within(lite).getByRole("combobox", { name: "Mode" }))
    await user.click(screen.getByRole("option", { name: "Auto" }))
    await user.click(within(lite).getByRole("combobox", { name: "Covers" }))
    await user.click(screen.getByRole("option", { name: "Face" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ masking: { "motion-lite": { mode: "auto", target: "face" } } }]))
    expect(await screen.findByText(/^Saved /)).toBeInTheDocument()
  })

  it("starts from what is stored, and holds Save while a value is out of range", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL}`] = () => ({
      body: { data: { masking: { "motion-pro": { mode: "always", threshold: 0.4 } }, updatedAt: "2026-10-25T10:00:00.000Z", engines: ENGINES } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const pro = await section(/Pro/)
    expect(within(pro).getByRole("combobox", { name: "Mode" })).toHaveTextContent("Always")
    const threshold = within(pro).getByLabelText("Detection threshold")
    expect(threshold).toHaveValue(0.4)
    await user.clear(threshold)
    await user.type(threshold, "2")
    expect(screen.getByText(/Nodaro Motion Pro: Face masking: the detection threshold/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })
})

describe("toSaved", () => {
  it("cleans each engine's setting and leaves out an engine with none", () => {
    expect(toSaved({ "motion-pro": { mode: "auto", zone: {}, fill: undefined }, "motion-lite": undefined })).toEqual({ "motion-pro": { mode: "auto" } })
    expect(toSaved({})).toEqual({})
  })
})
