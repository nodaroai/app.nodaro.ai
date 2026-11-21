/**
 * Admin → Video Remake → 3D previz clips, and the shot lock.
 *
 * 3D previz clips: whether this deployment accepts a run whose clip is a 3D
 * previz, rendered into its look instead of edited.
 * - The switch shows the resolved value and names the deployment's default;
 *   Save sends `enabled` only once an admin chose a value (stored, or off the
 *   default), so the default keeps deciding otherwise.
 * - Where this environment's engine takes no such clip, it says so and the
 *   switch still saves.
 *
 * The shot lock: per engine, whether a run's prompt carries the line that
 * keeps the shot order (by run type: shot-lock-run-types.test.tsx; here, the
 * setting while no engine reads run types: Ordinary run and Art style +
 * roles move together, saved as "on").
 * - Off for every engine until it is turned on; Save sends the engines that
 *   are on, and off everywhere as an empty setting.
 * - Its hint says what the line does; a refused save is said under it.
 * - The engine prompt's previews follow a change that is not saved yet, and
 *   are asked as before while nothing changed.
 * - Prism has a "3D previz" tab while the engine lists the key; Pulse never.
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
import { PREVIZ_HEADING, PREVIZ_SWITCH_LABEL, PREVIZ_SWITCH_NAME, PREVIZ_UNSUPPORTED, previzSwitchHint, previzToSaved } from "../components/PrevizSection"
import { SHOT_LOCK_HEADING, SHOT_LOCK_HINT, SHOT_LOCK_RUN_TYPES_UNOFFERED, SHOT_LOCK_UNSUPPORTED, shotLockToSaved } from "../components/ShotLockSection"
import { PLAN_ROLES_SWITCH_LABEL } from "../components/PlanRolesSection"
import { shotLockChanges } from "../use-shot-lock-section"
import { tabsOf } from "../components/PromptPartsTabs"

const PREVIZ_URL = "/v1/admin/video-remake/previz"
const SHOT_LOCK_URL = "/v1/admin/video-remake/shot-lock"
const PREVIEW = "POST /v1/admin/video-remake/prompt-parts/preview"
const ENGINES = [
  { id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5" },
  { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4" },
]
const RUNS_TOAST = "Saved. Runs pick it up within a minute."

interface PrevizOver {
  previz?: unknown
  enabledByDefault?: boolean
  supported?: boolean
}
/** The previz GET's answer: `enabled` resolved as the server resolves it. */
const previzView = ({ previz = null, enabledByDefault = true, supported = true }: PrevizOver = {}) => {
  const chosen = (previz as { enabled?: unknown } | null)?.enabled
  return { body: { data: { previz, enabled: typeof chosen === "boolean" ? chosen : enabledByDefault, enabledByDefault, updatedAt: previz ? "2026-11-19T10:00:00.000Z" : null, supported } } }
}
const shotLockView = (shotLock: unknown = null, supported = true) => ({ body: { data: { shotLock, updatedAt: shotLock ? "2026-11-19T10:00:00.000Z" : null, engines: ENGINES, supported } } })

