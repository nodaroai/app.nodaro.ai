/**
 * Admin → Video Remake → Precise upscale (Topaz), under the Prism engine: per
 * output resolution, Off or the Topaz target a direct Precise run's take is
 * upscaled to before it is scaled back.
 *
 * - Three rows (480p, 720p, 1080p), each a select of Off and the Topaz targets
 *   that resolution takes, its default marked; never saved, each shows its default.
 * - The note says it is Precise only, scaled back, and priced into the run.
 * - Save sends the whole setting; keeping the defaults is no change.
 * - Where this environment's engine runs no upscale, it says so and still saves.
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
  PRECISE_UPSCALE_HEADING,
  PRECISE_UPSCALE_NOTE,
  PRECISE_UPSCALE_TOPAZ_DISABLED,
  PRECISE_UPSCALE_UNSUPPORTED,
  preciseUpscaleEffective,
  preciseUpscaleOptionLabel,
} from "../components/PreciseUpscaleSection"
import { MOTION_SETTINGS_KEYS, PRECISE_UPSCALE_SPEC } from "../settings-sections"

const URL = "/v1/admin/video-remake/precise-upscale"
const ENGINES = [
  { id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5" },
  { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4" },
]
const DEFAULTS = { "480p": "1080p", "720p": "1080p", "1080p": "4k" } as const

interface Over {
  stored?: Record<string, string> | null
  supported?: boolean
  topazDisabled?: boolean
}
const view = ({ stored = null, supported = true, topazDisabled = false }: Over = {}) => ({
  body: { data: { value: { ...DEFAULTS, ...(stored ?? {}) }, stored, defaults: DEFAULTS, updatedAt: stored ? "2026-11-22T10:00:00.000Z" : null, supported, topazDisabled } },
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
  routes["GET /v1/admin/video-remake/shot-list-fps"] = () => ({ body: { data: { shotListFps: null, fps: 6, defaultFps: 6, options: [1, 2, 3, 4, 6, 8, 12], updatedAt: null, supported: false, rateCarried: true } } })
  routes[`GET ${URL}`] = () => view()
  routes[`PUT ${URL}`] = (init) => view({ stored: JSON.parse(String(init?.body)).preciseUpscale })
})
afterEach(() => vi.unstubAllGlobals())

const group = () => screen.findByRole("group", { name: PRECISE_UPSCALE_HEADING })
const select = async (r: string) => within(await group()).findByRole("combobox", { name: `${PRECISE_UPSCALE_HEADING} ${r}` })
const saveButton = () => screen.getByRole("button", { name: "Save" })

describe("the setting as it is saved and named", () => {
  it("fills each resolution never saved with its default, and keeps a stored choice", () => {
    expect(preciseUpscaleEffective(null)).toEqual(DEFAULTS)
    expect(preciseUpscaleEffective({ "720p": "off" })).toEqual({ ...DEFAULTS, "720p": "off" })
    // A choice that resolution does not take reads as its default.
    expect(preciseUpscaleEffective({ "1080p": "720p" } as never)).toEqual(DEFAULTS)
    expect(PRECISE_UPSCALE_SPEC.bodyOf(PRECISE_UPSCALE_SPEC.draftOf(null))).toEqual({ preciseUpscale: DEFAULTS })
    expect(MOTION_SETTINGS_KEYS).toContain("precise-upscale")
  })

  it("names Off and each Topaz target, the default marked", () => {
    expect(["off", "720p", "1080p", "4k"].map((c) => preciseUpscaleOptionLabel(c, "1080p"))).toEqual(["Off", "Topaz 720p", "Topaz 1080p (default)", "Topaz 4k"])
    expect(PRECISE_UPSCALE_NOTE).toBe("Precise runs only. Topaz upscales the result, then it is scaled back to the run's resolution. Its cost is added to the run's price.")
  })
})

describe("Admin → Video Remake → Precise upscale (Topaz)", () => {
  it("never saved: three rows at their defaults under Prism, with the note, Save off", async () => {
    renderWith(<AdminNodaroMotionPage />)
    expect(await select("480p")).toHaveTextContent("Topaz 1080p (default)")
    expect(await select("720p")).toHaveTextContent("Topaz 1080p (default)")
    expect(await select("1080p")).toHaveTextContent("Topaz 4k (default)")
    expect(await select("720p")).toHaveAccessibleDescription(PRECISE_UPSCALE_NOTE)
    expect(screen.queryByText(PRECISE_UPSCALE_UNSUPPORTED)).toBeNull()
    expect(saveButton()).toBeDisabled()
  })

  it("offers each resolution only the targets it takes", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await select("1080p"))
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Off", "Topaz 1080p", "Topaz 4k (default)"])
  })

  it("Save sends the whole setting; picking the default back is no change", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await select("480p"))
    await user.click(await screen.findByRole("option", { name: "Off" }))
    expect(saveButton()).toBeEnabled()
    await user.click(await select("480p"))
    await user.click(await screen.findByRole("option", { name: "Topaz 1080p (default)" }))
    expect(saveButton()).toBeDisabled()
    await user.click(await select("720p"))
    await user.click(await screen.findByRole("option", { name: "Topaz 4k" }))
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL}`)).toEqual([{ preciseUpscale: { "480p": "1080p", "720p": "4k", "1080p": "4k" } }]))
    expect(toast.success).toHaveBeenCalled()
    await waitFor(() => expect(saveButton()).toBeDisabled())
  })

  it("says so while this deployment withholds Topaz, and not otherwise", async () => {
    routes[`GET ${URL}`] = () => view({ topazDisabled: true })
    const first = renderWith(<AdminNodaroMotionPage />)
    expect(await within(await group()).findByRole("status")).toHaveTextContent(PRECISE_UPSCALE_TOPAZ_DISABLED)
    expect(PRECISE_UPSCALE_TOPAZ_DISABLED).toMatch(/^Topaz is disabled on this deployment/)
    first.unmount()
    routes[`GET ${URL}`] = () => view()
    renderWith(<AdminNodaroMotionPage />)
    await select("480p")
    expect(screen.queryByText(PRECISE_UPSCALE_TOPAZ_DISABLED)).toBeNull()
  })

  it("says so where the engine runs no upscale; the selects still work", async () => {
    routes[`GET ${URL}`] = () => view({ supported: false })
    renderWith(<AdminNodaroMotionPage />)
    expect(await within(await group()).findByRole("status")).toHaveTextContent(PRECISE_UPSCALE_UNSUPPORTED)
    expect(await select("480p")).toBeEnabled()
  })
})
