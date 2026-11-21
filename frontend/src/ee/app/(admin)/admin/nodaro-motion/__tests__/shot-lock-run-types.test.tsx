/**
 * Admin → Video Remake → Shot lock, by run type.
 *
 * Per engine, a switch per kind of run — Ordinary run (no art style), Art
 * style + roles, Art style alone (a style-only run) — and "Except styles":
 * art styles whose own on/off wins over the two art-style rows.
 *
 * What must hold:
 * - Prism has the three rows and the exceptions; Pulse takes no art style, so
 *   its two art-style rows read "n/a" and nothing is stored for them;
 * - each row says plainly what it is, and Art style alone says it is new;
 * - everything is off by default, and the value of before run types ("on")
 *   shows as Ordinary run and Art style + roles on, Art style alone off;
 * - Save sends the server's stored form: only what is on, a draft that says
 *   exactly what "on" says as "on", every exception as listed;
 * - an exception is picked from the style catalog's video list (or the
 *   custom style), joins the list off, has its own switch and can be removed;
 *   one whose style this build's catalog lacks is shown by its id and kept;
 * - while no environment's engine reads run types, only Ordinary run is a
 *   control (it moves Art style + roles with it, saved as "on") and the page
 *   says why; once one does, a note names the environments that do not;
 * - a refused save is said under the switches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import {
  SHOT_LOCK_ADD_STYLE,
  SHOT_LOCK_CUSTOM_STYLE,
  SHOT_LOCK_CUSTOM_STYLE_LABEL,
  SHOT_LOCK_EXCEPTIONS_HINT,
  SHOT_LOCK_EXCEPTIONS_LABEL,
  SHOT_LOCK_HEADING,
  SHOT_LOCK_HINT,
  SHOT_LOCK_NOT_APPLICABLE,
  SHOT_LOCK_RUN_TYPES,
  SHOT_LOCK_RUN_TYPES_UNOFFERED,
  shotLockNoStyleHint,
  shotLockResolved,
  shotLockRunTypesMissing,
  shotLockStyleLabel,
  shotLockStyleOptions,
  shotLockToSaved,
} from "../components/ShotLockSection"
import { shotLockChanges } from "../use-shot-lock-section"
import { MOTION_SETTINGS_SPECS } from "../settings-sections"

const SHOT_LOCK_URL = "/v1/admin/video-remake/shot-lock"
const ENGINES = [
  { id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5" },
  { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4" },
]
const OFFERED = { offered: true, missingIn: [] as string[] }
const view = (shotLock: unknown = null, runTypes: { offered: boolean; missingIn: string[] } = OFFERED, supported = true) => ({
  body: { data: { shotLock, updatedAt: shotLock ? "2026-11-20T10:00:00.000Z" : null, engines: ENGINES, supported, runTypes } },
})

beforeEach(() => {
  resetRoutes()
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
  routes["GET /v1/admin/video-remake/previz"] = () => ({ body: { data: { previz: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: true } } })
  routes[`GET ${SHOT_LOCK_URL}`] = () => view()
  routes[`PUT ${SHOT_LOCK_URL}`] = (init) => view(JSON.parse(String(init?.body)).shotLock)
})
afterEach(() => vi.unstubAllGlobals())

const group = () => screen.findByRole("group", { name: SHOT_LOCK_HEADING })
const row = async (engine: string, label: string) => within(await group()).findByRole("switch", { name: `${engine} ${label}` })
const exceptions = async () => within(await group()).findByRole("group", { name: `Nodaro Prism ${SHOT_LOCK_EXCEPTIONS_LABEL}` })
const exception = async (label: string) => within(await exceptions()).findByRole("switch", { name: `Nodaro Prism ${SHOT_LOCK_EXCEPTIONS_LABEL}: ${label}` })
const addStyle = async () => within(await exceptions()).findByRole("combobox", { name: `Nodaro Prism: ${SHOT_LOCK_ADD_STYLE}` })
const saveButton = () => screen.getByRole("button", { name: "Save" })
const sent = () => sentTo(`PUT ${SHOT_LOCK_URL}`)

describe("Admin → Video Remake → Shot lock, by run type", () => {
  it("names the three rows and says plainly what each is; Art style alone says it is new", () => {
    expect(SHOT_LOCK_RUN_TYPES.map((t) => [t.key, t.label])).toEqual([
      ["ordinary", "Ordinary run"],
      ["styleWithRoles", "Art style + roles"],
      ["styleAlone", "Art style alone"],
    ])
    expect(SHOT_LOCK_RUN_TYPES[0].hint).toBe("A run with no art style.")
    expect(SHOT_LOCK_RUN_TYPES[1].hint).toMatch(/art style together with roles or references/)
    expect(SHOT_LOCK_RUN_TYPES[2].hint).toMatch(/^A style-only run: an art style and nothing to swap.*New: the line was never sent on such a run before\.$/)
    expect(SHOT_LOCK_HINT).toMatch(/Off by default/)
    expect(SHOT_LOCK_HINT).toMatch(/Trends keep their own prompt, and a 3D previz run never carries the line\.$/)
    expect(SHOT_LOCK_EXCEPTIONS_HINT).toMatch(/follows its own switch/)
  })

  it("Prism has the three switches, all off, each described; Pulse has Ordinary run and two rows that read n/a", async () => {
    renderWith(<AdminNodaroMotionPage />)
    for (const type of SHOT_LOCK_RUN_TYPES) {
      const toggle = await row("Nodaro Prism", type.label)
      expect(toggle).not.toBeChecked()
      expect(toggle).toBeEnabled()
      expect(toggle).toHaveAccessibleDescription(type.hint)
    }
    expect(await row("Nodaro Pulse", "Ordinary run")).not.toBeChecked()
    const pulse = within(await group()).getByRole("group", { name: "Nodaro Pulse" })
    expect(within(pulse).getAllByRole("switch")).toHaveLength(1)
    expect(within(pulse).getAllByText(SHOT_LOCK_NOT_APPLICABLE)).toHaveLength(2)
    expect(within(pulse).getAllByText(shotLockNoStyleHint("Nodaro Pulse"))).toHaveLength(2)
    expect(within(pulse).queryByRole("combobox")).toBeNull()
    // Every engine reads run types here: nothing to warn about.
    expect(within(await group()).queryByRole("status")).toBeNull()
    expect(saveButton()).toBeDisabled()
  })

  it("the value of before run types shows as Ordinary run and Art style + roles on, Art style alone off, and is no change", async () => {
    routes[`GET ${SHOT_LOCK_URL}`] = () => view({ "nodaro-prism": "on", "nodaro-pulse": "on" })
    renderWith(<AdminNodaroMotionPage />)
    await waitFor(async () => expect(await row("Nodaro Prism", "Ordinary run")).toBeChecked())
    expect(await row("Nodaro Prism", "Art style + roles")).toBeChecked()
    expect(await row("Nodaro Prism", "Art style alone")).not.toBeChecked()
    expect(await row("Nodaro Pulse", "Ordinary run")).toBeChecked()
    expect(saveButton()).toBeDisabled()
  })

  it("saves each switch on its own: only what is on, Pulse as \"on\"", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await row("Nodaro Prism", "Art style alone"))
    await user.click(await row("Nodaro Pulse", "Ordinary run"))
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(sent()).toEqual([{ shotLock: { "nodaro-prism": { styleAlone: "on" }, "nodaro-pulse": "on" } }]))
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(await row("Nodaro Prism", "Art style alone")).toBeChecked()
    expect(await row("Nodaro Prism", "Ordinary run")).not.toBeChecked()
  })

  it("Ordinary run and Art style + roles on with nothing else is saved as \"on\"; one more switch makes it an entry by run type", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await row("Nodaro Prism", "Ordinary run"))
    await user.click(await row("Nodaro Prism", "Art style + roles"))
    await user.click(saveButton())
    await waitFor(() => expect(sent()).toEqual([{ shotLock: { "nodaro-prism": "on" } }]))
    await waitFor(() => expect(saveButton()).toBeDisabled())
    await user.click(await row("Nodaro Prism", "Art style alone"))
    await user.click(saveButton())
    await waitFor(() => expect(sent()[1]).toEqual({ shotLock: { "nodaro-prism": { ordinary: "on", styleWithRoles: "on", styleAlone: "on" } } }))
  })

  it("an exception is picked from the style list, joins it off, has its own switch, and is saved as listed", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(await row("Nodaro Prism", "Ordinary run"))
    await user.click(await row("Nodaro Prism", "Art style + roles"))
    await user.selectOptions(await addStyle(), "cinematic")
    const cinematic = await exception("Cinematic")
    expect(cinematic).not.toBeChecked()
    // A listed style is no longer offered; the custom style is offered beside the catalog's.
    const offered = within(await addStyle()).getAllByRole("option").map((o) => o.textContent)
    expect(offered).not.toContain("Cinematic")
    expect(offered).toContain("Anime")
    expect(offered).toContain(SHOT_LOCK_CUSTOM_STYLE_LABEL)
    await user.selectOptions(await addStyle(), SHOT_LOCK_CUSTOM_STYLE)
    await user.click(await exception(SHOT_LOCK_CUSTOM_STYLE_LABEL))
    await user.click(saveButton())
    await waitFor(() =>
      expect(sent()).toEqual([{ shotLock: { "nodaro-prism": { ordinary: "on", styleWithRoles: "on", styles: { cinematic: "off", custom: "on" } } } }]),
    )
  })

  it("an exception that is on is saved with every switch off, and removing it takes it out", async () => {
    const user = userEvent.setup()
    routes[`GET ${SHOT_LOCK_URL}`] = () => view({ "nodaro-prism": { styles: { cinematic: "on", anime: "off" } } })
    renderWith(<AdminNodaroMotionPage />)
    await waitFor(async () => expect(await exception("Cinematic")).toBeChecked())
    expect(await exception("Anime")).not.toBeChecked()
    expect(await row("Nodaro Prism", "Ordinary run")).not.toBeChecked()
    expect(saveButton()).toBeDisabled()
    await user.click(within(await exceptions()).getByRole("button", { name: /^Remove Anime from Nodaro Prism/ }))
    await user.click(saveButton())
    await waitFor(() => expect(sent()).toEqual([{ shotLock: { "nodaro-prism": { styles: { cinematic: "on" } } } }]))
    await waitFor(() => expect(saveButton()).toBeDisabled())
    // The last thing that is on taken out: the engine is left out, off again.
    await user.click(within(await exceptions()).getByRole("button", { name: /^Remove Cinematic from Nodaro Prism/ }))
    await user.click(saveButton())
    await waitFor(() => expect(sent()[1]).toEqual({ shotLock: {} }))
  })

  it("an exception for a style this build's catalog lacks is shown by its id and kept on save", async () => {
    const user = userEvent.setup()
    routes[`GET ${SHOT_LOCK_URL}`] = () => view({ "nodaro-prism": { ordinary: "on", styles: { "a-future-style": "on" } } })
    renderWith(<AdminNodaroMotionPage />)
    await waitFor(async () => expect(await exception("a-future-style")).toBeChecked())
    await user.click(await row("Nodaro Prism", "Art style alone"))
    await user.click(saveButton())
    await waitFor(() => expect(sent()).toEqual([{ shotLock: { "nodaro-prism": { ordinary: "on", styleAlone: "on", styles: { "a-future-style": "on" } } } }]))
  })

  it("while no environment's engine reads run types: only Ordinary run is a control, it moves Art style + roles with it, and the page says why", async () => {
    const user = userEvent.setup()
    routes[`GET ${SHOT_LOCK_URL}`] = () => view(null, { offered: false, missingIn: ["staging", "production"] })
    renderWith(<AdminNodaroMotionPage />)
    const ordinary = await row("Nodaro Prism", "Ordinary run")
    const withRoles = await row("Nodaro Prism", "Art style + roles")
    expect(ordinary).toBeEnabled()
    expect(withRoles).toBeDisabled()
    expect(await row("Nodaro Prism", "Art style alone")).toBeDisabled()
    expect(await addStyle()).toBeDisabled()
    expect(within(await group()).getByRole("status")).toHaveTextContent(SHOT_LOCK_RUN_TYPES_UNOFFERED)
    await user.click(ordinary)
    expect(withRoles).toBeChecked()
    expect(await row("Nodaro Prism", "Art style alone")).not.toBeChecked()
    await user.click(saveButton())
    await waitFor(() => expect(sent()).toEqual([{ shotLock: { "nodaro-prism": "on" } }]))
  })

  it("once one environment's engine reads run types, everything is offered and a note names the ones that do not", async () => {
    routes[`GET ${SHOT_LOCK_URL}`] = () => view(null, { offered: true, missingIn: ["production"] })
    renderWith(<AdminNodaroMotionPage />)
    expect(await row("Nodaro Prism", "Art style alone")).toBeEnabled()
    expect(within(await group()).getByRole("status")).toHaveTextContent(shotLockRunTypesMissing(["production"]))
    expect(shotLockRunTypesMissing(["production"])).toMatch(/^Not read by run type yet in: production\. .* any other choice is off there\.$/)
  })

  it("a refused save is said under the switches, and the draft is kept", async () => {
    const user = userEvent.setup()
    const message = "No Cast Swap engine reads the shot lock by run type yet: turn Ordinary run and Art style + roles on together with nothing else, or wait for the engine."
    routes[`PUT ${SHOT_LOCK_URL}`] = () => ({ status: 409, body: { error: { code: "engine_unsupported", message } } })
    renderWith(<AdminNodaroMotionPage />)
    const alone = await row("Nodaro Prism", "Art style alone")
    await user.click(alone)
    await user.click(saveButton())
    expect(await within(await group()).findByRole("alert")).toHaveTextContent(message)
    expect(alone).toBeChecked()
  })
})

describe("the engine prompt's previews follow the draft by run type", { timeout: 20_000 }, () => {
  const PREVIEW = "POST /v1/admin/video-remake/prompt-parts/preview"
  const previewsOf = (style: string) => (sentTo(PREVIEW) as Array<Record<string, unknown>>).filter((b) => b.engine === "nodaro-prism" && b.style === style)

  it("the style-only preview by Art style alone, the Precise preview by Ordinary run; Art style + roles and the exceptions move neither", async () => {
    const user = userEvent.setup()
    // An engine that runs style-only runs in every environment, so Prism has its Style only tab.
    const styleOnlyEnv = (env: string) => ({ ...ENVIRONMENTS[0]!, env, supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, styleOnly: true } } })
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [styleOnlyEnv("production"), styleOnlyEnv("staging")] } })
    routes["GET /v1/admin/video-remake/prompt-parts"] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion", "styleOnly"] } } })
    routes["GET /v1/admin/video-remake/style-only"] = () => ({ body: { data: { styleOnly: null, updatedAt: null, engines: ENGINES, supported: true } } })
    routes["GET /v1/admin/video-remake/prompt-wording"] = () => ({ body: { data: { promptWording: null, updatedAt: null, engines: ENGINES, supported: true } } })
    renderWith(<AdminNodaroMotionPage />)
    const prism = (await screen.findByRole("heading", { name: /^Engine prompt: Nodaro Prism/ })).closest("section") as HTMLElement
    const tab = await within(prism).findByRole("tab", { name: "Style only" })
    await waitFor(() => expect(tab).toBeEnabled())
    await user.click(tab)
    await waitFor(() => expect(previewsOf("styleOnly").length).toBeGreaterThan(0))
    for (const body of sentTo(PREVIEW) as Array<Record<string, unknown>>) expect(body).not.toHaveProperty("shotLock")
    // Art style + roles and an exception: no preview carries an art style with roles, so none is asked again with a lock.
    await user.click(await row("Nodaro Prism", "Art style + roles"))
    await user.selectOptions(await addStyle(), "cinematic")
    await user.click(await exception("Cinematic"))
    // Art style alone: the style-only preview alone.
    await user.click(await row("Nodaro Prism", "Art style alone"))
    await waitFor(() => expect(previewsOf("styleOnly").at(-1)).toMatchObject({ shotLock: "on" }))
    for (const body of previewsOf("precise")) expect(body).not.toHaveProperty("shotLock")
    // Ordinary run: the Precise preview (its tab shown again), and the style-only one keeps its own.
    const styleOnlyAsked = previewsOf("styleOnly").length
    await user.click(await row("Nodaro Prism", "Ordinary run"))
    await user.click(within(prism).getByRole("tab", { name: "Precise" }))
    await waitFor(() => expect(previewsOf("precise").at(-1)).toMatchObject({ shotLock: "on" }))
    expect(previewsOf("styleOnly")).toHaveLength(styleOnlyAsked)
  })
})

describe("the shot lock's saved form and what a draft changes", () => {
  it("shotLockToSaved is the server's stored form", () => {
    expect(shotLockToSaved(null)).toEqual({})
    expect(shotLockToSaved({ "nodaro-prism": "off", "nodaro-pulse": "on" })).toEqual({ "nodaro-pulse": "on" })
    expect(shotLockToSaved({ "nodaro-prism": "on" })).toEqual({ "nodaro-prism": "on" })
    expect(shotLockToSaved({ "nodaro-prism": { ordinary: "on", styleWithRoles: "on", styleAlone: "off", styles: {} } })).toEqual({ "nodaro-prism": "on" })
    expect(shotLockToSaved({ "nodaro-prism": { ordinary: "on", styleWithRoles: "off", styleAlone: "on" } })).toEqual({ "nodaro-prism": { ordinary: "on", styleAlone: "on" } })
    expect(shotLockToSaved({ "nodaro-prism": { ordinary: "on", styleWithRoles: "on", styles: { cinematic: "off" } } })).toEqual({
      "nodaro-prism": { ordinary: "on", styleWithRoles: "on", styles: { cinematic: "off" } },
    })
    expect(shotLockToSaved({ "nodaro-prism": { styles: { cinematic: "on" } } })).toEqual({ "nodaro-prism": { styles: { cinematic: "on" } } })
    // Nothing on at all (an "off" exception alone turns nothing on): left out.
    expect(shotLockToSaved({ "nodaro-prism": { ordinary: "off", styles: { cinematic: "off" } } })).toEqual({})
    // An engine that takes no art style: "on" or nothing, whatever a draft says of the rest.
    expect(shotLockToSaved({ "nodaro-pulse": { ordinary: "on", styleAlone: "on", styles: { cinematic: "on" } } })).toEqual({ "nodaro-pulse": "on" })
    expect(shotLockToSaved({ "nodaro-pulse": { styleAlone: "on" } })).toEqual({})
  })

  it("shotLockResolved reads either shape; Pulse has its Ordinary run alone", () => {
    expect(shotLockResolved("on", "nodaro-prism")).toEqual({ ordinary: true, styleWithRoles: true, styleAlone: false, styles: {} })
    expect(shotLockResolved("on", "nodaro-pulse")).toEqual({ ordinary: true, styleWithRoles: false, styleAlone: false, styles: {} })
    expect(shotLockResolved(undefined, "nodaro-prism")).toEqual({ ordinary: false, styleWithRoles: false, styleAlone: false, styles: {} })
    expect(shotLockResolved({ styleAlone: "on", styles: { anime: "off" } }, "nodaro-prism")).toEqual({ ordinary: false, styleWithRoles: false, styleAlone: true, styles: { anime: "off" } })
  })

  it("the stored sets read a set from before run types and one by run type back unchanged", () => {
    const spec = MOTION_SETTINGS_SPECS["shot-lock"]
    for (const shotLock of [{ "nodaro-prism": "on" }, { "nodaro-prism": { ordinary: "on", styleAlone: "on", styles: { cinematic: "off", "a-future-style": "on" } }, "nodaro-pulse": "on" }]) {
      const body = { shotLock }
      expect(spec.bodyOf(spec.draftOf(spec.storedOfBody(body)))).toEqual(body)
    }
  })

  it("a draft changes a preview only through Ordinary run (Precise, Motion) and Art style alone (style-only)", () => {
    expect(shotLockChanges({ "nodaro-prism": { ordinary: "on", styleAlone: "on" } }, {})).toEqual({ "nodaro-prism": { ordinary: "on", styleAlone: "on" } })
    expect(shotLockChanges({ "nodaro-prism": { styleAlone: "on" } }, { "nodaro-prism": "on" })).toEqual({ "nodaro-prism": { ordinary: "off", styleAlone: "on" } })
    // Art style + roles and the exceptions change no preview: a preview carries no art style with roles.
    expect(shotLockChanges({ "nodaro-prism": { ordinary: "on", styles: { cinematic: "on" } } }, { "nodaro-prism": "on" })).toEqual({})
    // The same setting in either shape is no change.
    expect(shotLockChanges({ "nodaro-prism": { ordinary: "on", styleWithRoles: "on" } }, { "nodaro-prism": "on" })).toEqual({})
  })

  it("the styles an exception may name: the video style list in the catalog's order, then the custom style, whose key no catalog style has", () => {
    const options = shotLockStyleOptions()
    expect(options.at(-1)).toEqual({ id: SHOT_LOCK_CUSTOM_STYLE, label: SHOT_LOCK_CUSTOM_STYLE_LABEL })
    expect(options.filter((o) => o.id === SHOT_LOCK_CUSTOM_STYLE)).toHaveLength(1)
    expect(options.map((o) => o.id)).toEqual(expect.arrayContaining(["cinematic", "anime"]))
    expect(shotLockStyleLabel("cinematic")).toBe("Cinematic")
    expect(shotLockStyleLabel("a-future-style")).toBe("a-future-style")
  })
})
