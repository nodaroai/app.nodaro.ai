/**
 * The preparation step editors (StepsEditor, SheetRulesTable, LlmStepEditor,
 * TextStepSwitch), shared by a trend's draft and Admin → Nodaro Motion.
 *
 * - Offered only once every environment's engine takes the steps; otherwise
 *   greyed out naming the environments (nothing is asked of the engine), and
 *   an engine that answers no defaults is said to take none.
 * - Nothing is written until the admin picks: the rules seed the engine's
 *   default rules (Reset restores a kind), LLM seeds the engine's default
 *   model, inputs and length with no instructions; Template and Today's sheet
 *   remove their key, and nothing left set is `undefined`.
 * - The labeller has no input boxes and always reads the role pictures only.
 * - The model list: enabled models only, and only those that take pictures
 *   while the step is shown one.
 * - The check's problems are said under their place; the scene description
 *   is offered for Full depth with the scene from a description only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("@nodaro/shared/llm-models", async (orig) => {
  const real = await orig<typeof import("@nodaro/shared/llm-models")>()
  return {
    ...real,
    getLlmModalityCaps: (id: string | undefined) => (id === "test-text-only" ? { image: false, video: false, audio: false } : real.getLlmModalityCaps(id)),
  }
})

import {
  SHEET_LAYOUTS,
  type AdminTrendFaceMaskingSource,
  type AdminTrendFullDepthScene,
  type CastSwapStepDefaults,
  type CastSwapSteps,
  type SheetRules,
  type TrendEngineEnvironment,
} from "@/lib/api"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes, sentTo } from "./harness"
import { environmentsThatCannotTakeClipBody, environmentsThatCannotTakeSteps } from "../clip-preparation"
import { StepsEditor } from "../components/StepsEditor"
import { layoutLabel } from "../components/SheetRulesTable"

const ENGINE = "seedance-2-5"
const DEFAULTS_URL = `/v1/admin/nodaro-motion/steps/defaults?engine=${ENGINE}`
const CHECK_URL = "/v1/admin/nodaro-motion/steps/check"
const MODELS_URL = "/v1/admin/llm-models"

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
    enginePrompt: { model: "gemini-3.1-pro", instructions: "test instructions", inputs: ["rolePhotos", "extraPrompt"], maxChars: 3000 },
    sceneDescription: { model: "gemini-3.1-pro", instructions: "test scene instructions", inputs: ["clip"], maxChars: 2500 },
    clipBody: { prompt: "test clip body prompt" },
  },
  layoutPrompts: {
    person: { collage: null, "head-3q-body-cut": "test layout prompt", none: null },
    pet: {},
    product: {},
    location: {},
  },
  critical: { "reference-sheet": false, "engine-prompt": false, "scene-description": false, "clip-body": false },
  problems: [],
}

const MODELS = [
  { id: "gemini-3.1-pro", displayName: "Test Pro", tier: "premium", vendor: "google", isEnabled: true },
  { id: "claude-haiku-5.5", displayName: "Test Haiku", tier: "economy", vendor: "anthropic", isEnabled: true },
  { id: "test-text-only", displayName: "Test Text Only", tier: "economy", vendor: "openai", isEnabled: true },
  { id: "gpt-5.5", displayName: "Test Disabled", tier: "standard", vendor: "openai", isEnabled: false },
]

const withSteps = (env: string, steps?: boolean, clipBodySheet?: boolean): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env,
  supports: {
    castSwap: {
      ...ENVIRONMENTS[0]!.supports.castSwap,
      ...(steps === undefined ? {} : { steps }),
      ...(clipBodySheet === undefined ? {} : { clipBodySheet }),
    },
  },
})
const STEP_ENVS = [withSteps("production", true, true), withSteps("staging", true, true)]

let seen: Array<CastSwapSteps | undefined> = []
const last = () => seen[seen.length - 1]

function Harness({
  initial,
  envs = STEP_ENVS,
  source,
  scene,
}: {
  initial?: CastSwapSteps
  /** null = the environments are still unknown. */
  envs?: TrendEngineEnvironment[] | null
  source?: AdminTrendFaceMaskingSource
  scene?: AdminTrendFullDepthScene
}) {
  const [value, setValue] = useState(initial)
  return (
    <StepsEditor
      value={value}
      envs={envs ?? undefined}
      engine={ENGINE}
      source={source}
      scene={scene}
      onChange={(next) => {
        seen.push(next)
        setValue(next)
      }}
    />
  )
}

