/**
 * Admin → Video Remake → Custom style: whether this deployment offers a style
 * in the person's own words (Nodaro Prism only), and the admin's own
 * instructions and model for the engine's two LLM steps (medium, describe).
 *
 * - The switch shows the resolved value and names the deployment's default;
 *   Save sends `enabled` only once an admin chose a value (stored, or off the
 *   default), so the default keeps deciding otherwise.
 * - A step field left empty is the engine's default (read from the engine,
 *   shown as the placeholder and the model list's first option) and sends no key.
 * - The engine's problems (the check, and a refused save's `issues`) are said
 *   at their field.
 * - Where this environment's engine takes no custom style, it says so, the
 *   steps are greyed out and the switch still saves.
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
import { CUSTOM_STYLE_SWITCH_LABEL, CUSTOM_STYLE_UNSUPPORTED, customStyleSwitchHint } from "../components/CustomStyleSection"

const URL_ = "/v1/admin/video-remake/custom-style"
const ENGINES = [
  { id: "nodaro-prism", name: "Nodaro Prism", internal: "seedance-2-5" },
  { id: "nodaro-pulse", name: "Nodaro Pulse", internal: "kling-4" },
]
const MEDIUM_DEFAULT = "Stand-in instructions for the medium step."
const DESCRIBE_DEFAULT = "Stand-in instructions for the describe step."
const DEFAULTS = {
  maxChars: 300,
  noteMaxChars: 200,
  mediums: [],
  tones: [],
  fallback: null,
  describeRateLimit: null,
  defaults: {
    medium: { model: "stand-in-model", instructions: MEDIUM_DEFAULT },
    describe: { model: "stand-in-model", instructions: DESCRIBE_DEFAULT },
  },
}
const MODELS = [
  { id: "stand-in-model", displayName: "Stand-in Model", tier: "standard", vendor: "google", isEnabled: true },
  { id: "other-stand-in-model", displayName: "Other Stand-in Model", tier: "premium", vendor: "google", isEnabled: true },
]
const RUNS_TOAST = "Saved. Runs pick it up within a minute."

interface ViewOver {
  customStyle?: unknown
  enabledByDefault?: boolean
  supported?: boolean
}
/** The GET's answer: `enabled` resolved as the server resolves it. */
const view = ({ customStyle = null, enabledByDefault = true, supported = true }: ViewOver = {}) => {
  const chosen = (customStyle as { enabled?: unknown } | null)?.enabled
  return {
    body: {
      data: {
        customStyle,
        enabled: typeof chosen === "boolean" ? chosen : enabledByDefault,
        enabledByDefault,
        updatedAt: customStyle ? "2026-11-19T10:00:00.000Z" : null,
        supported,
      },
    },
  }
}
/** The PUT answers the body back, resolved against `enabledByDefault`. */
const echo = (enabledByDefault = true) => (init?: RequestInit) => view({ customStyle: JSON.parse(String(init?.body)).customStyle, enabledByDefault })

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
  routes["GET /v1/admin/video-remake/plan-roles"] = () => ({ body: { data: { planRoles: null, enabled: true, enabledByDefault: true, updatedAt: null, supported: false } } })
  routes[`GET ${URL_}`] = () => view()
  routes[`GET ${URL_}/defaults`] = () => ({ body: { data: DEFAULTS } })
  routes[`POST ${URL_}/check`] = () => ({ body: { data: { problems: [] } } })
  routes[`PUT ${URL_}`] = echo()
})
afterEach(() => vi.unstubAllGlobals())

const customSwitch = () => screen.findByRole("switch", { name: CUSTOM_STYLE_SWITCH_LABEL })
const stepGroup = (title: "Medium step" | "Describe step") => screen.findByRole("group", { name: title })
const instructionsOf = async (title: "Medium step" | "Describe step") => within(await stepGroup(title)).getByRole("textbox", { name: `${title}: Instructions` })
/** The instructions once the engine's defaults are in (greyed out before). */
const editableInstructionsOf = async (title: "Medium step" | "Describe step") => {
  const field = await instructionsOf(title)
  await waitFor(() => expect(field).toBeEnabled())
  return field
}
const modelOf = async (title: "Medium step" | "Describe step") => within(await stepGroup(title)).getByRole("combobox", { name: `${title}: Model` })
const saveButton = () => screen.getByRole("button", { name: "Save" })

