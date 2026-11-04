/**
 * Admin → Nodaro Motion → Precise runs with an art style, Prism only:
 *
 * - The switch (GET/PUT /v1/admin/nodaro-motion/precise-art-style) sits under
 *   Prism's Precise column: the prompt's opener, "Restyle" (the default) or
 *   "Edit". Save sends only what differs from the default; going back sends `{}`.
 * - A change is offered once ANY environment's engine takes an art style on a
 *   Precise run (`castSwap.preciseArtStyle`), naming the ones that do not; with
 *   none, only the default stays choosable. The server's 409 is said in place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { SHEET_LAYOUTS, type CastSwapStepDefaults, type TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import {
  NO_ENVIRONMENT_TAKES_PRECISE_ART_STYLE,
  PRECISE_ART_STYLE_LEGEND,
  PRECISE_STYLE_REFS_LABEL,
  preciseArtStyleMissingNote,
  preciseArtStyleToSaved,
} from "../components/PreciseArtStyleColumn"
import { environmentsThatCannotTakePreciseArtStyle } from "../../trends/clip-preparation"

const URL_ = "/v1/admin/nodaro-motion/precise-art-style"
const PARTS = "/v1/admin/nodaro-motion/prompt-parts"
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const RULE = { "head-body": "collage", "body-only": "collage", "head-only": "collage", unclear: "none" } as const
const DEFAULTS = {
  conditions: ["head-body", "body-only", "head-only", "unclear"],
  layouts: { person: [...SHEET_LAYOUTS.person], pet: [...SHEET_LAYOUTS.pet], product: [...SHEET_LAYOUTS.product], location: [...SHEET_LAYOUTS.location] },
  todayLayout: { person: "collage", pet: "collage", product: "collage", location: "collage" },
  defaultRules: { person: RULE, pet: RULE, product: RULE, location: RULE },
  defaults: {
    labeller: { model: "claude-haiku-5.5", instructions: "labeller", inputs: ["rolePhotos"], maxChars: 900 },
    enginePrompt: { model: "gemini-3.1-pro", instructions: "engine prompt instructions", inputs: ["clip"], maxChars: 3000 },
    sceneDescription: { model: "gemini-3.1-pro", instructions: "scene", inputs: ["clip"], maxChars: 2500 },
    styleRefs: { mode: "off", send: "styled-and-original", prompt: "test style refs prompt" },
  },
  layoutPrompts: { person: {}, pet: {}, product: {}, location: {} },
  critical: {},
  problems: [],
} as unknown as CastSwapStepDefaults
const MODELS = [{ id: "gemini-3.1-pro", displayName: "Test Pro", tier: "premium", vendor: "google", isEnabled: true }]
const takes = (env: string, yes: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(yes ? { preciseArtStyle: true } : {}) } },
})
const BOTH = [takes("production", true), takes("staging", true)]
const view = (preciseArtStyle: unknown, supported = true) => ({
  body: { data: { preciseArtStyle, updatedAt: preciseArtStyle ? "2026-11-04T12:00:00.000Z" : null, engines: ENGINES, supported } },
})
const partsView = (promptParts: unknown, styles: string[] = ["precise", "motion", "styleOnly"]) => ({
  body: { data: { promptParts, updatedAt: promptParts ? "2026-11-03T12:00:00.000Z" : null, engines: ENGINES, styles } },
})

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes["GET /v1/admin/nodaro-motion/masking"] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/nodaro-motion/style"] = () => ({ body: { data: { style: null, updatedAt: null, engines: ENGINES, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/advanced"] = () => ({ body: { data: { show: false, updatedAt: null } } })
  routes["GET /v1/admin/nodaro-motion/prompt-wording"] = () => ({ body: { data: { promptWording: null, updatedAt: null, engines: ENGINES, supported: true } } })
  routes[`GET ${PARTS}`] = () => partsView(null)
  routes[`POST ${PARTS}/preview`] = (init) => {
    const body = JSON.parse(String(init?.body)) as { style: string }
    const parts = [{ id: "opener", default: `${body.style} opener`, defaultHash: "0123456789abcdef", placeholders: ["{video}"], required: [], applies: true }]
    return { body: { data: { set: body.style, parts, assembled: `${body.style} assembled`, length: 10, max: 8000, problems: [] } } }
  }
  routes["GET /v1/admin/nodaro-motion/motion"] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes["GET /v1/admin/nodaro-motion/pulse-audio"] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/prism-reference-audio"] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/steps"] = () => ({ body: { data: { steps: null, updatedAt: null, engines: ENGINES } } })
  for (const e of ENGINES) routes[`GET /v1/admin/nodaro-motion/steps/defaults?engine=${e.id}`] = () => ({ body: { data: DEFAULTS } })
  routes["GET /v1/admin/llm-models"] = () => ({ body: { data: { models: MODELS, tierCosts: {}, featureCosts: {} } } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: BOTH } })
  routes[`GET ${URL_}`] = () => view(null)
  routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).preciseArtStyle)
  routes["GET /v1/admin/nodaro-motion/style-only"] = () => ({ body: { data: { styleOnly: null, updatedAt: null, engines: ENGINES, supported: true } } })
})
afterEach(() => vi.unstubAllGlobals())

const preciseGroup = (name: string) => screen.findByRole("group", { name: `Nodaro Motion ${name} Precise` })
const openerOf = async (name: string) => within(await preciseGroup(name)).findByRole("group", { name: PRECISE_ART_STYLE_LEGEND })
const columnOf = async () => (await openerOf("Prism")).closest("[data-testid='precise-art-style-column']") as HTMLElement

describe("Admin → Nodaro Motion → Precise runs with an art style", { timeout: 20_000 }, () => {
  it("preciseArtStyleToSaved leaves the default opener out and keeps the style-refs step as picked", () => {
    expect(preciseArtStyleToSaved(null)).toEqual({})
    expect(preciseArtStyleToSaved({ "motion-prism": { opener: "restyle" }, "motion-pulse": {} })).toEqual({})
    expect(preciseArtStyleToSaved({ "motion-prism": { opener: "edit" } })).toEqual({ "motion-prism": { opener: "edit" } })
    expect(preciseArtStyleToSaved({ "motion-prism": { opener: "restyle", styleRefs: { mode: "off", send: "styled" } } })).toEqual({
      "motion-prism": { styleRefs: { mode: "off", send: "styled" } },
    })
  })

  it("its own Style the role pictures switch sits beside the opener, Off until turned on; On saves it alone, and the preparation steps are not touched", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const group = within(await columnOf()).getByRole("group", { name: PRECISE_STYLE_REFS_LABEL })
    const toggle = within(group).getByRole("switch", { name: "Style the role pictures" })
    expect(toggle).not.toBeChecked()
    await waitFor(() => expect(toggle).toBeEnabled())
    await user.click(toggle)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseArtStyle: { "motion-prism": { styleRefs: { mode: "on", send: "styled-and-original" } } } }]))
    expect(sentTo("PUT /v1/admin/nodaro-motion/steps")).toEqual([])
  })

  it("a saved step shows On; turning it off saves Off with its send kept", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ "motion-prism": { opener: "edit", styleRefs: { mode: "on", send: "styled" } } })
    renderWith(<AdminNodaroMotionPage />)
    const toggle = within(within(await columnOf()).getByRole("group", { name: PRECISE_STYLE_REFS_LABEL })).getByRole("switch", { name: "Style the role pictures" })
    await waitFor(() => expect(toggle).toBeChecked())
    await user.click(toggle)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseArtStyle: { "motion-prism": { opener: "edit", styleRefs: { mode: "off", send: "styled" } } } }]))
  })

  it("the switch cannot be turned on while no environment's engine takes it", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [takes("production", false), takes("staging", false)] } })
    renderWith(<AdminNodaroMotionPage />)
    const column = await columnOf()
    await waitFor(() => expect(within(column).getByText(NO_ENVIRONMENT_TAKES_PRECISE_ART_STYLE)).toBeInTheDocument())
    expect(within(within(column).getByRole("group", { name: PRECISE_STYLE_REFS_LABEL })).getByRole("switch", { name: "Style the role pictures" })).toBeDisabled()
  })

  it("environmentsThatCannotTakePreciseArtStyle names the shared environments without the flag", () => {
    expect(environmentsThatCannotTakePreciseArtStyle(undefined)).toBeUndefined()
    expect(environmentsThatCannotTakePreciseArtStyle(BOTH)).toEqual([])
    expect(environmentsThatCannotTakePreciseArtStyle([takes("production", true)])).toEqual(["staging"])
    expect(environmentsThatCannotTakePreciseArtStyle([takes("production", false), takes("staging", false)])).toEqual(["staging", "production"])
  })

  it("is under Prism's Precise column, not Pulse's, on Restyle until saved", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const group = await openerOf("Prism")
    expect(within(group).getByRole("radio", { name: "Restyle (default)" })).toBeChecked()
    expect(within(group).getByRole("radio", { name: "Restyle (default)" })).toHaveAccessibleDescription("Opens the prompt with “restyle {video:1} as follows:”.")
    expect(within(group).getByRole("radio", { name: "Edit" })).not.toBeChecked()
    expect(within(group).getByRole("radio", { name: "Edit" })).toHaveAccessibleDescription(
      "Opens it with “edit {video:1} as follows:”, the Precise opener without an art style.",
    )
    expect(within(await preciseGroup("Pulse")).queryByRole("group", { name: PRECISE_ART_STYLE_LEGEND })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("saves Edit alone, keyed by Prism's public id, and going back sends {}", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(within(await openerOf("Prism")).getByRole("radio", { name: "Edit" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ preciseArtStyle: { "motion-prism": { opener: "edit" } } }]))
    expect(sentTo("PUT /v1/admin/nodaro-motion/masking")).toEqual([])
    expect(sentTo("PUT /v1/admin/nodaro-motion/style-only")).toEqual([])
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled())
    await user.click(within(await openerOf("Prism")).getByRole("radio", { name: "Restyle (default)" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)[1]).toEqual({ preciseArtStyle: {} }))
  })

  it("shows a saved Edit", async () => {
    routes[`GET ${URL_}`] = () => view({ "motion-prism": { opener: "edit" } })
    renderWith(<AdminNodaroMotionPage />)
    const group = await openerOf("Prism")
    await waitFor(() => expect(within(group).getByRole("radio", { name: "Edit" })).toBeChecked())
  })

  it("says the server's 409 in place; a new choice clears it", async () => {
    const user = userEvent.setup()
    const message = "No Cast Swap engine takes an art style on a Precise run yet: keep the default (Restyle), or wait for the engine."
    routes[`PUT ${URL_}`] = () => ({ status: 409, body: { error: { code: "engine_unsupported", message, envs: [] } } })
    renderWith(<AdminNodaroMotionPage />)
    await user.click(within(await openerOf("Prism")).getByRole("radio", { name: "Edit" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(await within(await columnOf()).findByRole("alert")).toHaveTextContent(message)
    await user.click(within(await openerOf("Prism")).getByRole("radio", { name: "Restyle (default)" }))
    await waitFor(() => expect(within(screen.getByTestId("precise-art-style-column")).queryByRole("alert")).not.toBeInTheDocument())
  })

  it("offers a change once one environment's engine takes it, naming the one that does not", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [takes("production", true), takes("staging", false)] } })
    renderWith(<AdminNodaroMotionPage />)
    const group = await openerOf("Prism")
    await waitFor(() => expect(within(group).getByRole("radio", { name: "Edit" })).toBeEnabled())
    expect(within(await columnOf()).getByText(preciseArtStyleMissingNote(["staging"]))).toBeInTheDocument()
  })

  it("greys out Edit while no environment's engine takes it; the default stays choosable", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [takes("production", false), takes("staging", false)] } })
    renderWith(<AdminNodaroMotionPage />)
    const column = await columnOf()
    await waitFor(() => expect(within(column).getByText(NO_ENVIRONMENT_TAKES_PRECISE_ART_STYLE)).toBeInTheDocument())
    expect(within(column).getByRole("radio", { name: "Edit" })).toBeDisabled()
    expect(within(column).getByRole("radio", { name: "Restyle (default)" })).toBeEnabled()
  })
})
