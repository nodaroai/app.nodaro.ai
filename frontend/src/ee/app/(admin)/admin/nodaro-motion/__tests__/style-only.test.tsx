/**
 * Admin → Nodaro Motion → style-only runs (a video and an art style, nothing
 * swapped), Prism only:
 *
 * - The switch (GET/PUT /v1/admin/nodaro-motion/style-only) sits under
 *   Prism's Motion column: "Original clip" (the default) or "Like other
 *   styles", and its own engine prompt (Template by default, or LLM). Save
 *   sends only what differs from the defaults; going back sends `{}`.
 * - A change is offered once ANY environment's engine runs style-only runs
 *   (`castSwap.styleOnly`), naming the ones that do not; with none, only the
 *   defaults stay choosable. The server's 409 is said in place.
 * - The "Style only" engine prompt tab (prompt-parts key `styleOnly`) is on
 *   Prism while the engine lists it, enabled only once EVERY environment's
 *   engine runs style-only runs, hidden on Pulse; it has no wording select.
 *   The engine prompts' Save sends the WHOLE draft, `styleOnly` included.
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
import { SHEET_LAYOUTS, type CastSwapStepDefaults, type TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import { NO_ENVIRONMENT_RUNS_STYLE_ONLY, STYLE_ONLY_LEGEND, styleOnlyMissingNote, styleOnlyToSaved } from "../components/StyleOnlyColumn"
import { STYLE_ONLY_TAB_UNOFFERED } from "../components/PromptPartsTabs"
import { environmentsThatCannotRunStyleOnly } from "../../trends/clip-preparation"

const URL_ = "/v1/admin/nodaro-motion/style-only"
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
  },
  layoutPrompts: { person: {}, pet: {}, product: {}, location: {} },
  critical: {},
  problems: [],
} as unknown as CastSwapStepDefaults
const MODELS = [{ id: "gemini-3.1-pro", displayName: "Test Pro", tier: "premium", vendor: "google", isEnabled: true }]
const runsStyleOnly = (env: string, yes: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(yes ? { styleOnly: true } : {}) } },
})
const BOTH = [runsStyleOnly("production", true), runsStyleOnly("staging", true)]
const view = (styleOnly: unknown, supported = true) => ({
  body: { data: { styleOnly, updatedAt: styleOnly ? "2026-11-03T12:00:00.000Z" : null, engines: ENGINES, supported } },
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
  routes[`PUT ${URL_}`] = (init) => view(JSON.parse(String(init?.body)).styleOnly)
})
afterEach(() => vi.unstubAllGlobals())

const motionGroup = (name: string) => screen.findByRole("group", { name: `Nodaro Motion ${name} Motion` })
const styleOnlyOf = async (name: string) => within(await motionGroup(name)).findByRole("group", { name: STYLE_ONLY_LEGEND })
const columnOf = async () => (await styleOnlyOf("Prism")).closest("[data-testid='style-only-column']") as HTMLElement
const engineSection = async (name: string) =>
  (await screen.findByRole("heading", { name: new RegExp(`^Engine prompt: ${name}`) })).closest("section") as HTMLElement

describe("Admin → Nodaro Motion → style-only runs", { timeout: 20_000 }, () => {
  it("styleOnlyToSaved leaves the defaults out and never writes null", () => {
    expect(styleOnlyToSaved(null)).toEqual({})
    expect(
      styleOnlyToSaved({
        "motion-prism": { path: "original", enginePrompt: { mode: "template" } },
        "motion-pulse": {},
      }),
    ).toEqual({})
    const llm = { mode: "llm" as const, llm: { model: "gemini-3.1-pro", instructions: "", inputs: ["clip" as const], maxChars: 3000 } }
    expect(styleOnlyToSaved({ "motion-prism": { path: "flex", enginePrompt: llm } })).toEqual({ "motion-prism": { path: "flex", enginePrompt: llm } })
    expect(styleOnlyToSaved({ "motion-prism": { enginePrompt: llm } })).toEqual({ "motion-prism": { enginePrompt: llm } })
  })

  it("environmentsThatCannotRunStyleOnly names the shared environments without the flag", () => {
    expect(environmentsThatCannotRunStyleOnly(undefined)).toBeUndefined()
    expect(environmentsThatCannotRunStyleOnly(BOTH)).toEqual([])
    expect(environmentsThatCannotRunStyleOnly([runsStyleOnly("production", true)])).toEqual(["staging"])
    expect(environmentsThatCannotRunStyleOnly([runsStyleOnly("production", false), runsStyleOnly("staging", false)])).toEqual(["staging", "production"])
  })

  it("is under Prism's Motion column, not Pulse's, on Original clip and Template until saved", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const group = await styleOnlyOf("Prism")
    expect(within(group).getByRole("radio", { name: "Original clip (default)" })).toBeChecked()
    expect(within(group).getByRole("radio", { name: "Original clip (default)" })).toHaveAccessibleDescription(
      "Sends the clip itself, with no depth, so the scene stays as filmed.",
    )
    expect(within(group).getByRole("radio", { name: "Like other styles" })).not.toBeChecked()
    expect(within(group).getByRole("radio", { name: "Like other styles" })).toHaveAccessibleDescription(
      "Full depth with the Motion setting and the Flexible prompt, as an art-style run with roles.",
    )
    const column = await columnOf()
    const prompt = within(column).getByRole("group", { name: "Style-only engine prompt" })
    expect(within(prompt).getByRole("radio", { name: "Template" })).toBeChecked()
    expect(within(await motionGroup("Pulse")).queryByRole("group", { name: STYLE_ONLY_LEGEND })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("saves Like other styles alone, keyed by Prism's public id", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.click(within(await styleOnlyOf("Prism")).getByRole("radio", { name: "Like other styles" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ styleOnly: { "motion-prism": { path: "flex" } } }]))
    // Nothing else changed: nothing else is sent.
    expect(sentTo("PUT /v1/admin/nodaro-motion/masking")).toEqual([])
    expect(sentTo("PUT /v1/admin/nodaro-motion/motion")).toEqual([])
    expect(sentTo("PUT /v1/admin/nodaro-motion/steps")).toEqual([])
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled())
  })

  it("saves an LLM engine prompt seeded from the engine's defaults, and a saved change goes back as {}", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const prompt = within(await columnOf()).getByRole("group", { name: "Style-only engine prompt" })
    const llm = within(prompt).getByRole("radio", { name: "LLM" })
    await waitFor(() => expect(llm).toBeEnabled())
    await user.click(llm)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toHaveLength(1))
    const [first] = sentTo(`PUT ${URL_}`) as Array<{ styleOnly: { "motion-prism": { path?: string; enginePrompt: { mode: string; llm: { model: string } } } } }>
    expect(first!.styleOnly["motion-prism"].enginePrompt.mode).toBe("llm")
    expect(first!.styleOnly["motion-prism"].enginePrompt.llm.model).toBe("gemini-3.1-pro")
    expect(first!.styleOnly["motion-prism"]).not.toHaveProperty("path")
    // Back to Template: the defaults are sent as an empty setting.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled())
    await user.click(within(within(await columnOf()).getByRole("group", { name: "Style-only engine prompt" })).getByRole("radio", { name: "Template" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)[1]).toEqual({ styleOnly: {} }))
  })

  it("says the server's 409 in place", async () => {
    const user = userEvent.setup()
    const message = "No Cast Swap engine runs style-only runs yet: keep the defaults (Original clip, Template), or wait for the engine."
    routes[`PUT ${URL_}`] = () => ({ status: 409, body: { error: { code: "engine_unsupported", message, envs: [] } } })
    renderWith(<AdminNodaroMotionPage />)
    await user.click(within(await styleOnlyOf("Prism")).getByRole("radio", { name: "Like other styles" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(await within(await columnOf()).findByRole("alert")).toHaveTextContent(message)
    // A new choice clears it.
    await user.click(within(await styleOnlyOf("Prism")).getByRole("radio", { name: "Original clip (default)" }))
    await waitFor(() => expect(within(screen.getByTestId("style-only-column")).queryByRole("alert")).not.toBeInTheDocument())
  })

  it("offers a change once one environment's engine runs it, naming the one that does not", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [runsStyleOnly("production", true), runsStyleOnly("staging", false)] } })
    renderWith(<AdminNodaroMotionPage />)
    const group = await styleOnlyOf("Prism")
    await waitFor(() => expect(within(group).getByRole("radio", { name: "Like other styles" })).toBeEnabled())
    expect(within(await columnOf()).getByText(styleOnlyMissingNote(["staging"]))).toBeInTheDocument()
    expect(styleOnlyMissingNote(["staging"])).toBe("The Cast Swap engine of staging does not run style-only runs yet: it never reads this setting.")
  })

  it("greys out Like other styles and LLM while no environment's engine runs it", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [runsStyleOnly("production", false), runsStyleOnly("staging", false)] } })
    renderWith(<AdminNodaroMotionPage />)
    const column = await columnOf()
    await waitFor(() => expect(within(column).getByText(NO_ENVIRONMENT_RUNS_STYLE_ONLY)).toBeInTheDocument())
    expect(within(column).getByRole("radio", { name: "Like other styles" })).toBeDisabled()
    expect(within(column).getByRole("radio", { name: "LLM" })).toBeDisabled()
    expect(within(column).getByRole("radio", { name: "Original clip (default)" })).toBeEnabled()
    // No step defaults are asked for an engine that reads nothing.
    expect(sentTo("GET /v1/admin/nodaro-motion/steps/defaults?engine=motion-prism")).toEqual([])
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("keeps a saved Like other styles choosable back to Original clip while no environment's engine runs it", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [runsStyleOnly("production", false), runsStyleOnly("staging", false)] } })
    routes[`GET ${URL_}`] = () => view({ "motion-prism": { path: "flex" } })
    renderWith(<AdminNodaroMotionPage />)
    const column = await columnOf()
    await waitFor(() => expect(within(column).getByRole("radio", { name: "Like other styles" })).toBeChecked())
    await waitFor(() => expect(within(column).getByText(NO_ENVIRONMENT_RUNS_STYLE_ONLY)).toBeInTheDocument())
    await user.click(within(column).getByRole("radio", { name: "Original clip (default)" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ styleOnly: {} }]))
  })

  it("keeps a saved LLM engine prompt choosable back to Template while no environment's engine runs it", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [runsStyleOnly("production", false), runsStyleOnly("staging", false)] } })
    routes[`GET ${URL_}`] = () =>
      view({ "motion-prism": { enginePrompt: { mode: "llm", llm: { model: "gemini-3.1-pro", inputs: ["clip"], maxChars: 3000 } } } })
    renderWith(<AdminNodaroMotionPage />)
    const column = await columnOf()
    const prompt = within(column).getByRole("group", { name: "Style-only engine prompt" })
    await waitFor(() => expect(within(prompt).getByRole("radio", { name: "LLM" })).toBeChecked())
    await waitFor(() => expect(within(column).getByText(NO_ENVIRONMENT_RUNS_STYLE_ONLY)).toBeInTheDocument())
    // The other way stays closed: LLM can't be chosen anew, only taken back.
    expect(within(prompt).getByRole("radio", { name: "LLM" })).toBeDisabled()
    await user.click(within(prompt).getByRole("radio", { name: "Template" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ styleOnly: {} }]))
  })

  it("says when this environment's engine does not run style-only runs", async () => {
    routes[`GET ${URL_}`] = () => view(null, false)
    renderWith(<AdminNodaroMotionPage />)
    expect(await within(await columnOf()).findByText("This environment's engine does not run style-only runs yet.")).toBeInTheDocument()
  })
})

describe("Admin → Nodaro Motion → the Style only engine prompt", { timeout: 20_000 }, () => {
  it("is a Prism tab listing the engine's style-only parts, with no wording select; Pulse has none", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const prism = await engineSection("Nodaro Motion Prism")
    const tab = await within(prism).findByRole("tab", { name: "Style only" })
    await waitFor(() => expect(tab).toBeEnabled())
    await user.click(tab)
    expect(await within(prism).findByText("styleOnly opener", { selector: "p" })).toBeInTheDocument()
    expect(within(prism).queryByRole("combobox", { name: "Wording" })).not.toBeInTheDocument()
    await waitFor(() => expect(sentTo(`POST ${PARTS}/preview`)).toContainEqual({ engine: "motion-prism", style: "styleOnly", overrides: {} }))
    // The style-only preview never names a wording.
    expect((sentTo(`POST ${PARTS}/preview`) as Array<{ style: string }>).filter((b) => b.style === "styleOnly").every((b) => !("promptWording" in b))).toBe(true)
    const pulse = await engineSection("Nodaro Motion Pulse")
    expect(within(pulse).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Precise", "Motion (Flexible prompt)"])
    expect(sentTo(`POST ${PARTS}/preview`)).not.toContainEqual(expect.objectContaining({ engine: "motion-pulse", style: "styleOnly" }))
  })

  it("says why it is greyed out while the environments are still unknown", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => new Promise(() => {})
    renderWith(<AdminNodaroMotionPage />)
    const prism = await engineSection("Nodaro Motion Prism")
    expect(await within(prism).findByRole("tab", { name: "Style only" })).toBeDisabled()
    expect(within(prism).getByText("Style only: checking the environments…")).toBeInTheDocument()
  })

  it("says the server's sentence when a style-only save is refused for the environments", async () => {
    const user = userEvent.setup()
    const message = "The Cast Swap engine in production cannot run style-only runs yet, and this setting is shared by every environment: keep the defaults (Original clip, Template), or wait for the engine."
    routes[`PUT ${PARTS}`] = () => ({ status: 409, body: { error: { code: "engine_unsupported", message, envs: ["production"] } } })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await engineSection("Nodaro Motion Prism")
    const tab = await within(prism).findByRole("tab", { name: "Style only" })
    await waitFor(() => expect(tab).toBeEnabled())
    await user.click(tab)
    await user.type(await within(prism).findByRole("textbox"), "Restyle {{video}")
    await user.click(screen.getByRole("button", { name: "Save engine prompts" }))
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(message))
    expect(sentTo(`PUT ${PARTS}`)).toEqual([{ promptParts: { "motion-prism": { styleOnly: { opener: "Restyle {video}" } } } }])
  })

  it("is absent while this environment's engine does not list it", async () => {
    routes[`GET ${PARTS}`] = () => partsView(null, ["precise", "motion"])
    renderWith(<AdminNodaroMotionPage />)
    const prism = await engineSection("Nodaro Motion Prism")
    await within(prism).findByRole("tab", { name: "Precise" })
    expect(within(prism).queryByRole("tab", { name: "Style only" })).not.toBeInTheDocument()
  })

  it("is greyed out, naming the environment, until every engine runs it; a save still sends the stored style-only parts", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [runsStyleOnly("production", true), runsStyleOnly("staging", false)] } })
    const stored = { "motion-prism": { styleOnly: { opener: "Restyle {video} as a watercolor." } } }
    routes[`GET ${PARTS}`] = () => partsView(stored)
    routes[`PUT ${PARTS}`] = (init) => partsView(JSON.parse(String(init?.body)).promptParts)
    renderWith(<AdminNodaroMotionPage />)
    const prism = await engineSection("Nodaro Motion Prism")
    const tab = await within(prism).findByRole("tab", { name: "Style only" })
    await waitFor(() => expect(within(prism).getByText(STYLE_ONLY_TAB_UNOFFERED(["staging"]))).toBeInTheDocument())
    expect(tab).toBeDisabled()
    // Edit a Precise part (the default tab) and save the engine prompts.
    const precise = await within(prism).findByRole("textbox")
    await user.type(precise, "Keep {{video}")
    await user.click(screen.getByRole("button", { name: "Save engine prompts" }))
    await waitFor(() => expect(sentTo(`PUT ${PARTS}`)).toHaveLength(1))
    expect(sentTo(`PUT ${PARTS}`)[0]).toEqual({
      promptParts: { "motion-prism": { precise: { opener: "Keep {video}" }, styleOnly: { opener: "Restyle {video} as a watercolor." } } },
    })
  })
})