describe("Admin → Video Remake → Custom style", () => {
  it("shows the resolved switch and names this deployment's default (on), Save off", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await customSwitch()
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleDescription(customStyleSwitchHint(true))
    expect(customStyleSwitchHint(true)).toMatch(/own words, or from an image, instead of picking an art style\. Nodaro Prism only\. This deployment's default: on\.$/)
    expect(toggle.closest("section")).toBeNull()
    expect(saveButton()).toBeDisabled()
  })

  it("on a deployment whose default is off, shows it off and says so", async () => {
    routes[`GET ${URL_}`] = () => view({ enabledByDefault: false })
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await customSwitch()
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(customStyleSwitchHint(false))
    expect(customStyleSwitchHint(false)).toMatch(/This deployment's default: off\.$/)
  })

  it("saves the switch alone with `enabled` when it leaves the default; back to the default unsaved is no change", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await customSwitch()
    await user.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(saveButton()).toBeEnabled()
    // Back at the deployment's default with nothing saved: `enabled` stays left out, nothing to save.
    await user.click(toggle)
    expect(saveButton()).toBeDisabled()
    await user.click(toggle)
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ customStyle: { enabled: false } }]))
    expect(sentTo("PUT /v1/admin/video-remake/advanced")).toEqual([])
    expect(sentTo("PUT /v1/admin/video-remake/masking")).toEqual([])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(RUNS_TOAST))
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(await customSwitch()).not.toBeChecked()
  })

  it("keeps sending `enabled` once a choice is stored, the default's value included", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ customStyle: { enabled: false } })
    renderWith(<AdminNodaroMotionPage />)
    const toggle = await customSwitch()
    await waitFor(() => expect(toggle).not.toBeChecked())
    await user.click(toggle)
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ customStyle: { enabled: true } }]))
  })

  it("shows the engine's defaults when the admin set none", async () => {
    renderWith(<AdminNodaroMotionPage />)
    const medium = await instructionsOf("Medium step")
    await waitFor(() => expect(medium).toHaveAttribute("placeholder", MEDIUM_DEFAULT))
    expect(medium).toHaveValue("")
    expect(medium).toBeEnabled()
    expect(await instructionsOf("Describe step")).toHaveAttribute("placeholder", DESCRIBE_DEFAULT)
    const model = await modelOf("Medium step")
    expect(model).toHaveValue("")
    expect(within(model).getByRole("option", { name: "The engine's default (stand-in-model)" })).toBeInTheDocument()
    expect(await within(model).findByRole("option", { name: "Other Stand-in Model" })).toBeInTheDocument()
    expect(screen.queryByText(CUSTOM_STYLE_UNSUPPORTED)).toBeNull()
  })

  it("saves each step's instructions and model under its name; an empty field sends no key", async () => {
    const user = userEvent.setup()
    renderWith(<AdminNodaroMotionPage />)
    await user.type(await editableInstructionsOf("Medium step"), "Pick one medium.")
    const describeModel = await modelOf("Describe step")
    await within(describeModel).findByRole("option", { name: "Other Stand-in Model" })
    await user.selectOptions(describeModel, "other-stand-in-model")
    await user.click(saveButton())
    await waitFor(() =>
      expect(sentTo(`PUT ${URL_}`)).toEqual([{ customStyle: { medium: { instructions: "Pick one medium." }, describe: { model: "other-stand-in-model" } } }]),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(RUNS_TOAST))
  })

  it("Reset to default empties saved instructions, and saving sends the step left out", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ customStyle: { medium: { instructions: "Saved medium instructions." } } })
    renderWith(<AdminNodaroMotionPage />)
    const medium = await instructionsOf("Medium step")
    await waitFor(() => expect(medium).toHaveValue("Saved medium instructions."))
    await user.click(within(await stepGroup("Medium step")).getByRole("button", { name: "Medium step: Reset to default" }))
    expect(medium).toHaveValue("")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ customStyle: {} }]))
  })

  it("checks the steps as they are edited and says each problem at its field", async () => {
    const user = userEvent.setup()
    routes[`POST ${URL_}/check`] = () => ({
      body: { data: { problems: [{ path: "customStyle.medium.model", code: "model_not_served", message: "Stand-in: the engine does not serve this model." }] } },
    })
    renderWith(<AdminNodaroMotionPage />)
    const model = await modelOf("Medium step")
    await within(model).findByRole("option", { name: "Other Stand-in Model" })
    await user.selectOptions(model, "other-stand-in-model")
    const medium = await stepGroup("Medium step")
    expect(await within(medium).findByText("Stand-in: the engine does not serve this model.")).toBeInTheDocument()
    expect(within(await stepGroup("Describe step")).queryByText("Stand-in: the engine does not serve this model.")).toBeNull()
    // Only the steps are checked (never the switch).
    expect(sentTo(`POST ${URL_}/check`)).toContainEqual({ customStyle: { medium: { model: "other-stand-in-model" } } })
    // A problem does not hold Save (the server refuses what the engine finds wrong).
    expect(saveButton()).toBeEnabled()
  })

  it("a refused save says its issues at their fields", async () => {
    const user = userEvent.setup()
    routes[`PUT ${URL_}`] = () => ({
      status: 400,
      body: {
        error: {
          code: "validation_error",
          message: "customStyle.describe.instructions: Stand-in: too long.",
          issues: [{ path: "customStyle.describe.instructions", code: "too_long", message: "Stand-in: too long." }],
        },
      },
    })
    renderWith(<AdminNodaroMotionPage />)
    await user.type(await editableInstructionsOf("Describe step"), "Very long.")
    await user.click(saveButton())
    const describeGroup = await stepGroup("Describe step")
    expect(await within(describeGroup).findByText("Stand-in: too long.")).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalled()
    // An edit clears the refusal.
    await user.type(await instructionsOf("Describe step"), "!")
    await waitFor(() => expect(within(describeGroup).queryByText("Stand-in: too long.")).toBeNull())
  })

  it("where this environment's engine takes no custom style: says so, asks nothing more, greys out the steps and still saves the switch", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ supported: false })
    routes[`GET ${URL_}/defaults`] = () => ({ body: { data: null } })
    renderWith(<AdminNodaroMotionPage />)
    expect(await screen.findByText(CUSTOM_STYLE_UNSUPPORTED)).toBeInTheDocument()
    expect(await instructionsOf("Medium step")).toBeDisabled()
    expect(within(await modelOf("Medium step")).getByRole("option", { name: "The engine's default" })).toBeInTheDocument()
    expect(sentTo(`GET ${URL_}/defaults`)).toEqual([])
    expect(sentTo("GET /v1/admin/llm-models")).toEqual([])
    await user.click(await customSwitch())
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ customStyle: { enabled: false } }]))
  })

  it("an engine that answers no defaults is said the same way", async () => {
    routes[`GET ${URL_}/defaults`] = () => ({ body: { data: null } })
    renderWith(<AdminNodaroMotionPage />)
    expect(await screen.findByText(CUSTOM_STYLE_UNSUPPORTED)).toBeInTheDocument()
    expect(await instructionsOf("Describe step")).toBeDisabled()
  })

  it("an unsupported engine still lets a saved step be taken back", async () => {
    const user = userEvent.setup()
    routes[`GET ${URL_}`] = () => view({ customStyle: { describe: { instructions: "Saved describe instructions.", model: "stand-in-model" } }, supported: false })
    renderWith(<AdminNodaroMotionPage />)
    const describeGroup = await stepGroup("Describe step")
    await waitFor(() => expect(within(describeGroup).getByRole("textbox", { name: "Describe step: Instructions" })).toHaveValue("Saved describe instructions."))
    await user.click(within(describeGroup).getByRole("button", { name: "Describe step: Reset to default" }))
    await user.selectOptions(await modelOf("Describe step"), "")
    await user.click(saveButton())
    await waitFor(() => expect(sentTo(`PUT ${URL_}`)).toEqual([{ customStyle: {} }]))
  })
})
