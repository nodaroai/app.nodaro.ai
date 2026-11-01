/**
 * Admin → Trends → one trend: the preparation steps ride the draft.
 *
 * - The editor sits in the clip preparation section; what the admin sets is
 *   saved with the draft as `steps`, exactly as edited.
 * - A draft with steps loads unchanged (no edit, nothing to save), and
 *   removing every step saves the draft with no `steps` key.
 * - The face mask panel says when the stored scene texts were made with
 *   another scene description step (the texts are still sent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { SHEET_LAYOUTS, type AdminTrendData, type AdminTrendFaceMask, type CastSwapStepDefaults, type CastSwapSteps, type SheetRules, type TrendEngineEnvironment } from "@/lib/api"
import { detail, ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, run, sentTo, TREND_ID } from "./harness"
import AdminTrendEditorPage from "../detail/page"

const BASE = `/v1/admin/trends/${TREND_ID}`
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
const withSteps = (env: string): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: { castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, steps: true } },
})

function serve(data: Partial<AdminTrendData>, state: Record<string, unknown> = {}) {
  routes[`GET ${BASE}`] = () => ({ body: { data: detail(state, data) } })
}

function renderEditor() {
  return renderWith(<AdminTrendEditorPage />, `/admin/trends/${TREND_ID}`, "/admin/trends/:id")
}

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${BASE}/test-runs`] = () => ({ body: { data: [run()] } })
  routes["GET /v1/admin/trends/engine-environments"] = () => ({ body: { data: [withSteps("production"), withSteps("staging")] } })
  routes["GET /v1/admin/nodaro-motion/steps/defaults?engine=seedance-2-5"] = () => ({ body: { data: DEFAULTS } })
  routes["GET /v1/admin/llm-models"] = () => ({ body: { data: { models: MODELS, tierCosts: {}, featureCosts: {} } } })
  routes["POST /v1/admin/nodaro-motion/steps/check"] = () => ({ body: { data: { problems: [] } } })
  routes[`PUT ${BASE}/draft`] = () => ({ body: { data: { version: 1, revision: "rev-2" } } })
})
afterEach(() => vi.unstubAllGlobals())

const stepsEditor = async () => screen.findByTestId("steps-editor")

describe("a trend's preparation steps", { timeout: 20_000 }, () => {
  it("saving sends exactly the edited object on the draft", async () => {
    const user = userEvent.setup()
    serve({})
    renderEditor()
    const editor = await stepsEditor()
    const engine = within(editor).getByRole("region", { name: "Engine prompt step" })
    const llm = within(engine).getByRole("radio", { name: "LLM" })
    await waitFor(() => expect(llm).toBeEnabled())
    // Loading the editor changed nothing: no draft edit to save.
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()
    await user.click(llm)
    await user.click(within(editor).getByRole("radio", { name: "By the photos (rules)" }))
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const body = sentTo(`PUT ${BASE}/draft`)[0] as { data: { steps?: CastSwapSteps } }
    expect(body.data.steps).toEqual({
      sheets: { rules: RULES },
      enginePrompt: { mode: "llm", llm: { model: "gemini-3.1-pro", inputs: ["rolePhotos"], maxChars: 3000 } },
    })
  })

  it("removing every step saves the draft with no steps key", async () => {
    const user = userEvent.setup()
    serve({ steps: { enginePrompt: { mode: "llm", llm: { model: "gemini-3.1-pro", inputs: ["rolePhotos"], maxChars: 3000 } } } })
    renderEditor()
    const editor = await stepsEditor()
    const engine = within(editor).getByRole("region", { name: "Engine prompt step" })
    expect(within(engine).getByRole("radio", { name: "LLM" })).toBeChecked()
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled()
    await user.click(within(engine).getByRole("radio", { name: "Template" }))
    await user.click(screen.getByRole("button", { name: /save draft/i }))
    await waitFor(() => expect(sentTo(`PUT ${BASE}/draft`)).toHaveLength(1))
    const body = sentTo(`PUT ${BASE}/draft`)[0] as { data: Record<string, unknown> }
    expect(body.data).not.toHaveProperty("steps")
  })

  it("the face mask panel says when the scene texts were made with another scene setting", async () => {
    const stored: AdminTrendFaceMask = {
      url: "https://cdn.test/trends/a1/depth.mp4",
      frames: 360,
      recipe: { core: null, plugin: "1" },
      settingsKey: "v2:abc",
      jobId: "00000000-0000-4000-8000-0000000000f1",
      stats: { shots: 0, heldFrames: 0, coverage: 1, droppedRegions: 0 },
      approvedAt: "2026-10-28T10:00:00.000Z",
      approvedBy: "admin",
      sceneDescription: "test scene text",
    }
    serve({ faceMasking: { mode: "always", source: "full-depth" }, faceMask: stored }, { faceMaskState: { status: "approved", reasons: [], sceneStepChanged: true } })
    renderEditor()
    expect(await screen.findByText("Made with another scene setting: make it again.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Make again" })).toBeInTheDocument()
  })

  it("says nothing of the scene setting when it is the one the texts were made with", async () => {
    serve({ faceMasking: { mode: "always", source: "full-depth" } }, { faceMaskState: { status: "approved", reasons: [] } })
    renderEditor()
    await stepsEditor()
    expect(screen.queryByTestId("face-mask-scene-step-changed")).not.toBeInTheDocument()
  })
})
