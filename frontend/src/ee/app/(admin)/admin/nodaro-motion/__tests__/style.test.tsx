/**
 * Admin → Nodaro Motion → Style: per engine, people choose Precise or Flex
 * (the default, never saved) or every direct run is always Precise / always
 * Flex. The forced choices are greyed out, naming the environments, until
 * every environment's engine enforces them (`castSwap.styleChoice`); "Users
 * choose" is always offered. Save sends only the forced engines, keyed by
 * public id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import type { TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import { STYLE_CHOICE_HINT, styleToSaved } from "../components/StyleChoiceSelect"

const STYLE_URL = "/v1/admin/nodaro-motion/style"
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const enforces = (env: string, styleChoice?: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(styleChoice === undefined ? {} : { styleChoice }) } },
})
const BOTH = [enforces("production", true), enforces("staging", true)]
const view = (style: unknown) => ({ body: { data: { style, updatedAt: style ? "2026-11-01T12:00:00.000Z" : null, engines: ENGINES, supported: true } } })

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes["GET /v1/admin/nodaro-motion/masking"] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/nodaro-motion/prompt-parts"] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion"] } } })
  routes["POST /v1/admin/nodaro-motion/prompt-parts/preview"] = () => ({ body: { data: { set: "precise", parts: [], assembled: "", length: 0, max: 8000, problems: [] } } })
  routes["GET /v1/admin/nodaro-motion/motion"] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes["GET /v1/admin/nodaro-motion/pulse-audio"] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/prism-reference-audio"] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/steps"] = () => ({ body: { data: { steps: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: BOTH } })
  routes[`GET ${STYLE_URL}`] = () => view(null)
})
afterEach(() => vi.unstubAllGlobals())

const section = async (name: RegExp) =>
  (await screen.findByRole("heading", { name: new RegExp(`^Nodaro Motion ${name.source}`) })).closest("section") as HTMLElement
const styleSelect = async (name: RegExp) => within(await section(name)).findByRole("combobox", { name: "Style" })

describe("Admin → Nodaro Motion → Style", () => {
  it("shows Users choose on each engine until saved, with the hint, and Save off", async () => {
    renderWith(<AdminNodaroMotionPage />)
    for (const name of [/Prism/, /Pulse/]) {
      const select = await styleSelect(name)
      expect(select).toHaveTextContent("Users choose (Precise or Flex)")
      expect(select).toHaveAccessibleDescription(STYLE_CHOICE_HINT)
    }
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("saves one engine forced, keyed by its public id, the other left out", async () => {
    const user = userEvent.setup()
    routes[`PUT ${STYLE_URL}`] = (init) => view(JSON.parse(String(init?.body)).style)
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await styleSelect(/Pulse/))
    await user.click(await screen.findByRole("option", { name: "Always Flex" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${STYLE_URL}`)).toEqual([{ style: { "motion-pulse": "flex" } }]))
    // Only the Style setting changed: nothing else is sent.
    expect(sentTo("PUT /v1/admin/nodaro-motion/masking")).toEqual([])
    expect(sentTo("PUT /v1/admin/nodaro-motion/steps")).toEqual([])
  })

  it("puts a forced engine back to Users choose (saved as left out)", async () => {
    const user = userEvent.setup()
    routes[`GET ${STYLE_URL}`] = () => view({ "motion-prism": "precise", "motion-pulse": "flex" })
    routes[`PUT ${STYLE_URL}`] = (init) => view(JSON.parse(String(init?.body)).style)
    renderWith(<AdminNodaroMotionPage />)
    expect(await styleSelect(/Prism/)).toHaveTextContent("Always Precise")
    await user.click(await styleSelect(/Prism/))
    await user.click(await screen.findByRole("option", { name: "Users choose (Precise or Flex)" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${STYLE_URL}`)).toEqual([{ style: { "motion-pulse": "flex" } }]))
  })

  it("greys out the forced choices, naming the environments, while one's engine cannot enforce them; Users choose stays", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [enforces("production", true)] } })
    routes[`GET ${STYLE_URL}`] = () => view({ "motion-pulse": "flex" })
    routes[`PUT ${STYLE_URL}`] = (init) => view(JSON.parse(String(init?.body)).style)
    renderWith(<AdminNodaroMotionPage />)
    const pulse = await styleSelect(/Pulse/)
    await waitFor(() => expect(pulse).toHaveAccessibleDescription(/wait for the engine in staging: this setting is shared by every environment/))
    await user.click(pulse)
    expect(await screen.findByRole("option", { name: "Always Precise (not supported yet: staging)" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("option", { name: "Always Flex (not supported yet: staging)" })).toHaveAttribute("aria-disabled", "true")
    const users = screen.getByRole("option", { name: "Users choose (Precise or Flex)" })
    expect(users).not.toHaveAttribute("aria-disabled", "true")
    await user.click(users)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${STYLE_URL}`)).toEqual([{ style: {} }]))
  })

  it("styleToSaved keeps only the forced engines", () => {
    expect(styleToSaved(null)).toEqual({})
    expect(styleToSaved({ "motion-prism": "user", "motion-pulse": "precise" })).toEqual({ "motion-pulse": "precise" })
  })
})
