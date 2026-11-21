/**
 * Admin → Video Remake → Shot list frame rate: how many frames of each second
 * the model that writes a run's shot list is shown of the clip.
 *
 * - The select shows the rate in effect and marks the recommended one; never
 *   saved, that is the engine's default.
 * - Its hint says what a low rate loses and what a higher one costs.
 * - Save sends `fps` only once an admin chose a rate (stored, or off the
 *   default), so the engine's default keeps deciding otherwise.
 * - Where this environment's engine reads no rate, or this deployment cannot
 *   carry one, it says so and the rate still saves.
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
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import {
  SHOT_LIST_FPS_HEADING,
  SHOT_LIST_FPS_LABEL,
  SHOT_LIST_FPS_NOT_CARRIED,
  SHOT_LIST_FPS_UNSUPPORTED,
  shotListFpsHint,
  shotListFpsOptionLabel,
  shotListFpsToSaved,
} from "../components/ShotListFpsSection"
import { MOTION_SETTINGS_KEYS, SHOT_LIST_FPS_SPEC } from "../settings-sections"

const URL = "/v1/admin/video-remake/shot-list-fps"
const OPTIONS = [1, 2, 3, 4, 6, 8, 12]
const ENGINES = [
  { id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5" },
  { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4" },
]
const RUNS_TOAST = "Saved. Runs pick it up within a minute."

interface Over {
  shotListFps?: { fps?: number } | null
  supported?: boolean
  rateCarried?: boolean
}
/** The GET's answer: `fps` resolved as the server resolves it. */
const view = ({ shotListFps = null, supported = true, rateCarried = true }: Over = {}) => ({
  body: { data: { shotListFps, fps: shotListFps?.fps ?? 6, defaultFps: 6, options: OPTIONS, updatedAt: shotListFps ? "2026-11-20T10:00:00.000Z" : null, supported, rateCarried } },
})

