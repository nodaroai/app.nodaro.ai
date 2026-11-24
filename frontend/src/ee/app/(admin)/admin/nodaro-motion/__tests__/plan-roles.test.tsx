/**
 * Admin → Video Remake → Roles from the prompt: whether this deployment offers
 * roles planned from a person's own words and loose reference images, and the
 * admin's own instructions and model for the engine's planning step.
 *
 * - The switch shows the resolved value and names the deployment's default;
 *   Save sends `enabled` only once an admin chose a value (stored, or off the
 *   default), so the default keeps deciding otherwise.
 * - A step field left empty is the engine's default (read from the engine,
 *   shown as the placeholder and the model list's first option) and sends no key.
 * - "Start from the default" puts the engine's template in the editor (its
 *   placeholders kept, never the filled text), and a hint names them.
 * - The engine's problems (the check, and a refused save's `issues`) are said
 *   at their field.
 * - Where this environment's engine plans no roles, it says so, the step is
 *   greyed out and the switch still saves.
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
import { PLAN_ROLES_REVIEW, PLAN_ROLES_SWITCH_LABEL, PLAN_ROLES_UNSUPPORTED, planRolesSwitchHint, templatePlaceholders } from "../components/PlanRolesSection"

const URL_ = "/v1/admin/video-remake/plan-roles"
const ENGINES = [
  { id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5" },
  { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4" },
]
const TEMPLATE = "Stand-in instructions for the planning step, at most <maxPersons> persons and <maxImages> images, <maxPersons> again."
const PLAN_DEFAULT = "Stand-in instructions for the planning step, at most 3 persons and 4 images, 3 again."
const DEFAULTS = {
  promptMaxChars: 2000,
  maxImages: 4,
  maxFrames: 3,
  timeoutMs: 30_000,
  limits: {},
  roleKinds: [],
  traits: [],
  reasons: [],
  rateLimit: { max: 10, timeWindow: "1 minute" },
  defaults: { plan: { model: "stand-in-model", instructions: PLAN_DEFAULT } },
  instructionsTemplate: TEMPLATE,
}
const MODELS = [
  { id: "stand-in-model", displayName: "Stand-in Model", tier: "standard", vendor: "google", isEnabled: true },
  { id: "other-stand-in-model", displayName: "Other Stand-in Model", tier: "premium", vendor: "google", isEnabled: true },
]
const RUNS_TOAST = "Saved. Runs pick it up within a minute."
const STEP = "Planning step"

interface ViewOver {
  planRoles?: unknown
  enabledByDefault?: boolean
  supported?: boolean
  reviewSupported?: boolean
}
/** The GET's answer: `enabled` resolved as the server resolves it. */
const view = ({ planRoles = null, enabledByDefault = true, supported = true, reviewSupported = true }: ViewOver = {}) => {
  const chosen = (planRoles as { enabled?: unknown } | null)?.enabled
  return {
    body: {
      data: {
        planRoles,
        enabled: typeof chosen === "boolean" ? chosen : enabledByDefault,
        enabledByDefault,
        updatedAt: planRoles ? "2026-11-19T10:00:00.000Z" : null,
        supported,
        reviewSupported,
      },
    },
  }
}
/** The PUT answers the body back, resolved against `enabledByDefault`. */
const echo = (enabledByDefault = true) => (init?: RequestInit) => view({ planRoles: JSON.parse(String(init?.body)).planRoles, enabledByDefault })

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
  routes["GET /v1/admin/llm-models"] = () => ({ body: { data: { models: MODELS, tierCosts: {}, featureCosts: {} } } })
  // The custom style on an engine that takes none: it asks nothing of its own (no defaults, no models).
  routes["GET /v1/admin/video-remake/custom-style"] = () => ({ body: { data: { customStyle: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  // The 3D previz clips and the shot lock (previz-shot-lock.test.tsx): never saved, and an engine that takes neither.
  routes["GET /v1/admin/video-remake/previz"] = () => ({ body: { data: { previz: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  routes["GET /v1/admin/video-remake/shot-lock"] = () => ({ body: { data: { shotLock: null, updatedAt: null, engines: ENGINES, supported: false } } })
  // The shot list's frame rate (shot-list-fps.test.tsx): never saved, and an engine that reads none.
  routes["GET /v1/admin/video-remake/shot-list-fps"] = () => ({ body: { data: { shotListFps: null, fps: 6, defaultFps: 6, options: [1, 2, 3, 4, 6, 8, 12], updatedAt: null, supported: false, rateCarried: true } } })
  // Offer Flash (flash-offer.test.tsx): never saved, on an engine that runs the Flash choices.
  routes["GET /v1/admin/video-remake/flash-offer"] = () => ({ body: { data: { flashOffer: null, updatedAt: null, engines: [{ id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5", flashName: "Nodaro Prism Flash" }, { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4", flashName: "Nodaro Pulse Flash" }], supported: true, environments: [] } } })
  // The Precise upscale (precise-upscale.test.tsx): never saved, every default.
  routes["GET /v1/admin/video-remake/precise-upscale"] = () => ({ body: { data: { value: { "480p": "1080p", "720p": "1080p", "1080p": "4k" }, stored: null, defaults: { "480p": "1080p", "720p": "1080p", "1080p": "4k" }, updatedAt: null, supported: true } } })
  routes[`GET ${URL_}`] = () => view()
  routes[`GET ${URL_}/defaults`] = () => ({ body: { data: DEFAULTS } })
  routes[`POST ${URL_}/check`] = () => ({ body: { data: { problems: [] } } })
  routes[`PUT ${URL_}`] = echo()
})
afterEach(() => vi.unstubAllGlobals())

const offeredSwitch = () => screen.findByRole("switch", { name: PLAN_ROLES_SWITCH_LABEL })
const stepGroup = () => screen.findByRole("group", { name: STEP })
const instructions = async () => within(await stepGroup()).getByRole("textbox", { name: `${STEP}: Instructions` })
/** The instructions once the engine's defaults are in (greyed out before). */
const editableInstructions = async () => {
  const field = await instructions()
  await waitFor(() => expect(field).toBeEnabled())
  return field
}
const modelSelect = async () => within(await stepGroup()).getByRole("combobox", { name: `${STEP}: Model` })
const saveButton = () => screen.getByRole("button", { name: "Save" })
const reviewSelect = async () => within(await stepGroup()).getByRole("combobox", { name: `${STEP}: ${PLAN_ROLES_REVIEW.label}` })

describe("Admin → Video Remake → Roles from the prompt", () => {
  it("shows the resolved switch and names this deployment's default (on), Save off", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await offeredSwitch()
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleDescription(planRolesSwitchHint(true))
    expect(planRolesSwitchHint(true)).toMatch(/own words and add reference images, .* This deployment's default: on\.$/)
    expect(screen.getByRole("group", { name: "Roles from the prompt" })).toContainElement(toggle)
    expect(toggle.closest("section")).toBeNull()
    expect(saveButton()).toBeDisabled()
  })

  it("on a deployment whose default is off, shows it off and says so", async () => {
    routes[`GET ${URL_}`] = () => view({ enabledByDefault: false })
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await offeredSwitch()
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(planRolesSwitchHint(false))
    expect(planRolesSwitchHint(false)).toMatch(/This deployment's default: off\.$/)
  })

  it("saves the switch alone with `enabled` when it leaves the default; back to the default unsaved is no change", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await offeredSwitch()
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(saveButton()).toBeEnabled()
    // Back at the deployment's default with nothing saved: `enabled` stays left out, nothing to save.
    await user.click(toggle)
    expect(saveButton()).toBeDisabled()
    await user.click(toggle)
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ planRoles: { enabled: false } }]))
    expect(sentTo("PUT /v1/admin/video-remake/custom-style")).toEqual([])
    expect(sentTo("PUT /v1/admin/video-remake/advanced")).toEqual([])
    expect(sentTo("PUT /v1/admin/video-remake/masking")).toEqual([])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(RUNS_TOAST))
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(await offeredSwitch()).not.toBeChecked()
  })

  it("keeps sending `enabled` once a choice is stored, the default's value included", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ planRoles: { enabled: false } })
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await offeredSwitch()
    await waitFor(() => expect(toggle).not.toBeChecked())
    await user.click(toggle)
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ planRoles: { enabled: true } }]))
  })

  it("shows the engine's defaults when the admin set none, and names the template's placeholders", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const field = await instructions()
    await waitFor(() => expect(field).toHaveAttribute("placeholder", PLAN_DEFAULT))
    expect(field).toHaveValue("")
    expect(field).toBeEnabled()
    expect(field).toHaveAccessibleDescription(/the engine fills <maxPersons>, <maxImages> at run time/)
    const model = await modelSelect()
    expect(model).toHaveValue("")
    expect(within(model).getByRole("option", { name: "The engine's default (stand-in-model)" })).toBeInTheDocument()
    expect(await within(model).findByRole("option", { name: "Other Stand-in Model" })).toBeInTheDocument()
    expect(screen.queryByText(PLAN_ROLES_UNSUPPORTED)).toBeNull()
  })

  it("names each placeholder of a template once, in order", () => {
    expect(templatePlaceholders(TEMPLATE)).toEqual(["<maxPersons>", "<maxImages>"])
    // The shared cap's placeholder, and the ones of before it that an older text may still carry.
    expect(templatePlaceholders("At most <maxRoles> roles in all; before: <maxPersons> persons, <maxPets> pets, <maxProducts> products.")).toEqual(["<maxRoles>", "<maxPersons>", "<maxPets>", "<maxProducts>"])
    expect(templatePlaceholders("No placeholder here.")).toEqual([])
    expect(templatePlaceholders(undefined)).toEqual([])
  })

  it("Start from the default puts the engine's template in the editor (never the filled text), and saves it as written", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const field = await editableInstructions()
    const start = within(await stepGroup()).getByRole("button", { name: `${STEP}: Start from the default` })
    await user.click(start)
    expect(field).toHaveValue(TEMPLATE)
    expect(start).toBeDisabled()
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ planRoles: { plan: { instructions: TEMPLATE } } }]))
  })

  it("an engine that answers no template offers nothing to start from", async () => {
    const withoutTemplate: Partial<typeof DEFAULTS> = { ...DEFAULTS }
    delete withoutTemplate.instructionsTemplate
    routes[`GET ${URL_}/defaults`] = () => ({ body: { data: withoutTemplate } })
    renderWith(<AdminNodaroMotionPage />)
    const field = await editableInstructions()
    expect(field).toHaveAttribute("placeholder", PLAN_DEFAULT)
    expect(within(await stepGroup()).queryByRole("button", { name: `${STEP}: Start from the default` })).toBeNull()
    expect(field).not.toHaveAccessibleDescription(/the engine fills/)
  })

  it("saves the step's instructions and model; an empty field sends no key", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.type(await editableInstructions(), "Plan the roles.")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ planRoles: { plan: { instructions: "Plan the roles." } } }]))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(RUNS_TOAST))
  })

  it("saves a model of the admin's own alone", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const model = await modelSelect()
    await within(model).findByRole("option", { name: "Other Stand-in Model" })
    await user.selectOptions(model, "other-stand-in-model")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ planRoles: { plan: { model: "other-stand-in-model" } } }]))
  })

  it("the review mode: the engine's default (targeted) unsent, the full review pass saved as the step's review, with its note", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const review = await reviewSelect()
    await waitFor(() => expect(review).toBeEnabled())
    expect(within(review).getAllByRole("option").map((o) => o.textContent)).toEqual([PLAN_ROLES_REVIEW.defaultOption, PLAN_ROLES_REVIEW.fullOption])
    expect(within(await stepGroup()).getByText(PLAN_ROLES_REVIEW.note)).toBeInTheDocument()
    await user.selectOptions(review, "full")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ planRoles: { plan: { review: "full" } } }]))
  })

  it("a saved full review taken back to the default sends the step left out", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ planRoles: { plan: { review: "full" } } })
    renderWith(<AdminNodaroMotionPage />)
    const review = await reviewSelect()
    await waitFor(() => expect(review).toHaveValue("full"))
    await user.selectOptions(review, "")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ planRoles: {} }]))
  })

  it("names the environments whose engine does not read the review mode yet", async () => {
    routes[`GET ${URL_}`] = () => ({ body: { data: { ...view().body.data, reviewMissingIn: ["production"] } } })
    renderWith(<AdminNodaroMotionPage />)
    await editableInstructions()
    expect(within(await stepGroup()).getByText(new RegExp(`Not read yet in: production`))).toBeInTheDocument()
  })

  it("where no engine reads a review mode: only the default, greyed out, and it says so", async () => {
    routes[`GET ${URL_}`] = () => view({ reviewSupported: false })
    renderWith(<AdminNodaroMotionPage />)
    await editableInstructions()
    const review = await reviewSelect()
    expect(review).toBeDisabled()
    expect(within(review).getAllByRole("option").map((o) => o.textContent)).toEqual([PLAN_ROLES_REVIEW.defaultOption])
    expect(within(await stepGroup()).getByText(PLAN_ROLES_REVIEW.unsupported)).toBeInTheDocument()
  })

  it("Reset to default empties saved instructions, and saving sends the step left out", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ planRoles: { plan: { instructions: "Saved planning instructions." } } })
    renderWith(<AdminNodaroMotionPage />)
    const field = await instructions()
    await waitFor(() => expect(field).toHaveValue("Saved planning instructions."))
    await user.click(within(await stepGroup()).getByRole("button", { name: `${STEP}: Reset to default` }))
    expect(field).toHaveValue("")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ planRoles: {} }]))
  })

  it("checks the step as it is edited and says each problem at its field", async () => {
    const user = userEvent.setup()
    routes[`POST ${URL_}/check`] = () => ({
      body: { data: { problems: [{ path: "planRoles.plan.model", code: "model_not_served", message: "Stand-in: the engine does not serve this model." }] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const model = await modelSelect()
    await within(model).findByRole("option", { name: "Other Stand-in Model" })
    await user.selectOptions(model, "other-stand-in-model")
    expect(await within(await stepGroup()).findByText("Stand-in: the engine does not serve this model.")).toBeInTheDocument()
    // Only the step is checked (never the switch).
    expect(sentTo(`POST ${URL_}/check`)).toContainEqual({ planRoles: { plan: { model: "other-stand-in-model" } } })
    // A problem does not hold Save (the server refuses what the engine finds wrong).
    expect(saveButton()).toBeEnabled()
  })

  it("a problem with the step as a whole is said in the step", async () => {
    const user = userEvent.setup()
    routes[`POST ${URL_}/check`] = () => ({
      body: { data: { problems: [{ path: "planRoles.plan", code: "invalid", message: "Stand-in: the step is not taken." }] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    await user.type(await editableInstructions(), "Plan.")
    expect(await within(await stepGroup()).findByText("Stand-in: the step is not taken.")).toBeInTheDocument()
  })

  it("a refused save says its issues at their fields", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = () => ({
      status: 400,
      body: {
        error: {
          code: "validation_error",
          message: "planRoles.plan.instructions: Stand-in: too long.",
          issues: [{ path: "planRoles.plan.instructions", code: "too_long", message: "Stand-in: too long." }],
        },
      },
    })
    renderWith(<AdminNodaroMotionPage />)
    await user.type(await editableInstructions(), "Very long.")
    await user.click(saveButton())
    const group = await stepGroup()
    expect(await within(group).findByText("Stand-in: too long.")).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalled()
    // An edit clears the refusal.
    await user.type(await instructions(), "!")
    await waitFor(() => expect(within(group).queryByText("Stand-in: too long.")).toBeNull())
  })

  it("where this environment's engine plans no roles: says so, asks nothing more, greys out the step and still saves the switch", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ supported: false })
    routes[`GET ${URL_}/defaults`] = () => ({ body: { data: null } })
    renderWith(<AdminNodaroMotionPage />)
    expect(await screen.findByText(PLAN_ROLES_UNSUPPORTED)).toBeInTheDocument()
    expect(await instructions()).toBeDisabled()
    expect(within(await modelSelect()).getByRole("option", { name: "The engine's default" })).toBeInTheDocument()
    expect(within(await stepGroup()).queryByRole("button", { name: `${STEP}: Start from the default` })).toBeNull()
    expect(sentTo(`GET ${URL_}/defaults`)).toEqual([])
    expect(sentTo("GET /v1/admin/llm-models")).toEqual([])
    await user.click(await offeredSwitch())
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ planRoles: { enabled: false } }]))
  })

  it("an engine that answers no defaults is said the same way", async () => {
    routes[`GET ${URL_}/defaults`] = () => ({ body: { data: null } })
    renderWith(<AdminNodaroMotionPage />)
    expect(await screen.findByText(PLAN_ROLES_UNSUPPORTED)).toBeInTheDocument()
    expect(await instructions()).toBeDisabled()
  })

  it("an unsupported engine still lets a saved step be taken back", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ planRoles: { plan: { instructions: "Saved planning instructions.", model: "stand-in-model" } }, supported: false })
    renderWith(<AdminNodaroMotionPage />)
    const group = await stepGroup()
    await waitFor(() => expect(within(group).getByRole("textbox", { name: `${STEP}: Instructions` })).toHaveValue("Saved planning instructions."))
    await user.click(within(group).getByRole("button", { name: `${STEP}: Reset to default` }))
    await user.selectOptions(await modelSelect(), "")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ planRoles: {} }]))
  })
})
