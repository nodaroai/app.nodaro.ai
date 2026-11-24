/**
 * Admin → Video Remake → Offer Flash, one of the page's settings (decided 2026-11-22).
 *
 * A switch per engine, off by default: while on, every user sees that engine's Flash choice next to it (Nodaro Prism Flash,
 * Nodaro Pulse Flash) at its own price; its hint says so.
 * - Never saved shows every engine off.
 * - A switch changes the page's draft only; its save (the page's Save, or a stored set's Save all) sends the engines
 *   that are on, and off everywhere as an empty setting.
 * - Its binding is the stored sets' way in: a loaded set's value fills the draft.
 * - It names the environments whose engine reads the shared setting, and says so where this environment's engine
 *   does not run the Flash choices.
 * - A refused save is said under the switches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))

import { fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import { FLASH_OFFER_HEADING, FLASH_OFFER_HINT, FLASH_OFFER_UNSUPPORTED, flashOfferReadBy, flashOfferToSaved } from "../components/FlashOfferSection"
import { useFlashOfferSection, type FlashOfferSectionState } from "../use-flash-offer-section"
import { MOTION_SETTINGS_KEYS, MOTION_SETTINGS_SPECS } from "../settings-sections"

const URL = "/v1/admin/video-remake/flash-offer"
const ENGINES = [
  { id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5", flashName: "Nodaro Prism Flash" },
  { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4", flashName: "Nodaro Pulse Flash" },
]
const PRISM = "Offer Nodaro Prism Flash (beside Nodaro Prism)"
const PULSE = "Offer Nodaro Pulse Flash (beside Nodaro Pulse)"
const view = (flashOffer: unknown = null, over: { supported?: boolean; environments?: string[] } = {}) => ({
  body: { data: { flashOffer, updatedAt: flashOffer ? "2026-11-22T10:00:00.000Z" : null, engines: ENGINES, supported: over.supported ?? true, environments: over.environments ?? ["staging"] } },
})

let state: FlashOfferSectionState
function Host() {
  state = useFlashOfferSection(false)
  return <>{state.node}</>
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${URL}`] = () => view()
  routes[`PUT ${URL}`] = (init) => view(JSON.parse(String(init?.body)).flashOffer)
})
afterEach(() => vi.unstubAllGlobals())

const group = () => screen.findByRole("group", { name: FLASH_OFFER_HEADING })
const engineSwitch = async (label: string) => within(await group()).findByRole("switch", { name: label })

describe("Admin → Video Remake → Offer Flash", () => {
  it("is a section of the stored settings sets, by the server's key", () => {
    expect(MOTION_SETTINGS_KEYS).toContain("flash-offer")
    const spec = MOTION_SETTINGS_SPECS["flash-offer"]
    expect(spec.bodyOf(spec.draftOf(null))).toEqual({ flashOffer: {} })
    expect(spec.bodyOf(spec.draftOf({ "nodaro-prism": "off", "nodaro-pulse": "on" }))).toEqual({ flashOffer: { "nodaro-pulse": "on" } })
  })

  it("both engines off when never saved, its hint, and where the shared setting is read", async () => {
    renderWith(<Host />)
    for (const label of [PRISM, PULSE]) {
      const toggle = await engineSwitch(label)
      expect(toggle).not.toBeChecked()
      expect(toggle).toHaveAccessibleDescription(FLASH_OFFER_HINT)
    }
    expect(FLASH_OFFER_HINT).toMatch(/every user sees its Flash choice next to it/)
    expect(FLASH_OFFER_HINT).not.toMatch(/admin accounts|testing/i)
    expect(within(await group()).getByText(flashOfferReadBy(["staging"]))).toBeInTheDocument()
    expect(screen.queryByText(FLASH_OFFER_UNSUPPORTED)).toBeNull()
  })

  it("a switch changes the draft only; the save sends the engines that are on, and off as an empty setting", async () => {
    const user = userEvent.setup()
    renderWith(<Host />)
    await user.click(await engineSwitch(PRISM))
    expect(await engineSwitch(PRISM)).toBeChecked()
    expect(state.changed).toBe(true)
    expect(sentTo(`PUT ${URL}`)).toEqual([])
    await act(async () => void (await state.save()))
    expect(sentTo(`PUT ${URL}`)).toEqual([{ flashOffer: { "nodaro-prism": "on" } }])
    await waitFor(() => expect(state.changed).toBe(false))
    await user.click(await engineSwitch(PRISM))
    await act(async () => void (await state.save()))
    expect(sentTo(`PUT ${URL}`)[1]).toEqual({ flashOffer: {} })
  })

  it("a loaded set's value fills the draft through its binding", async () => {
    renderWith(<Host />)
    await engineSwitch(PULSE)
    act(() => state.binding.load({ flashOffer: { "nodaro-pulse": "on" } }))
    expect(await engineSwitch(PULSE)).toBeChecked()
    expect(state.binding.draft).toEqual({ flashOffer: { "nodaro-pulse": "on" } })
    expect(state.binding.live).toEqual({ flashOffer: {} })
  })

  it("shows what is stored, names every environment that reads it, and says where this engine does not run it", async () => {
    routes[`GET ${URL}`] = () => view({ "nodaro-pulse": "on" }, { supported: false, environments: ["staging", "production"] })
    renderWith(<Host />)
    expect(await engineSwitch(PULSE)).toBeChecked()
    expect(await engineSwitch(PRISM)).not.toBeChecked()
    expect(screen.getByText("Read by: staging, production. The setting is shared by every environment listed: turning a switch on offers that Flash choice to every user of each.")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(FLASH_OFFER_UNSUPPORTED)
    expect(flashOfferReadBy([])).toBe("No environment's engine reads this yet.")
  })

  it("says a refused save under the switches", async () => {
    routes[`PUT ${URL}`] = () => ({ status: 409, body: { error: { code: "engine_unsupported", message: "No Cast Swap engine runs the Flash choices yet: keep Offer Flash off, or wait for the engine." } } })
    const user = userEvent.setup()
    renderWith(<Host />)
    await user.click(await engineSwitch(PRISM))
    await act(async () => {
      await state.save().catch(() => undefined)
    })
    expect(await screen.findByRole("alert")).toHaveTextContent(/No Cast Swap engine runs the Flash choices yet/)
  })

  it("the setting as saved lists only the engines that are on", () => {
    expect(flashOfferToSaved(null)).toEqual({})
    expect(flashOfferToSaved({ "nodaro-prism": "off", "nodaro-pulse": "on" })).toEqual({ "nodaro-pulse": "on" })
  })
})
