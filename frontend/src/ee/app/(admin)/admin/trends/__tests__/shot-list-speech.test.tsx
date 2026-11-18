/**
 * "Speech in the script" (decided 2026-11-18): the shot list step, per style, beside the style's model picker — Off,
 * Who speaks and when, Who speaks, when and the words (`shotList.<style>.speech`) — and, while it is not Off, "Other
 * mouths" (`speechMouth`: the default "spoken", "all", "none").
 *
 * - Shown on Admin → Video Remake and in a trend's editor alike.
 * - Offered once every environment's engine declares `castSwap.shotListSpeech` and its platform claims
 *   `shotListSpeech`; otherwise disabled with a short "Not available yet" note naming the environments, a value
 *   already set still choosable back to Off.
 * - Off is never written: a style at its defaults with speech Off is left out. An LLM edit keeps the speech.
 * - The shot list's model picker offers Gemini 4 Hydrogen while it is shown the clip on Admin → Video Remake only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))

import { SHEET_LAYOUTS, type CastSwapStepDefaults, type CastSwapSteps, type TrendEngineEnvironment } from "@/lib/api"
import { ENVIRONMENTS, fetchMock, renderWith, resetRoutes, routes } from "./harness"
import { environmentsThatCannotTakeShotListSpeech } from "../clip-preparation"
import { normaliseShotList, shotListNeedsEngine, shotListSpeechSet } from "../shot-list"
import { offeredModels } from "../components/LlmStepEditor"
import { StepsEditor } from "../components/StepsEditor"

const ENGINE = "seedance-2-5"
const DEFAULTS_URL = `/v1/admin/video-remake/steps/defaults?engine=${ENGINE}`
const SHOT_LLM = { model: "gemini-3.8-flash", instructions: "test shot list instructions", inputs: ["clip", "rolePhotos"] as ("clip" | "rolePhotos")[], maxChars: 4000 }

const DEFAULTS: CastSwapStepDefaults = {
  conditions: ["head-body", "body-only", "head-only", "unclear"],
  layouts: { person: [...SHEET_LAYOUTS.person], pet: [...SHEET_LAYOUTS.pet], product: [...SHEET_LAYOUTS.product], location: [...SHEET_LAYOUTS.location] },
  todayLayout: { person: "collage", pet: "collage", product: "collage", location: "collage" },
  defaultRules: {
    person: { "head-body": "collage", "body-only": "collage", "head-only": "collage", unclear: "none" },
    pet: { "head-body": "collage", "body-only": "collage", "head-only": "collage", unclear: "none" },
    product: { "head-body": "collage", "body-only": "collage", "head-only": "collage", unclear: "none" },
    location: { "head-body": "none", "body-only": "none", "head-only": "none", unclear: "none" },
  },
  defaults: {
    labeller: { model: "gemini-3.8-flash", instructions: "test labeller instructions", inputs: ["rolePhotos"], maxChars: 900 },
    enginePrompt: { model: "gemini-3.8-flash", instructions: "test instructions", inputs: ["extraPrompt"], maxChars: 3000 },
    sceneDescription: { model: "gemini-3.8-flash", instructions: "test scene instructions", inputs: ["clip"], maxChars: 2500 },
    shotList: { precise: { mode: "off", llm: { ...SHOT_LLM, inputs: [...SHOT_LLM.inputs] } }, flex: { mode: "on", llm: { ...SHOT_LLM, inputs: [...SHOT_LLM.inputs] } } },
  },
  layoutPrompts: { person: {}, pet: {}, product: {}, location: {} },
  critical: { "scene-description": false },
  problems: [],
}

const model = (id: string, displayName: string) => ({ id, displayName, tier: "premium", vendor: "google", isEnabled: true }) as Parameters<typeof offeredModels>[0][number]
const MODELS = [model("gemini-3.8-flash", "Gemini 3.8 Flash"), model("gemini-4-carbon", "Gemini 4 Carbon"), model("gemini-4-hydrogen", "Gemini 4 Hydrogen")]

/** An environment whose engine takes the shot list (and its speech when `engine`), and whose platform claims it when `platform`. */
const env = (name: string, o: { engine?: boolean; platform?: boolean } = {}): TrendEngineEnvironment => ({
  ...ENVIRONMENTS[0]!,
  env: name,
  supports: {
    castSwap: { ...ENVIRONMENTS[0]!.supports.castSwap, steps: true, shotList: true, ...(o.engine ? { shotListSpeech: true } : {}) },
    ...(o.platform ? { platform: { shotListSpeech: true } } : {}),
  },
})
const READY = [env("production", { engine: true, platform: true }), env("staging", { engine: true, platform: true })]

