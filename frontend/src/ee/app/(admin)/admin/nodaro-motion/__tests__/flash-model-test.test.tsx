/**
 * Admin → Video Remake → Test switches → the flash-model test.
 *
 * A test switch per engine, off by default: while on, a new run of that
 * engine started by an admin account is made on the faster model of the same
 * family; its hint says it affects only admin accounts' runs.
 * - Its block is closed until opened, and nothing is read before that.
 * - Never saved shows every engine off.
 * - A switch saves by itself, at once: the engines that are on, and off
 *   everywhere as an empty setting.
 * - It names the environments whose engine reads the shared setting, and says
 *   so where this environment's engine does not run the test.
 * - A refused save is said under the switches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))

import { fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import {
  FLASH_MODEL_TEST_HEADING,
  FLASH_MODEL_TEST_HINT,
  FLASH_MODEL_TEST_NAME,
  FLASH_MODEL_TEST_UNSUPPORTED,
  FlashModelTest,
  flashModelTestReadBy,
  flashModelToSaved,
} from "../components/FlashModelTest"

const URL = "/v1/admin/video-remake/flash-model"
const ENGINES = [
  { id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5" },
  { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4" },
]
const view = (flashModel: unknown = null, over: { supported?: boolean; environments?: string[] } = {}) => ({
  body: { data: { flashModel, updatedAt: flashModel ? "2026-11-20T10:00:00.000Z" : null, engines: ENGINES, supported: over.supported ?? true, environments: over.environments ?? ["staging"] } },
})

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${URL}`] = () => view()
  routes[`PUT ${URL}`] = (init) => view(JSON.parse(String(init?.body)).flashModel)
})
afterEach(() => vi.unstubAllGlobals())

const opener = () => screen.getByRole("button", { name: FLASH_MODEL_TEST_HEADING })
const group = () => screen.findByRole("group", { name: FLASH_MODEL_TEST_NAME })
const engineSwitch = async (engine: string) => within(await group()).findByRole("switch", { name: engine })
const reads = () => fetchMock.mock.calls.filter(([url, init]) => String(url).includes(URL) && (init?.method ?? "GET") === "GET").length

describe("Admin → Video Remake → the flash-model test", () => {
  it("is closed until opened, and reads nothing before that", async () => {
    renderWith(<FlashModelTest />)
    expect(opener()).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("group", { name: FLASH_MODEL_TEST_NAME })).toBeNull()
    expect(screen.queryByRole("switch")).toBeNull()
    expect(reads()).toBe(0)
  })

  it("opened: both engines off when never saved, its hint, and where the shared setting is read", async () => {
    const user = userEvent.setup()
    renderWith(<FlashModelTest />)
    await user.click(opener())
    expect(opener()).toHaveAttribute("aria-expanded", "true")
    for (const engine of ["Nodaro Prism", "Nodaro Pulse"]) {
      const toggle = await engineSwitch(engine)
      expect(toggle).not.toBeChecked()
      expect(toggle).toHaveAccessibleDescription(FLASH_MODEL_TEST_HINT)
    }
    expect(FLASH_MODEL_TEST_HINT).toMatch(/^For testing only\./)
    expect(FLASH_MODEL_TEST_HINT).toMatch(/It affects only runs started by admin accounts/)
    expect(FLASH_MODEL_TEST_HINT).toMatch(/Everyone else's runs are unchanged/)
    expect(within(await group()).getByText(flashModelTestReadBy(["staging"]))).toBeInTheDocument()
    expect(screen.queryByText(FLASH_MODEL_TEST_UNSUPPORTED)).toBeNull()
    expect(reads()).toBe(1)
  })

  it("a switch saves by itself: the engines that are on, and off again as an empty setting", async () => {
    const user = userEvent.setup()
    renderWith(<FlashModelTest />)
    await user.click(opener())
    await user.click(await engineSwitch("Nodaro Prism"))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ flashModel: { "nodaro-prism": "on" } }]))
    await waitFor(async () => expect(await engineSwitch("Nodaro Prism")).toBeChecked())
    expect(await engineSwitch("Nodaro Pulse")).not.toBeChecked()
    await waitFor(async () => expect(await engineSwitch("Nodaro Pulse")).toBeEnabled())
    await user.click(await engineSwitch("Nodaro Pulse"))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toHaveLength(2))
    expect(sentTo(`PUT ${URL}`)[1]).toEqual({ flashModel: { "nodaro-prism": "on", "nodaro-pulse": "on" } })
    await waitFor(async () => expect(await engineSwitch("Nodaro Pulse")).toBeChecked())
    await waitFor(async () => expect(await engineSwitch("Nodaro Prism")).toBeEnabled())
    await user.click(await engineSwitch("Nodaro Prism"))
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toHaveLength(3))
    expect(sentTo(`PUT ${URL}`)[2]).toEqual({ flashModel: { "nodaro-pulse": "on" } })
  })

  it("shows what is stored, names every environment that reads it, and says where this engine does not run it", async () => {
    routes[`GET ${URL}`] = () => view({ "nodaro-pulse": "on" }, { supported: false, environments: ["staging", "production"] })
    const user = userEvent.setup()
    renderWith(<FlashModelTest />)
    await user.click(opener())
    expect(await engineSwitch("Nodaro Pulse")).toBeChecked()
    expect(await engineSwitch("Nodaro Prism")).not.toBeChecked()
    expect(screen.getByText("Read by: staging, production. The setting is shared by every environment listed, for admin accounts' runs in each.")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent(FLASH_MODEL_TEST_UNSUPPORTED)
    expect(flashModelTestReadBy([])).toBe("No environment's engine reads this yet.")
  })

  it("says a refused save under the switches, and the switch stays as stored", async () => {
    routes[`PUT ${URL}`] = () => ({ status: 409, body: { error: { code: "engine_unsupported", message: "No Cast Swap engine runs the flash-model test yet: keep it off, or wait for the engine." } } })
    const user = userEvent.setup()
    renderWith(<FlashModelTest />)
    await user.click(opener())
    await user.click(await engineSwitch("Nodaro Prism"))
    expect(await screen.findByRole("alert")).toHaveTextContent(/No Cast Swap engine runs the flash-model test yet/)
    expect(await engineSwitch("Nodaro Prism")).not.toBeChecked()
  })

  it("the setting as saved lists only the engines that are on", () => {
    expect(flashModelToSaved(null)).toEqual({})
    expect(flashModelToSaved({ "nodaro-prism": "off", "nodaro-pulse": "on" })).toEqual({ "nodaro-pulse": "on" })
  })
})