beforeEach(() => {
  resetRoutes()
  seen = []
  vi.stubGlobal("fetch", fetchMock)
  routes[`GET ${DEFAULTS_URL}`] = () => ({ body: { data: DEFAULTS } })
  routes[`GET ${MODELS_URL}`] = () => ({ body: { data: { models: MODELS, tierCosts: {}, featureCosts: {} } } })
  routes[`POST ${CHECK_URL}`] = () => ({ body: { data: { problems: [] } } })
})
afterEach(() => vi.unstubAllGlobals())

const section = (name: string) => screen.getByRole("region", { name })

describe("environmentsThatCannotTakeSteps", () => {
  it("names every shared environment whose engine lacks castSwap.steps, a missing one included", () => {
    expect(environmentsThatCannotTakeSteps(undefined)).toBeUndefined()
    expect(environmentsThatCannotTakeSteps([])).toEqual(["staging", "production"])
    expect(environmentsThatCannotTakeSteps([withSteps("production", true)])).toEqual(["staging"])
    expect(environmentsThatCannotTakeSteps([withSteps("production"), withSteps("staging", false)])).toEqual(["staging", "production"])
    expect(environmentsThatCannotTakeSteps(STEP_ENVS)).toEqual([])
  })
})

describe("the step editors", { timeout: 20_000 }, () => {
  it("the editor is disabled naming the environment without the capability", async () => {
    renderWith(<Harness envs={[withSteps("production", true), withSteps("staging")]} />)
    expect(screen.getByText(/The Cast Swap engine of staging cannot take preparation steps yet/)).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "By the photos (rules)" })).toBeDisabled()
    expect(within(section("Engine prompt step")).getByRole("radio", { name: "LLM" })).toBeDisabled()
    // Nothing is asked of the engine while it can't take them.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("greyed out, a step already set can still be removed", async () => {
    const user = userEvent.setup()
    const initial: CastSwapSteps = { enginePrompt: { mode: "llm", llm: { model: "gemini-3.1-pro", inputs: ["clip"], maxChars: 3000 } } }
    renderWith(<Harness initial={initial} envs={[withSteps("production")]} />)
    expect(screen.getByText(/remove them to publish or save/)).toBeInTheDocument()
    const engine = section("Engine prompt step")
    expect(within(engine).getByRole("radio", { name: "LLM" })).toBeDisabled()
    await user.click(within(engine).getByRole("radio", { name: "Template" }))
    expect(last()).toBeUndefined()
  })

  it("says so when this environment's engine answers no defaults", async () => {
    routes[`GET ${DEFAULTS_URL}`] = () => ({ body: { data: null } })
    renderWith(<Harness />)
    expect(await screen.findByText("This environment's engine does not take preparation steps yet.")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "By the photos (rules)" })).toBeDisabled()
  })

  it("the rules table seeds the default and Reset restores it", async () => {
    const user = userEvent.setup()
    renderWith(<Harness />)
    const rules = await screen.findByRole("radio", { name: "By the photos (rules)" })
    await waitFor(() => expect(rules).toBeEnabled())
    // Loading the defaults wrote nothing.
    expect(seen).toEqual([])
    await user.click(rules)
    expect(last()).toEqual({ sheets: { rules: RULES } })

    const headOnly = screen.getByRole("combobox", { name: "Person: head only" })
    expect(headOnly).toHaveValue("head-3q-body-cut")
    const options = within(headOnly).getAllByRole("option").map((o) => o.textContent)
    expect(options[0]).toBe("1 Collage (no AI)")
    expect(options[1]).toBe("2 Head + body")
    expect(options[options.length - 1]).toBe("None (raw photos)")

    await user.selectOptions(headOnly, "collage")
    expect(last()?.sheets?.rules.person["head-only"]).toBe("collage")
    expect(last()?.sheets?.rules.pet).toEqual(RULES.pet)

    await user.click(screen.getByRole("button", { name: "Reset the person rules to default" }))
    expect(last()).toEqual({ sheets: { rules: RULES } })
    expect(screen.getByRole("button", { name: "Reset the person rules to default" })).toBeDisabled()

    await user.click(screen.getByRole("radio", { name: "Today's sheet" }))
    expect(last()).toBeUndefined()
  })

  it("a row opens to its layout's prompt, read-only; the collage and none say they use no AI", async () => {
    const user = userEvent.setup()
    renderWith(<Harness initial={{ sheets: { rules: { ...RULES, person: { ...RULES.person, unclear: "collage" } } } }} />)
    await user.click(await screen.findByRole("button", { name: "Show the person head only prompt" }))
    expect(screen.getByTestId("layout-prompt")).toHaveTextContent("test layout prompt")
    await user.click(screen.getByRole("button", { name: "Show the person unclear prompt" }))
    expect(screen.getByText("No prompt — no AI")).toBeInTheDocument()
  })

  it("the labeller shows no input boxes and always reads the role pictures only", async () => {
    const user = userEvent.setup()
    renderWith(<Harness initial={{ sheets: { rules: RULES } }} />)
    const sheets = await screen.findByRole("region", { name: "Reference sheets step" })
    const labeller = await within(sheets).findByRole("group", { name: "The labeller" })
    expect(within(labeller).queryByRole("checkbox")).not.toBeInTheDocument()
    expect(within(labeller).queryByText("What it sees")).not.toBeInTheDocument()
    // Shown with the engine's default, written only once edited.
    expect(within(labeller).getByRole("textbox", { name: "Instructions" })).toHaveAttribute("placeholder", "test labeller instructions")
    const length = within(labeller).getByRole("spinbutton", { name: "Length (characters)" })
    expect(length).toHaveValue(900)
    await user.clear(length)
    await user.type(length, "1200")
    expect(last()?.sheets?.labeller).toEqual({ model: "claude-haiku-5.5", inputs: ["rolePhotos"], maxChars: 1200 })
  })

  it("switching a text step to LLM shows the model, instructions, inputs and length", async () => {
    const user = userEvent.setup()
    renderWith(<Harness />)
    const engine = section("Engine prompt step")
    const llm = within(engine).getByRole("radio", { name: "LLM" })
    await waitFor(() => expect(llm).toBeEnabled())
    await user.click(llm)
    // The engine's default, with no instructions (empty = the default).
    expect(last()).toEqual({ enginePrompt: { mode: "llm", llm: { model: "gemini-3.1-pro", inputs: ["rolePhotos", "extraPrompt"], maxChars: 3000 } } })

    await waitFor(() => expect(within(engine).getByRole("combobox", { name: "Model" })).toHaveValue("gemini-3.1-pro"))
    const instructions = within(engine).getByRole("textbox", { name: "Instructions" })
    expect(instructions).toHaveValue("")
    expect(instructions).toHaveAttribute("placeholder", "test instructions")
    expect(within(engine).getByRole("checkbox", { name: "The clip" })).not.toBeChecked()
    expect(within(engine).getByRole("checkbox", { name: "The role pictures" })).toBeChecked()
    expect(within(engine).getByRole("checkbox", { name: "The fixed references" })).not.toBeChecked()
    expect(within(engine).getByRole("checkbox", { name: "The person's extra prompt" })).toBeChecked()
    expect(within(engine).getByRole("spinbutton", { name: "Length (characters)" })).toHaveValue(3000)
    expect(within(engine).getByText(/the engine's prompt cap/)).toBeInTheDocument()

    await user.type(instructions, "test edited")
    expect(last()?.enginePrompt).toEqual({ mode: "llm", llm: { model: "gemini-3.1-pro", inputs: ["rolePhotos", "extraPrompt"], maxChars: 3000, instructions: "test edited" } })
    await user.click(within(engine).getByRole("button", { name: "Reset to default" }))
    expect(last()?.enginePrompt).toEqual({ mode: "llm", llm: { model: "gemini-3.1-pro", inputs: ["rolePhotos", "extraPrompt"], maxChars: 3000 } })

    await user.click(within(engine).getByRole("checkbox", { name: "The clip" }))
    expect(last()?.enginePrompt).toMatchObject({ llm: { inputs: ["clip", "rolePhotos", "extraPrompt"] } })

    // Template removes the key; nothing left set is no setting.
    await user.click(within(engine).getByRole("radio", { name: "Template" }))
    expect(last()).toBeUndefined()
  })

  it("offers enabled models only, and only those that take pictures while the step sees one", async () => {
    const user = userEvent.setup()
    renderWith(<Harness initial={{ enginePrompt: { mode: "llm", llm: { model: "gemini-3.1-pro", inputs: ["rolePhotos"], maxChars: 3000 } } }} />)
    const engine = section("Engine prompt step")
    const model = await within(engine).findByRole("combobox", { name: "Model" })
    await waitFor(() => expect(within(model).getAllByRole("option").map((o) => o.textContent)).toEqual(["Test Pro", "Test Haiku"]))
    await user.click(within(engine).getByRole("checkbox", { name: "The role pictures" }))
    await user.click(within(engine).getByRole("checkbox", { name: "The person's extra prompt" }))
    expect(within(model).getAllByRole("option").map((o) => o.textContent)).toEqual(["Test Pro", "Test Haiku", "Test Text Only"])
  })

  it("shows the check's problems under their place, debounced", async () => {
    const user = userEvent.setup()
    routes[`POST ${CHECK_URL}`] = () => ({
      body: { data: { problems: [{ path: "enginePrompt.llm.model", code: "model_cannot_see_images", message: "test problem" }] } },
    })
    renderWith(<Harness />)
    const engine = section("Engine prompt step")
    const llm = within(engine).getByRole("radio", { name: "LLM" })
    await waitFor(() => expect(llm).toBeEnabled())
    await user.click(llm)
    expect(await within(engine).findByText("test problem")).toBeInTheDocument()
    expect(sentTo(`POST ${CHECK_URL}`)).toEqual([
      { engine: ENGINE, steps: { enginePrompt: { mode: "llm", llm: { model: "gemini-3.1-pro", inputs: ["rolePhotos", "extraPrompt"], maxChars: 3000 } } } },
    ])
  })

  it("tags each section not critical, and offers the scene description only for Full depth from a description", async () => {
    const { unmount } = renderWith(<Harness source="full-depth" scene="description" />)
    const scene = await screen.findByRole("region", { name: "Scene description step" })
    await waitFor(() => expect(within(scene).getByText("Not critical — skipped if it fails")).toBeInTheDocument())
    expect(within(section("Reference sheets step")).getByText("Not critical — skipped if it fails")).toBeInTheDocument()
    expect(within(section("Engine prompt step")).getByText("Not critical — skipped if it fails")).toBeInTheDocument()
    unmount()
    renderWith(<Harness source="full-depth" scene="original" />)
    await screen.findByRole("region", { name: "Engine prompt step" })
    expect(screen.queryByRole("region", { name: "Scene description step" })).not.toBeInTheDocument()
  })

  it("labels every layout id readably, numbered in the kind's list", () => {
    for (const kind of ["person", "pet", "product", "location"] as const) {
      const list = SHEET_LAYOUTS[kind]
      for (const layout of list) {
        const label = layoutLabel(list, layout)
        expect(label).not.toContain(layout === "none" ? "none" : layout)
      }
    }
    expect(layoutLabel(SHEET_LAYOUTS.product, "turnaround")).toBe("3 Turnaround")
  })
})