beforeEach(() => {
  resetRoutes()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.stubGlobal("fetch", fetchMock)
  routes["GET /v1/admin/video-remake/masking"] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/video-remake/style"] = () => ({ body: { data: { style: null, updatedAt: null, engines: ENGINES, supported: true } } })
  routes["GET /v1/admin/video-remake/prompt-parts"] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion"] } } })
  routes["POST /v1/admin/video-remake/prompt-parts/preview"] = () => ({ body: { data: { set: "precise", parts: [], assembled: "", length: 0, max: 8000, problems: [] } } })
  routes["GET /v1/admin/video-remake/motion"] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes["GET /v1/admin/video-remake/pulse-audio"] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/video-remake/prism-reference-audio"] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/video-remake/pulse-reference-audio"] = () => ({ body: { data: { pulseReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/video-remake/steps"] = () => ({ body: { data: { steps: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/video-remake/advanced"] = () => ({ body: { data: { show: false, updatedAt: null } } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
  routes["GET /v1/admin/video-remake/custom-style"] = () => ({ body: { data: { customStyle: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  routes["GET /v1/admin/video-remake/plan-roles"] = () => ({ body: { data: { planRoles: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  routes["GET /v1/admin/video-remake/previz"] = () => ({ body: { data: { previz: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  routes["GET /v1/admin/video-remake/shot-lock"] = () => ({ body: { data: { shotLock: null, updatedAt: null, engines: ENGINES, supported: false } } })
  routes[`GET ${URL}`] = () => view()
  routes[`PUT ${URL}`] = (init) => view({ shotListFps: JSON.parse(String(init?.body)).shotListFps })
})
afterEach(() => vi.unstubAllGlobals())

const group = () => screen.findByRole("group", { name: SHOT_LIST_FPS_HEADING })
const select = async () => within(await group()).findByRole("combobox", { name: `${SHOT_LIST_FPS_HEADING} ${SHOT_LIST_FPS_LABEL}` })
const saveButton = () => screen.getByRole("button", { name: "Save" })

describe("the setting as it is saved and named", () => {
  it("keeps the rate only when an admin chose one", () => {
    expect(shotListFpsToSaved({ fps: 4 })).toEqual({ fps: 4 })
    expect(shotListFpsToSaved({})).toEqual({})
    expect(shotListFpsToSaved(null)).toEqual({})
    expect(SHOT_LIST_FPS_SPEC.bodyOf(SHOT_LIST_FPS_SPEC.draftOf({ fps: 8 }))).toEqual({ shotListFps: { fps: 8 } })
    expect(SHOT_LIST_FPS_SPEC.bodyOf(SHOT_LIST_FPS_SPEC.draftOf(null))).toEqual({ shotListFps: {} })
    expect(MOTION_SETTINGS_KEYS).toContain("shot-list-fps")
  })

  it("names the recommended rate and what 1 is, and the hint says what a higher rate costs", () => {
    expect(OPTIONS.map((fps) => shotListFpsOptionLabel(fps, 6))).toEqual(["1 (as before this setting)", "2", "3", "4", "6 (recommended)", "8", "12"])
    const hint = shotListFpsHint(6)
    expect(hint).toMatch(/^How many frames of each second the model that writes a run's shot list is shown\./)
    expect(hint).toContain("a shot shorter than a second can fall between two frames")
    expect(hint).toContain("Cost: that one call reads as many times more frames as the rate (6 sends 6 times the frames of 1)")
    expect(hint).toContain("any rate above 1 runs it on the model provider's own API, at that API's price")
    expect(hint).toMatch(/Recommended: 6\.$/)
  })
})

describe("Admin → Video Remake → Shot list frame rate", () => {
  it("never saved: shows the recommended rate in its own block, with its hint, Save off", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const control = await select()
    expect(control).toHaveTextContent("6 (recommended)")
    expect(control).toHaveAccessibleDescription(shotListFpsHint(6))
    expect(screen.queryByText(SHOT_LIST_FPS_UNSUPPORTED)).toBeNull()
    expect(screen.queryByText(SHOT_LIST_FPS_NOT_CARRIED)).toBeNull()
    expect(saveButton()).toBeDisabled()
  })

  it("offers every rate, the recommended one marked", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await select())
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["1 (as before this setting)", "2", "3", "4", "6 (recommended)", "8", "12"])
  })

  it("Save sends the rate an admin picked, and nothing more", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await select())
    await user.click(await screen.findByRole("option", { name: "4" }))
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ shotListFps: { fps: 4 } }]))
    expect(toast.success).toHaveBeenCalledWith(RUNS_TOAST)
    expect(await select()).toHaveTextContent("4")
    await waitFor(() => expect(saveButton()).toBeDisabled())
  })

  it("picking the recommended rate again with none saved is no change; with one saved it is stored as chosen", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await select())
    await user.click(await screen.findByRole("option", { name: "2" }))
    expect(saveButton()).toBeEnabled()
    await user.click(await select())
    await user.click(await screen.findByRole("option", { name: "6 (recommended)" }))
    expect(saveButton()).toBeDisabled()
  })

  it("a saved rate shows as chosen, and going back to the recommended one saves it as a choice", async () => {
    routes[`GET ${URL}`] = () => view({ shotListFps: { fps: 2 } })
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    expect(await select()).toHaveTextContent("2")
    await user.click(await select())
    await user.click(await screen.findByRole("option", { name: "6 (recommended)" }))
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ shotListFps: { fps: 6 } }]))
  })

  it("says so where the engine reads no rate, or the deployment cannot carry one; the select still works", async () => {
    routes[`GET ${URL}`] = () => view({ supported: false })
    const first = renderWith(<AdminNodaroMotionPage />)
    expect(await within(await group()).findByRole("status")).toHaveTextContent(SHOT_LIST_FPS_UNSUPPORTED)
    expect(await select()).toBeEnabled()
    first.unmount()
    routes[`GET ${URL}`] = () => view({ rateCarried: false })
    renderWith(<AdminNodaroMotionPage />)
    expect(await within(await group()).findByRole("status")).toHaveTextContent(SHOT_LIST_FPS_NOT_CARRIED)
  })

  it("a refused save is said under the select, and in the toast", async () => {
    routes[`PUT ${URL}`] = () => ({ status: 400, body: { error: { code: "validation_error", message: "The frame rate must be one of 1, 2, 3, 4, 6, 8, 12." } } })
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await select())
    await user.click(await screen.findByRole("option", { name: "12" }))
    await user.click(saveButton())
    expect(await within(await group()).findByRole("alert")).toHaveTextContent("The frame rate must be one of 1, 2, 3, 4, 6, 8, 12.")
    expect(toast.error).toHaveBeenCalled()
  })
})
