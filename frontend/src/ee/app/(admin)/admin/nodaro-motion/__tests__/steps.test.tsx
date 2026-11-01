/**
 * Admin → Nodaro Motion: each engine's preparation steps for the runs people
 * start themselves (GET/PUT /v1/admin/nodaro-motion/steps).
 *
 * - One editor per engine, greyed out naming the environments whose engine
 *   cannot take them (the setting is shared by every environment).
 * - Save sends exactly the edited setting, keyed by the public engine id, an
 *   engine with nothing set left out; removing every step sends `{}`.
 * - The server's 409 `engine_unsupported` is said with its own words.
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
import { SHEET_LAYOUTS, type CastSwapStepDefaults, type SheetRules, type TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "../../trends/__tests__/harness"
import AdminNodaroMotionPage from "../page"
import { stepsToSaved } from "../components/StepsColumn"

const STEPS_URL = "/v1/admin/nodaro-motion/steps"
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const RULES: SheetRules = {
  person: { "head-body": "head-3q-body-cut", "body-only": "head-3q-body-cut", "head-only": "head-3q-body-cut", unclear: "none" },
  pet: { "head-body": "head-3q-body", "body-only": "head-3q-body", "head-only": "head-3q-body", unclear: "none" },
  product: { "head-body": "front-3q", "body-only": "front-3q", "head-only": "front-3q", unclear: "none" },
  location: { "head-body": "wide-detail", "body-only": "wide-detail", "head-only": "wide-detail", unclear: "none" },
}
const DEFAULTS: CastSwapStepDefaults = {
  conditions: ["head-body", "body-only", "head-only", "unclear"],
  layouts: { person: [...SHEET_LAYOUTS.person], pet: [...SHEET_LAYOUTS.pet], product: [...SHEET_LAYOUTS.product], location: [...SHEET_LAYOUTS.location] },
  todayLayout: { person: "collage", pet: "collage", product: "collage", location: "collage" },
  defaultRules: RULES,
  defaults: {
    labeller: { model: "claude-haiku-5.5", instructions: "test labeller instructions", inputs: ["rolePhotos"], maxChars: 900 },
    enginePrompt: { model: "gemini-3.1-pro", instructions: "test instructions", inputs: ["rolePhotos"], maxChars: 3000 },
    sceneDescription: { model: "gemini-3.1-pro", instructions: "test scene instructions", inputs: ["clip"], maxChars: 2500 },
  },
  layoutPrompts: { person: {}, pet: {}, product: {}, location: {} },
  critical: {},
  problems: [],
}
const MODELS = [{ id: "gemini-3.1-pro", displayName: "Test Pro", tier: "premium", vendor: "google", isEnabled: true }]
const stepsAt = (env: string, steps?: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, ...(steps ? { steps } : {}) } },
})
const view = (steps: unknown) => ({ body: { data: { steps, updatedAt: steps ? "2026-10-31T12:00:00.000Z" : null, engines: ENGINES } } })

beforeEach(() => {
  resetRoutes()
  vi.mocked(toast.error).mockClear()
  vi.stubGlobal("fetch", fetchMock)
  routes["GET /v1/admin/nodaro-motion/masking"] = () => ({ body: { data: { masking: null, updatedAt: null, engines: ENGINES } } })
  routes["GET /v1/admin/nodaro-motion/prompt-parts"] = () => ({ body: { data: { promptParts: null, updatedAt: null, engines: ENGINES, styles: ["precise", "motion"] } } })
  routes["POST /v1/admin/nodaro-motion/prompt-parts/preview"] = () => ({
    body: { data: { set: "precise", parts: [], assembled: "", length: 0, max: 8000, problems: [] } },
  })
  routes["GET /v1/admin/nodaro-motion/motion"] = () => ({ body: { data: { motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"] } } })
  routes["GET /v1/admin/nodaro-motion/pulse-audio"] = () => ({ body: { data: { pulseAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/nodaro-motion/prism-reference-audio"] = () => ({ body: { data: { prismReferenceAudio: null, updatedAt: null, supported: true } } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [stepsAt("production", true), stepsAt("staging", true)] } })
  routes[`GET ${STEPS_URL}`] = () => view(null)
  for (const e of ENGINES) routes[`GET ${STEPS_URL}/defaults?engine=${e.id}`] = () => ({ body: { data: DEFAULTS } })
  routes["GET /v1/admin/llm-models"] = () => ({ body: { data: { models: MODELS, tierCosts: {}, featureCosts: {} } } })
  routes[`POST ${STEPS_URL}/check`] = () => ({ body: { data: { problems: [] } } })
})
afterEach(() => vi.unstubAllGlobals())

const stepsOf = async (name: string) => screen.findByRole("group", { name: `Nodaro Motion ${name} preparation steps` })

describe("Admin → Nodaro Motion → preparation steps", { timeout: 20_000 }, () => {
  it("leaves out an engine with nothing set", () => {
    expect(stepsToSaved(null)).toEqual({})
    expect(stepsToSaved({ "motion-prism": {}, "motion-pulse": { enginePrompt: { mode: "template" } } })).toEqual({
      "motion-pulse": { enginePrompt: { mode: "template" } },
    })
    // Body from the clip alone is a setting of its own.
    expect(stepsToSaved({ "motion-prism": { clipBody: { mode: "off" } } })).toEqual({ "motion-prism": { clipBody: { mode: "off" } } })
  })

  it("saving sends exactly the edited object, keyed by the public engine id", async () => {
    const user = userEvent.setup()
    routes[`PUT ${STEPS_URL}`] = (init) => view(JSON.parse(String(init?.body)).steps)
    renderWith(<AdminNodaroMotionPage />)
    const pulse = await stepsOf("Pulse")
    const llm = within(within(pulse).getByRole("region", { name: "Engine prompt step" })).getByRole("radio", { name: "LLM" })
    await waitFor(() => expect(llm).toBeEnabled())
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    await user.click(llm)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(sentTo(`PUT ${STEPS_URL}`)).toEqual([
        { steps: { "motion-pulse": { enginePrompt: { mode: "llm", llm: { model: "gemini-3.1-pro", inputs: ["rolePhotos"], maxChars: 3000 } } } } },
      ]),
    )
    // Only the setting that changed is sent.
    expect(sentTo("PUT /v1/admin/nodaro-motion/masking")).toEqual([])
  })

  it("removing every step sends an empty setting", async () => {
    const user = userEvent.setup()
    const saved = { "motion-prism": { sheets: { rules: RULES } } }
    routes[`GET ${STEPS_URL}`] = () => view(saved)
    routes[`PUT ${STEPS_URL}`] = (init) => view(JSON.parse(String(init?.body)).steps)
    renderWith(<AdminNodaroMotionPage />)
    const prism = await stepsOf("Prism")
    await waitFor(() => expect(within(prism).getByRole("radio", { name: "By the photos (rules)" })).toBeChecked())
    await user.click(within(prism).getByRole("radio", { name: "Today's sheet" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(sentTo(`PUT ${STEPS_URL}`)).toEqual([{ steps: {} }]))
  })

  it("is greyed out naming the environments whose engine cannot take them", async () => {
    routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [stepsAt("production", true), stepsAt("staging")] } })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await stepsOf("Prism")
    expect(await within(prism).findByText(/The Cast Swap engine of staging cannot take preparation steps yet/)).toBeInTheDocument()
    expect(within(prism).getByRole("radio", { name: "By the photos (rules)" })).toBeDisabled()
  })

  it("says the server's refusal when an environment cannot take them", async () => {
    const user = userEvent.setup()
    routes[`PUT ${STEPS_URL}`] = () => ({
      status: 409,
      body: { error: { code: "engine_unsupported", message: "The Cast Swap engine of staging cannot take preparation steps yet.", envs: ["staging"] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const prism = await stepsOf("Prism")
    const llm = within(within(prism).getByRole("region", { name: "Engine prompt step" })).getByRole("radio", { name: "LLM" })
    await waitFor(() => expect(llm).toBeEnabled())
    await user.click(llm)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/staging/)))
  })
})