beforeEach(() => {
  resetRoutes()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.stubGlobal("fetch", fetchMock)
  routes["GET /v1/admin/video-remake/masking"] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/video-remake/style"] = () => ({ body: { data: { style: null, updatedAt: null, engines: ENGINES, supported: true } } })
  routes["GET /v1/admin/video-remake/prompt-parts"] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion", "previz"] } } })
  routes[PREVIEW] = () => ({ body: { data: { set: "precise", parts: [], assembled: "", length: 0, max: 8000, problems: [] } } })
  routes["GET /v1/admin/video-remake/motion"] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes["GET /v1/admin/video-remake/pulse-audio"] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/video-remake/prism-reference-audio"] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/video-remake/pulse-reference-audio"] = () => ({ body: { data: { pulseReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/video-remake/steps"] = () => ({ body: { data: { steps: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/video-remake/advanced"] = () => ({ body: { data: { show: false, updatedAt: null } } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: ENVIRONMENTS } })
  // The custom style and the roles from the prompt on an engine that takes neither: they ask nothing of their own.
  routes["GET /v1/admin/video-remake/custom-style"] = () => ({ body: { data: { customStyle: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  routes["GET /v1/admin/video-remake/plan-roles"] = () => ({ body: { data: { planRoles: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  routes[`GET ${PREVIZ_URL}`] = () => previzView()
  routes[`PUT ${PREVIZ_URL}`] = (init) => previzView({ previz: JSON.parse(String(init?.body)).previz })
  routes[`GET ${SHOT_LOCK_URL}`] = () => shotLockView()
  routes[`PUT ${SHOT_LOCK_URL}`] = (init) => shotLockView(JSON.parse(String(init?.body)).shotLock)
})
afterEach(() => vi.unstubAllGlobals())

const previzSwitch = () => screen.findByRole("switch", { name: PREVIZ_SWITCH_NAME })
const shotLockGroup = () => screen.findByRole("group", { name: SHOT_LOCK_HEADING })
const shotLockSwitch = async (engine: string) => within(await shotLockGroup()).findByRole("switch", { name: `${engine} Ordinary run` })
const saveButton = () => screen.getByRole("button", { name: "Save" })
/** The previews asked for one engine and style, in order. */
const previewsOf = (engine: string, style: string) => (sentTo(PREVIEW) as Array<Record<string, unknown>>).filter((b) => b.engine === engine && b.style === style)

describe("Admin → Video Remake → 3D previz clips", () => {
  it("shows the resolved switch in its own block and names this deployment's default (on), Save off", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await previzSwitch()
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleDescription(previzSwitchHint(true))
    expect(previzSwitchHint(true)).toMatch(/3D previz .* instead of editing it\. Nodaro Prism only\. This deployment's default: on\.$/)
    expect(screen.getByRole("group", { name: PREVIZ_HEADING })).toContainElement(toggle)
    expect(screen.queryByText(PREVIZ_UNSUPPORTED)).toBeNull()
    expect(saveButton()).toBeDisabled()
    // It reads "Offered", as the roles' switch does; its name adds its block's heading, so the two are told apart.
    expect(within(screen.getByRole("group", { name: PREVIZ_HEADING })).getByText(PREVIZ_SWITCH_LABEL)).toBeInTheDocument()
    expect(PREVIZ_SWITCH_LABEL).toBe("Offered")
    expect(PREVIZ_SWITCH_NAME).toBe("3D previz clips Offered")
    expect(screen.getAllByRole("switch", { name: PLAN_ROLES_SWITCH_LABEL })).toHaveLength(1)
  })

  it("on a deployment whose default is off, shows it off and says so", async () => {
    routes[`GET ${PREVIZ_URL}`] = () => previzView({ enabledByDefault: false })
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await previzSwitch()
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(previzSwitchHint(false))
    expect(previzSwitchHint(false)).toMatch(/This deployment's default: off\.$/)
  })

  it("saves the switch alone with `enabled` when it leaves the default; back to the default unsaved is no change", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await previzSwitch()
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(saveButton()).toBeEnabled()
    // Back at the deployment's default with nothing saved: `enabled` stays left out, nothing to save.
    await user.click(toggle)
    expect(saveButton()).toBeDisabled()
    await user.click(toggle)
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${PREVIZ_URL}`)).toEqual([{ previz: { enabled: false } }]))
    expect(sentTo(`PUT ${SHOT_LOCK_URL}`)).toEqual([])
    expect(sentTo("PUT /v1/admin/video-remake/plan-roles")).toEqual([])
    expect(sentTo("PUT /v1/admin/video-remake/masking")).toEqual([])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(RUNS_TOAST))
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(await previzSwitch()).not.toBeChecked()
  })

  it("keeps sending `enabled` once a choice is stored, the default's value included", async () => {
    const user = userEvent.setup()
    routes[`GET ${PREVIZ_URL}`] = () => previzView({ previz: { enabled: false } })
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await previzSwitch()
    await waitFor(() => expect(toggle).not.toBeChecked())
    await user.click(toggle)
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${PREVIZ_URL}`)).toEqual([{ previz: { enabled: true } }]))
  })

  it("where this environment's engine takes no 3D previz clip: says so, and still saves the switch", async () => {
    const user = userEvent.setup()
    routes[`GET ${PREVIZ_URL}`] = () => previzView({ supported: false })
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await previzSwitch()
    expect(within(screen.getByRole("group", { name: PREVIZ_HEADING })).getByRole("status")).toHaveTextContent(PREVIZ_UNSUPPORTED)
    await user.click(toggle)
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${PREVIZ_URL}`)).toEqual([{ previz: { enabled: false } }]))
  })

  it("previzToSaved keeps the switch only when it is a choice", () => {
    expect(previzToSaved(null)).toEqual({})
    expect(previzToSaved({})).toEqual({})
    expect(previzToSaved({ enabled: false })).toEqual({ enabled: false })
    expect(previzToSaved({ enabled: true })).toEqual({ enabled: true })
  })
})

describe("Admin → Video Remake → Shot lock", () => {
  it("shows each engine's Ordinary run switch, off, under the hint that says what the line does", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const prism = await shotLockSwitch("Nodaro Prism")
    const pulse = await shotLockSwitch("Nodaro Pulse")
    expect(prism).not.toBeChecked()
    expect(pulse).not.toBeChecked()
    expect(prism).toHaveAccessibleDescription("A run with no art style.")
    expect(within(await shotLockGroup()).getByRole("group", { name: "Nodaro Prism" })).toHaveAccessibleDescription(SHOT_LOCK_HINT)
    expect(SHOT_LOCK_HINT).toMatch(/^Adds a line to the prompt that tells the engine to keep the clip's shot order and not add shots\./)
    // No engine reads run types here: said once, and nothing else.
    expect(within(await shotLockGroup()).getAllByRole("status").map((n) => n.textContent)).toEqual([SHOT_LOCK_RUN_TYPES_UNOFFERED])
    expect(saveButton()).toBeDisabled()
  })

  it("shows what is stored, and saves the engines that are on", async () => {
    const user = userEvent.setup()
    routes[`GET ${SHOT_LOCK_URL}`] = () => shotLockView({ "nodaro-pulse": "on" })
    renderWith(<AdminNodaroMotionPage />)
    const pulse = await shotLockSwitch("Nodaro Pulse")
    await waitFor(() => expect(pulse).toBeChecked())
    const prism = await shotLockSwitch("Nodaro Prism")
    expect(prism).not.toBeChecked()
    await user.click(prism)
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${SHOT_LOCK_URL}`)).toEqual([{ shotLock: { "nodaro-pulse": "on", "nodaro-prism": "on" } }]))
    expect(sentTo(`PUT ${PREVIZ_URL}`)).toEqual([])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(RUNS_TOAST))
    await waitFor(() => expect(saveButton()).toBeDisabled())
  })

  it("turning the last engine off saves an empty setting; on and off again unsaved is no change", async () => {
    const user = userEvent.setup()
    routes[`GET ${SHOT_LOCK_URL}`] = () => shotLockView({ "nodaro-prism": "on" })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await shotLockSwitch("Nodaro Prism")
    await waitFor(() => expect(prism).toBeChecked())
    const pulse = await shotLockSwitch("Nodaro Pulse")
    await user.click(pulse)
    await user.click(pulse)
    expect(saveButton()).toBeDisabled()
    await user.click(prism)
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${SHOT_LOCK_URL}`)).toEqual([{ shotLock: {} }]))
  })

  it("a refused save is said under the switches and as a toast, and the switch keeps its draft", async () => {
    const user = userEvent.setup()
    const message = "No Cast Swap engine writes the shot lock yet: keep it off, or wait for the engine."
    routes[`PUT ${SHOT_LOCK_URL}`] = () => ({ status: 409, body: { error: { code: "engine_unsupported", message } } })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await shotLockSwitch("Nodaro Prism")
    await user.click(prism)
    await user.click(saveButton())
    expect(await within(await shotLockGroup()).findByRole("alert")).toHaveTextContent(message)
    expect(toast.error).toHaveBeenCalledWith(message)
    expect(prism).toBeChecked()
  })

  it("where this environment's engine does not write the line, says so", async () => {
    routes[`GET ${SHOT_LOCK_URL}`] = () => shotLockView(null, false)
    renderWith(<AdminNodaroMotionPage />)
    expect(await within(await shotLockGroup()).findByRole("status")).toHaveTextContent(SHOT_LOCK_UNSUPPORTED)
  })

  it("shotLockToSaved keeps the engines that are on; shotLockChanges names what a draft changes", () => {
    expect(shotLockToSaved(null)).toEqual({})
    expect(shotLockToSaved({ "nodaro-prism": "off", "nodaro-pulse": "on" })).toEqual({ "nodaro-pulse": "on" })
    expect(shotLockChanges({}, {})).toEqual({})
    expect(shotLockChanges({ "nodaro-prism": "on" }, { "nodaro-prism": "on" })).toEqual({})
    expect(shotLockChanges({ "nodaro-prism": "on" }, {})).toEqual({ "nodaro-prism": { ordinary: "on" } })
    expect(shotLockChanges({}, { "nodaro-pulse": "on" })).toEqual({ "nodaro-pulse": { ordinary: "off" } })
  })
})

describe("the engine prompt beside them", { timeout: 20_000 }, () => {
  it("previews are asked without a shot lock while nothing changed, and with the change once a switch moves", async () => {
    const user = userEvent.setup()
    routes[`GET ${SHOT_LOCK_URL}`] = () => shotLockView({ "nodaro-pulse": "on" })
    renderWith(<AdminNodaroMotionPage />)
    await waitFor(() => expect(previewsOf("nodaro-prism", "precise").length).toBeGreaterThan(0))
    for (const body of sentTo(PREVIEW) as Array<Record<string, unknown>>) expect(body).not.toHaveProperty("shotLock")
    // Prism on (a change), Pulse off (a change): each engine's Precise preview is asked again with its own value.
    await user.click(await shotLockSwitch("Nodaro Prism"))
    await waitFor(() => expect(previewsOf("nodaro-prism", "precise").at(-1)).toMatchObject({ shotLock: "on" }))
    await user.click(await shotLockSwitch("Nodaro Pulse"))
    await waitFor(() => expect(previewsOf("nodaro-pulse", "precise").at(-1)).toMatchObject({ shotLock: "off" }))
  })

  it("Prism has a 3D previz tab while the engine lists the key, never Pulse, and its preview sends no shot lock", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const prism = (await screen.findByRole("heading", { name: /^Engine prompt: Nodaro Prism/ })).closest("section") as HTMLElement
    const pulse = (await screen.findByRole("heading", { name: /^Engine prompt: Nodaro Pulse/ })).closest("section") as HTMLElement
    expect(within(pulse).queryByRole("tab", { name: "3D previz" })).toBeNull()
    await user.click(await shotLockSwitch("Nodaro Prism"))
    await user.click(within(prism).getByRole("tab", { name: "3D previz" }))
    await waitFor(() => expect(previewsOf("nodaro-prism", "previz").length).toBeGreaterThan(0))
    for (const body of previewsOf("nodaro-prism", "previz")) expect(body).toEqual({ engine: "nodaro-prism", style: "previz", overrides: {} })
    expect(tabsOf("nodaro-prism", ["precise", "motion", "styleOnly", "previz"])).toEqual(["precise", "motion", "styleOnly", "previz"])
    expect(tabsOf("nodaro-pulse", ["precise", "motion", "styleOnly", "previz"])).toEqual(["precise", "motion"])
    expect(tabsOf("nodaro-prism", ["precise", "motion"])).toEqual(["precise", "motion"])
  })
})