let seen: Array<CastSwapSteps | undefined> = []
const last = () => seen[seen.length - 1]

/** `videoRemake`: Admin → Video Remake's editor (Hydrogen offered); false: a trend's. */
function Harness({ initial, envs = READY, videoRemake = true }: { initial?: CastSwapSteps; envs?: TrendEngineEnvironment[]; videoRemake?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <StepsEditor
      value={value}
      envs={envs}
      engine={ENGINE}
      source="full-depth"
      scene="description"
      llmNodeOnlyMedia={videoRemake}
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
  routes["GET /v1/admin/llm-models"] = () => ({ body: { data: { models: MODELS, tierCosts: {}, featureCosts: {} } } })
  routes["POST /v1/admin/video-remake/steps/check"] = () => ({ body: { data: { problems: [] } } })
})
afterEach(() => vi.unstubAllGlobals())

const shotList = () => screen.getByRole("region", { name: "Shot list step" })
const speechOf = (style: "Precise" | "Flex") => within(shotList()).getByRole("combobox", { name: `${style} shot list: speech in the script` })

describe("the setting (pure)", () => {
  it("Off is never written; who and words keep the style, Precise's only while Precise is on", () => {
    expect(normaliseShotList({ flex: { mode: "on", speech: "off" } })).toBeUndefined()
    expect(normaliseShotList({ flex: { mode: "on", speech: "who" } })).toEqual({ flex: { mode: "on", speech: "who" } })
    expect(normaliseShotList({ precise: { mode: "on", speech: "words" } })).toEqual({ precise: { mode: "on", speech: "words" } })
    expect(normaliseShotList({ precise: { mode: "off", speech: "words" } })).toBeUndefined()
    expect(normaliseShotList({ precise: { mode: "on", speech: "off" }, flex: { mode: "on", llm: SHOT_LLM, speech: "off" } })).toEqual({ precise: { mode: "on" }, flex: { mode: "on", llm: SHOT_LLM } })
  })

  it("asks for speech, and so needs an engine that runs the shot list, only with who or words", () => {
    expect(shotListSpeechSet({ flex: { mode: "on", speech: "who" } })).toBe(true)
    expect(shotListSpeechSet({ flex: { mode: "on", speech: "off" } })).toBe(false)
    expect(shotListNeedsEngine({ flex: { mode: "on", speech: "words" } })).toBe(true)
    expect(shotListNeedsEngine({ flex: { mode: "on", speech: "off" } })).toBe(false)
  })

  it("names the environments whose engine or platform cannot take it", () => {
    expect(environmentsThatCannotTakeShotListSpeech(undefined)).toBeUndefined()
    expect(environmentsThatCannotTakeShotListSpeech(READY)).toEqual({ engine: [], platform: [] })
    expect(environmentsThatCannotTakeShotListSpeech([env("production", { engine: true }), env("staging", { platform: true })])).toEqual({ engine: ["staging"], platform: ["production"] })
    expect(environmentsThatCannotTakeShotListSpeech([])).toEqual({ engine: ["staging", "production"], platform: ["staging", "production"] })
  })
})

describe("the shot list's models", () => {
  it("offers Gemini 3.8 Flash, Gemini 4 Carbon and Gemini 4 Hydrogen shown the clip; other clip steps never Hydrogen", () => {
    expect(offeredModels(MODELS, ["clip", "rolePhotos"], true).map((m) => m.id)).toEqual(["gemini-3.8-flash", "gemini-4-carbon", "gemini-4-hydrogen"])
    expect(offeredModels(MODELS, ["clip", "rolePhotos"]).map((m) => m.id)).toEqual(["gemini-3.8-flash", "gemini-4-carbon"])
  })

  it("the Flex model picker lists them on Admin → Video Remake; a trend's never lists Hydrogen", async () => {
    const { unmount } = renderWith(<Harness />)
    const [flexModel] = await within(shotList()).findAllByRole("combobox", { name: "Model" })
    await waitFor(() => expect(within(flexModel!).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["gemini-3.8-flash", "gemini-4-carbon", "gemini-4-hydrogen"]))
    unmount()
    renderWith(<Harness videoRemake={false} />)
    const [trendModel] = await within(shotList()).findAllByRole("combobox", { name: "Model" })
    await waitFor(() => expect(within(trendModel!).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["gemini-3.8-flash", "gemini-4-carbon"]))
  })
})

