/**
 * Admin → Nodaro Motion → "Advanced in Nodaro Motion": whether the Nodaro
 * Motion page shows its Advanced chip (Prepare references and the
 * pre-prompt). One switch for the whole page, not per engine, off until
 * saved. Save sends `{ show }` alone, the way the other settings save; when
 * only the switch changed, the toast says the page picks it up (no run reads
 * it), and otherwise keeps the runs' wording.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { toast } from "sonner"
import type { TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import { ADVANCED_SWITCH_HINT, ADVANCED_SWITCH_LABEL } from "../components/AdvancedSwitch"

const ADVANCED_URL = "/v1/admin/nodaro-motion/advanced"
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const view = (show: boolean, saved = show) => ({ body: { data: { show, updatedAt: saved ? "2026-11-03T12:00:00.000Z" : null } } })
const RUNS_TOAST = "Saved. Runs pick it up within a minute."
const PAGE_TOAST = "Saved. The Nodaro Motion page picks it up within a couple of minutes."
/** An environment whose engine enforces a forced style, so Always Flex is offered. */
const enforcesStyle = (env: string): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, styleChoice: true } },
})

beforeEach(() => {
  resetRoutes()
  vi.mocked(toast.success).mockClear()
  vi.stubGlobal("fetch", fetchMock)
  routes["GET /v1/admin/nodaro-motion/masking"] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/nodaro-motion/style"] = () => ({ body: { data: { style: null, updatedAt: null, engines: ENGINES, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/prompt-parts"] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion"] } } })
  routes["POST /v1/admin/nodaro-motion/prompt-parts/preview"] = () => ({ body: { data: { set: "precise", parts: [], assembled: "", length: 0, max: 8000, problems: [] } } })
  routes["GET /v1/admin/nodaro-motion/motion"] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes["GET /v1/admin/nodaro-motion/pulse-audio"] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/prism-reference-audio"] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/steps"] = () => ({ body: { data: { steps: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
  routes[`GET ${ADVANCED_URL}`] = () => view(false)
})
afterEach(() => vi.unstubAllGlobals())

const advancedSwitch = () => screen.findByRole("switch", { name: ADVANCED_SWITCH_LABEL })

describe("Admin → Nodaro Motion → Advanced in Nodaro Motion", () => {
  it("is one switch for the whole page, off until saved, with its hint, and Save off", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await advancedSwitch()
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(ADVANCED_SWITCH_HINT)
    // Page level: once, and in no engine's section.
    expect(await screen.findByRole("heading", { name: /^Nodaro Motion Prism/ })).toBeInTheDocument()
    expect(screen.getAllByRole("switch", { name: ADVANCED_SWITCH_LABEL })).toHaveLength(1)
    expect(toggle.closest("section")).toBeNull()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("turns it on and saves { show: true } alone; back off before saving is no change", async () => {
    const user = userEvent.setup()
    routes[`PUT ${ADVANCED_URL}`] = (init) => view(JSON.parse(String(init?.body)).show)
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await advancedSwitch()
    const save = screen.getByRole("button", { name: "Save" })
    await user.click(toggle)
    expect(toggle).toBeChecked()
    expect(save).toBeEnabled()
    await user.click(toggle)
    expect(save).toBeDisabled()
    await user.click(toggle)
    await user.click(save)
    await waitFor(() => expect(sentTo(`PUT ${ADVANCED_URL}`)).toEqual([{ show: true }]))
    // Only the switch changed: nothing else is sent.
    expect(sentTo("PUT /v1/admin/nodaro-motion/masking")).toEqual([])
    expect(sentTo("PUT /v1/admin/nodaro-motion/style")).toEqual([])
    expect(sentTo("PUT /v1/admin/nodaro-motion/steps")).toEqual([])
    // Saved: the switch stays on, and there is nothing left to save.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled())
    expect(await advancedSwitch()).toBeChecked()
    // Only the switch changed: the page picks it up, not runs.
    expect(toast.success).toHaveBeenCalledWith(PAGE_TOAST)
    expect(toast.success).not.toHaveBeenCalledWith(RUNS_TOAST)
  })

  it("shows a saved on, and turns it off with { show: false }", async () => {
    const user = userEvent.setup()
    routes[`GET ${ADVANCED_URL}`] = () => view(true)
    routes[`PUT ${ADVANCED_URL}`] = (init) => view(JSON.parse(String(init?.body)).show, true)
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await advancedSwitch()
    await waitFor(() => expect(toggle).toBeChecked())
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${ADVANCED_URL}`)).toEqual([{ show: false }]))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(PAGE_TOAST))
  })

  it("keeps the runs' toast when an engine setting is saved with it", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [enforcesStyle("production"), enforcesStyle("staging")] } })
    routes["PUT /v1/admin/nodaro-motion/style"] = (init) => ({
      body: { data: { style: JSON.parse(String(init?.body)).style, updatedAt: "2026-11-03T12:00:00.000Z", engines: ENGINES, supported: true } },
    })
    routes[`PUT ${ADVANCED_URL}`] = (init) => view(JSON.parse(String(init?.body)).show)
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await advancedSwitch())
    const pulse = (await screen.findByRole("heading", { name: /^Nodaro Motion Pulse/ })).closest("section") as HTMLElement
    await user.click(await within(pulse).findByRole("combobox", { name: "Style" }))
    await user.click(await screen.findByRole("option", { name: "Always Flex" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${ADVANCED_URL}`)).toEqual([{ show: true }]))
    expect(sentTo("PUT /v1/admin/nodaro-motion/style")).toEqual([{ style: { "motion-pulse": "flex" } }])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(RUNS_TOAST))
    expect(toast.success).not.toHaveBeenCalledWith(PAGE_TOAST)
  })
})