describe("environmentsThatCannotTakeClipBody", () => {
  it("names every shared environment whose engine lacks castSwap.steps or castSwap.clipBodySheet", () => {
    expect(environmentsThatCannotTakeClipBody(undefined)).toBeUndefined()
    expect(environmentsThatCannotTakeClipBody([])).toEqual(["staging", "production"])
    expect(environmentsThatCannotTakeClipBody([withSteps("production", true), withSteps("staging", true, true)])).toEqual(["production"])
    expect(environmentsThatCannotTakeClipBody([withSteps("production", false, true), withSteps("staging", true, true)])).toEqual(["production"])
    expect(environmentsThatCannotTakeClipBody(STEP_ENVS)).toEqual([])
  })
})

describe("Body from the clip", { timeout: 20_000 }, () => {
  const clipBody = () => section("Body from the clip step")
  const toggle = () => within(clipBody()).getByRole("switch", { name: "Body from the clip" })
  const prompt = () => within(clipBody()).getByRole("textbox", { name: "Image prompt" })

  it("unset reads as on, with the engine's prompt as the placeholder and the hint; loading writes nothing", async () => {
    renderWith(<Harness />)
    await waitFor(() => expect(prompt()).toBeEnabled())
    expect(toggle()).toBeChecked()
    expect(prompt()).toHaveValue("")
    expect(prompt()).toHaveAttribute("placeholder", "test clip body prompt")
    expect(within(clipBody()).getByText("For a person whose Outfit is new and Body or Hair is from the clip.")).toBeInTheDocument()
    expect(within(clipBody()).getByText("Not critical — skipped if it fails")).toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it("Off is stored; On again with no prompt removes the key (the engine's default)", async () => {
    const user = userEvent.setup()
    renderWith(<Harness />)
    await waitFor(() => expect(prompt()).toBeEnabled())
    await user.click(toggle())
    expect(last()).toEqual({ clipBody: { mode: "off" } })
    expect(toggle()).not.toBeChecked()
    expect(prompt()).toBeDisabled()
    await user.click(toggle())
    expect(last()).toBeUndefined()
  })

  it("a prompt overrides the default; emptied, the key goes; Off drops it", async () => {
    const user = userEvent.setup()
    renderWith(<Harness initial={{ enginePrompt: { mode: "template" } as never }} />)
    await waitFor(() => expect(prompt()).toBeEnabled())
    await user.type(prompt(), "ab")
    expect(last()).toMatchObject({ clipBody: { mode: "on", prompt: "ab" } })
    await user.clear(prompt())
    expect(last()?.clipBody).toBeUndefined()
    await user.type(prompt(), "c")
    await user.click(toggle())
    expect(last()?.clipBody).toEqual({ mode: "off" })
    expect(prompt()).toHaveAttribute("maxlength", "4000")
  })

  it("names where it runs; with every environment, the prompt is editable", async () => {
    renderWith(<Harness />)
    await waitFor(() => expect(prompt()).toBeEnabled())
    expect(within(clipBody()).getByText("Runs in: staging, production")).toBeInTheDocument()
  })

  it("with environments on mixed versions: the real state, where it runs and not, and Off still choosable", async () => {
    const user = userEvent.setup()
    renderWith(<Harness envs={[withSteps("production", true, true), withSteps("staging", true)]} />)
    await screen.findByRole("region", { name: "Body from the clip step" })
    expect(within(clipBody()).getByText("Runs in: production · Not yet in: staging")).toBeInTheDocument()
    expect(toggle()).toBeEnabled()
    expect(toggle()).toBeChecked()
    // A prompt of its own needs every environment: not offered.
    expect(prompt()).toBeDisabled()
    await user.click(toggle())
    expect(last()).toEqual({ clipBody: { mode: "off" } })
    expect(toggle()).not.toBeChecked()
    await user.click(toggle())
    expect(last()).toBeUndefined()
  })

  it("Off reads Off and stays choosable even where no environment takes steps yet", async () => {
    const user = userEvent.setup()
    renderWith(<Harness initial={{ clipBody: { mode: "off" } }} envs={[withSteps("production"), withSteps("staging")]} />)
    expect(toggle()).toBeEnabled()
    expect(toggle()).not.toBeChecked()
    expect(within(clipBody()).getByText("Not yet in: staging, production")).toBeInTheDocument()
    // Off needs nothing: no "remove them" warning for it.
    expect(screen.queryByText(/remove them to publish or save/)).not.toBeInTheDocument()
    await user.click(toggle())
    expect(last()).toBeUndefined()
  })

  it("a prompt of its own set before, where an environment lacks the step, can be removed", async () => {
    const user = userEvent.setup()
    renderWith(<Harness initial={{ clipBody: { mode: "on", prompt: "test own prompt" } }} envs={[withSteps("production", true, true), withSteps("staging", true)]} />)
    await screen.findByRole("region", { name: "Body from the clip step" })
    expect(within(clipBody()).getByText(/needs every environment's engine to run the step/)).toBeInTheDocument()
    await user.click(within(clipBody()).getByRole("button", { name: "Remove the prompt" }))
    expect(last()).toBeUndefined()
  })

  it("is not choosable while the environments are unknown", () => {
    renderWith(<Harness envs={null} />)
    expect(toggle()).toBeDisabled()
  })

  it("says a placeholder the engine does not fill before Save, once", async () => {
    const user = userEvent.setup()
    routes[`POST ${CHECK_URL}`] = () => ({
      body: { data: { problems: [{ path: "clipBody.prompt", code: "clip_body_placeholder", message: "server placeholder problem" }] } },
    })
    renderWith(<Harness />)
    await waitFor(() => expect(prompt()).toBeEnabled())
    await user.type(prompt(), "Draw {{Subject} and {{body}")
    expect(within(clipBody()).getByText("Unknown placeholder {Subject}: the image prompt may name {subject}, {body} and {hair} only.")).toBeInTheDocument()
    await waitFor(() => expect(sentTo(`POST ${CHECK_URL}`).length).toBeGreaterThan(0))
    expect(screen.queryByText("server placeholder problem")).not.toBeInTheDocument()
    await user.clear(prompt())
    await user.type(prompt(), "Draw {{subject}")
    expect(within(clipBody()).queryByText(/Unknown placeholder/)).not.toBeInTheDocument()
  })

  it("shows the check's problems under it", async () => {
    const user = userEvent.setup()
    routes[`POST ${CHECK_URL}`] = () => ({
      body: { data: { problems: [{ path: "clipBody.prompt", code: "too_big", message: "test clip body problem" }] } },
    })
    renderWith(<Harness />)
    await waitFor(() => expect(prompt()).toBeEnabled())
    await user.type(prompt(), "x")
    expect(await within(clipBody()).findByText("test clip body problem")).toBeInTheDocument()
    // Said once, under its own section only.
    expect(screen.getAllByText("test clip body problem")).toHaveLength(1)
  })
})