describe("Speech in the script", { timeout: 20_000 }, () => {
  it("is shown in a trend's editor too, and writes the same", async () => {
    const user = userEvent.setup()
    renderWith(<Harness videoRemake={false} />)
    await waitFor(() => expect(speechOf("Flex")).toBeEnabled())
    await user.selectOptions(speechOf("Flex"), "who")
    expect(last()).toEqual({ shotList: { flex: { mode: "on", speech: "who" } } })
  })

  it("Flex: its three choices beside its model picker; who and words are written, Off removes the key", async () => {
    const user = userEvent.setup()
    renderWith(<Harness />)
    await waitFor(() => expect(speechOf("Flex")).toBeEnabled())
    expect(within(speechOf("Flex")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Off", "Who speaks and when", "Who speaks, when and the words"])
    expect(speechOf("Flex")).toHaveValue("off")
    await user.selectOptions(speechOf("Flex"), "who")
    expect(last()).toEqual({ shotList: { flex: { mode: "on", speech: "who" } } })
    await user.selectOptions(speechOf("Flex"), "words")
    expect(last()).toEqual({ shotList: { flex: { mode: "on", speech: "words" } } })
    await user.selectOptions(speechOf("Flex"), "off")
    expect(last()).toBeUndefined()
  })

  it("Precise: shown once its shot list is on, with its own value", async () => {
    const user = userEvent.setup()
    renderWith(<Harness />)
    const precise = within(shotList()).getByRole("switch", { name: "Precise shot list" })
    await waitFor(() => expect(precise).toBeEnabled())
    expect(within(shotList()).queryByRole("combobox", { name: "Precise shot list: speech in the script" })).toBeNull()
    await user.click(precise)
    await waitFor(() => expect(speechOf("Precise")).toBeEnabled())
    await user.selectOptions(speechOf("Precise"), "words")
    expect(last()).toEqual({ shotList: { precise: { mode: "on", speech: "words" } } })
  })

  it("a saved value is shown, and an LLM edit keeps it", async () => {
    const user = userEvent.setup()
    renderWith(<Harness initial={{ shotList: { flex: { mode: "on", speech: "words" } } }} />)
    await waitFor(() => expect(speechOf("Flex")).toHaveValue("words"))
    const [flexModel] = within(shotList()).getAllByRole("combobox", { name: "Model" })
    await waitFor(() => expect(flexModel).toHaveValue("gemini-3.8-flash"))
    await user.selectOptions(flexModel!, "gemini-4-hydrogen")
    expect(last()).toEqual({ shotList: { flex: { mode: "on", llm: { model: "gemini-4-hydrogen", inputs: ["clip", "rolePhotos"], maxChars: 4000 }, speech: "words" } } })
  })

  it.each([
    ["the platform", [env("production", { engine: true, platform: true }), env("staging", { engine: true })], "staging"],
    ["the engine", [env("production", { platform: true }), env("staging", { engine: true, platform: true })], "production"],
  ] as const)("disabled with a short note while %s of an environment cannot take it", async (_who, envs, named) => {
    renderWith(<Harness envs={[...envs]} />)
    await within(shotList()).findAllByRole("combobox", { name: "Model" })
    await waitFor(() => expect(speechOf("Flex")).toBeDisabled())
    expect(within(shotList()).getByText(`Not available yet in ${named}.`)).toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it("a saved value the environments cannot take yet can be set back to Off", async () => {
    const user = userEvent.setup()
    renderWith(<Harness initial={{ shotList: { flex: { mode: "on", speech: "who" } } }} envs={[env("production", { engine: true, platform: true }), env("staging", { engine: true })]} />)
    await waitFor(() => expect(speechOf("Flex")).toHaveValue("who"))
    expect(speechOf("Flex")).toBeEnabled()
    const options = within(speechOf("Flex")).getAllByRole("option") as HTMLOptionElement[]
    expect(options.map((o) => o.disabled)).toEqual([false, false, true])
    await user.selectOptions(speechOf("Flex"), "off")
    expect(last()).toBeUndefined()
  })
})

describe("Other mouths", { timeout: 20_000 }, () => {
  const mouthOf = (style: "Precise" | "Flex") => within(shotList()).queryByRole("combobox", { name: `${style} shot list: other mouths` })

  it("is shown only while speech is not Off, its three choices with the default first", async () => {
    const user = userEvent.setup()
    renderWith(<Harness />)
    await waitFor(() => expect(speechOf("Flex")).toBeEnabled())
    expect(mouthOf("Flex")).toBeNull()
    await user.selectOptions(speechOf("Flex"), "words")
    expect(mouthOf("Flex")).toHaveValue("spoken")
    expect(within(mouthOf("Flex")!).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Mouths closed when not speaking (singing left alone)",
      "Mouths closed when not speaking",
      "Say nothing about other mouths",
    ])
    await user.selectOptions(speechOf("Flex"), "off")
    expect(mouthOf("Flex")).toBeNull()
  })

  it("writes all and none; the default is never written; Off takes it away with speech", async () => {
    const user = userEvent.setup()
    renderWith(<Harness initial={{ shotList: { flex: { mode: "on", speech: "who" } } }} />)
    await waitFor(() => expect(mouthOf("Flex")).toBeEnabled())
    await user.selectOptions(mouthOf("Flex")!, "none")
    expect(last()).toEqual({ shotList: { flex: { mode: "on", speech: "who", speechMouth: "none" } } })
    await user.selectOptions(mouthOf("Flex")!, "all")
    expect(last()).toEqual({ shotList: { flex: { mode: "on", speech: "who", speechMouth: "all" } } })
    await user.selectOptions(mouthOf("Flex")!, "spoken")
    expect(last()).toEqual({ shotList: { flex: { mode: "on", speech: "who" } } })
    await user.selectOptions(mouthOf("Flex")!, "none")
    await user.selectOptions(speechOf("Flex"), "off")
    expect(last()).toBeUndefined()
  })

  it("a saved value is shown, kept by an LLM edit, and disabled while an environment cannot take speech", async () => {
    const user = userEvent.setup()
    const { unmount } = renderWith(<Harness initial={{ shotList: { flex: { mode: "on", speech: "words", speechMouth: "all" } } }} />)
    await waitFor(() => expect(mouthOf("Flex")).toHaveValue("all"))
    const [flexModel] = within(shotList()).getAllByRole("combobox", { name: "Model" })
    await waitFor(() => expect(flexModel).toHaveValue("gemini-3.8-flash"))
    await user.selectOptions(flexModel!, "gemini-4-carbon")
    expect(last()).toEqual({ shotList: { flex: { mode: "on", llm: { model: "gemini-4-carbon", inputs: ["clip", "rolePhotos"], maxChars: 4000 }, speech: "words", speechMouth: "all" } } })
    unmount()
    renderWith(<Harness initial={{ shotList: { flex: { mode: "on", speech: "words", speechMouth: "all" } } }} envs={[env("production", { engine: true, platform: true }), env("staging", { engine: true })]} />)
    await waitFor(() => expect(mouthOf("Flex")).toHaveValue("all"))
    expect(mouthOf("Flex")).toBeDisabled()
  })

  it("the pure rule: kept only with speech on and off its default", () => {
    expect(normaliseShotList({ flex: { mode: "on", speech: "who", speechMouth: "spoken" } })).toEqual({ flex: { mode: "on", speech: "who" } })
    expect(normaliseShotList({ flex: { mode: "on", speech: "who", speechMouth: "none" } })).toEqual({ flex: { mode: "on", speech: "who", speechMouth: "none" } })
    expect(normaliseShotList({ flex: { mode: "on", speech: "off", speechMouth: "none" } })).toBeUndefined()
    expect(normaliseShotList({ precise: { mode: "off", speech: "who", speechMouth: "all" }, flex: { mode: "on", speechMouth: "all" } })).toBeUndefined()
  })
})

describe("Gemini 4 Hydrogen while held (decided 2026-11-18)", { timeout: 20_000 }, () => {
  it("is listed disabled with a short note while an environment's platform lacks the claim; never on a trend", async () => {
    const envs = [env("production", { engine: true, platform: true }), env("staging", { engine: true })]
    const { unmount } = renderWith(<Harness envs={envs} />)
    const [flexModel] = await within(shotList()).findAllByRole("combobox", { name: "Model" })
    await waitFor(() => expect(within(flexModel!).getAllByRole("option").map((o) => o.getAttribute("value"))).toContain("gemini-4-hydrogen"))
    const hydrogen = within(flexModel!).getByRole("option", { name: "Gemini 4 Hydrogen" }) as HTMLOptionElement
    expect(hydrogen.disabled).toBe(true)
    expect((within(flexModel!).getByRole("option", { name: "Gemini 4 Carbon" }) as HTMLOptionElement).disabled).toBe(false)
    expect(within(shotList()).getAllByText("Gemini 4 Hydrogen: not available yet in staging.").length).toBeGreaterThan(0)
    unmount()
    renderWith(<Harness />)
    const [ready] = await within(shotList()).findAllByRole("combobox", { name: "Model" })
    await waitFor(() => expect((within(ready!).getByRole("option", { name: "Gemini 4 Hydrogen" }) as HTMLOptionElement).disabled).toBe(false))
    expect(within(shotList()).queryByText(/Gemini 4 Hydrogen: not available yet/)).toBeNull()
  })

  it("the pure rule: a style turned off keeps no speech", () => {
    expect(normaliseShotList({ precise: { mode: "off", llm: SHOT_LLM, speech: "who", speechMouth: "all" } })).toEqual({ precise: { mode: "off", llm: SHOT_LLM } })
  })
})
