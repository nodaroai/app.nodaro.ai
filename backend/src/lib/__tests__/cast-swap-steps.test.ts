import { afterEach, describe, expect, it, vi } from "vitest"

// A model the platform lists that sees no pictures: the real list has none today.
vi.mock("@nodaro/shared/llm-models", async (importOriginal) => {
  const real = await importOriginal<typeof import("@nodaro/shared/llm-models")>()
  return {
    ...real,
    LLM_MODEL_IDS: [...real.LLM_MODEL_IDS, "text-only-test-model"],
    getLlmModalityCaps: (id: string | undefined) =>
      id === "text-only-test-model" ? { image: false, video: false, audio: false } : real.getLlmModalityCaps(id),
  }
})

import {
  castSwapStepsSaveSchema,
  castSwapStepsSchema,
  engineTakesClipBodySheet,
  engineTakesShotList,
  engineTakesSteps,
  engineTakesStyleRefs,
  loadedEngineTakesClipBodySheet,
  loadedEngineTakesStyleRefs,
  loadedEngineTakesSteps,
  normaliseSteps,
  sceneStepKeyOf,
  shotListNeedsEngine,
  SHEET_LAYOUTS,
  SKIP_REASONS,
  SKIPPABLE_STEPS,
  stepsForEngine,
  stepsProblems,
  stepsSet,
  stepsThatNeedTheEngine,
  styleRefsNeedsEngine,
  STYLE_REFS_DEFAULT_SEND,
  STYLE_REFS_PROMPT_MAX,
  withStepsFor,
  type CastSwapSteps,
  type SheetRules,
} from "../cast-swap-steps.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../private-plugins/supports-registry.js"

/** A complete rules table (any valid layout per row; the engine serves its own defaults). */
const RULES: SheetRules = {
  person: { "head-body": "collage", "body-only": "collage", "head-only": "head-body-cut", unclear: "head-body" },
  pet: { "head-body": "collage", "body-only": "head-body-side", "head-only": "head-body-side", unclear: "head-body-side" },
  product: { "head-body": "collage", "body-only": "collage", "head-only": "turnaround", unclear: "turnaround" },
  location: { "head-body": "none", "body-only": "none", "head-only": "none", unclear: "none" },
}

const llm = (over: Partial<{ model: string; inputs: string[]; maxChars: number; instructions: string }> = {}) => ({
  model: "gemini-3.8-flash",
  inputs: ["clip"],
  maxChars: 1000,
  ...over,
})

const codesOf = (schema: typeof castSwapStepsSchema, value: unknown): string[] => {
  const r = schema.safeParse(value)
  return r.success ? [] : stepsProblems(r.error).map((p) => p.code)
}

describe("castSwapStepsSchema (stored)", () => {
  it("accepts a full rules table, a labeller and both text steps", () => {
    const steps = {
      sheets: { labeller: llm({ inputs: ["rolePhotos"] }), rules: RULES },
      enginePrompt: { mode: "llm", llm: llm({ inputs: ["clip", "rolePhotos", "references", "extraPrompt"] }) },
      sceneDescription: { mode: "template" },
    }
    expect(castSwapStepsSchema.parse(steps)).toEqual(steps)
    expect(castSwapStepsSaveSchema.parse(steps)).toEqual(steps)
  })

  it("accepts every layout of every kind in every row", () => {
    for (const kind of Object.keys(SHEET_LAYOUTS) as Array<keyof typeof SHEET_LAYOUTS>) {
      for (const layout of SHEET_LAYOUTS[kind]) {
        const rules = { ...RULES, [kind]: { "head-body": layout, "body-only": layout, "head-only": layout, unclear: layout } }
        expect(castSwapStepsSchema.safeParse({ sheets: { rules } }).success, `${kind}/${layout}`).toBe(true)
      }
    }
  })

  it("refuses a pet layout under product, an unknown key at every level, and a missing row", () => {
    expect(castSwapStepsSchema.safeParse({ sheets: { rules: { ...RULES, product: { ...RULES.product, unclear: "head-body-side" } } } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ extra: 1 }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ sheets: { rules: RULES, extra: 1 } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ sheets: { rules: { ...RULES, person: { ...RULES.person, extra: "collage" } } } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ enginePrompt: { mode: "llm", llm: { ...llm(), extra: 1 } } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ enginePrompt: { mode: "template", llm: llm() } }).success).toBe(false)
    const { unclear: _u, ...threeRows } = RULES.person
    expect(castSwapStepsSchema.safeParse({ sheets: { rules: { ...RULES, person: threeRows } } }).success).toBe(false)
  })

  it("bounds the length and the instructions", () => {
    expect(castSwapStepsSchema.safeParse({ enginePrompt: { mode: "llm", llm: llm({ maxChars: 199 }) } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ enginePrompt: { mode: "llm", llm: llm({ maxChars: 20_001 }) } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ enginePrompt: { mode: "llm", llm: llm({ maxChars: 12.5 }) } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ enginePrompt: { mode: "llm", llm: llm({ instructions: "   " }) } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ enginePrompt: { mode: "llm", llm: llm({ instructions: "x".repeat(8001) }) } }).success).toBe(false)
  })

  it("refuses a labeller shown anything but the role photos (labeller_inputs)", () => {
    expect(codesOf(castSwapStepsSchema, { sheets: { labeller: llm({ inputs: ["rolePhotos", "clip"] }), rules: RULES } })).toEqual(["labeller_inputs"])
    expect(codesOf(castSwapStepsSchema, { sheets: { labeller: llm({ inputs: [] }), rules: RULES } })).toEqual(["labeller_inputs"])
  })

  it("refuses a scene LLM without the clip (scene_needs_clip)", () => {
    expect(codesOf(castSwapStepsSchema, { sceneDescription: { mode: "llm", llm: llm({ inputs: ["rolePhotos"] }) } })).toEqual(["scene_needs_clip"])
  })

  it("refuses an input listed twice (duplicate_input)", () => {
    expect(codesOf(castSwapStepsSchema, { enginePrompt: { mode: "llm", llm: llm({ inputs: ["clip", "clip"] }) } })).toEqual(["duplicate_input"])
  })

  it("loads a stored version whose model has since left the list", () => {
    const stored = {
      enginePrompt: { mode: "llm", llm: llm({ model: "a-retired-model", inputs: ["clip", "rolePhotos"] }) },
      sceneDescription: { mode: "llm", llm: llm({ model: "a-retired-model" }) },
    }
    expect(castSwapStepsSchema.parse(stored)).toEqual(stored)
    expect(codesOf(castSwapStepsSaveSchema, stored)).toEqual(["unknown_model", "unknown_model"])
  })
})

describe("castSwapStepsSaveSchema", () => {
  it("refuses an unknown model", () => {
    expect(codesOf(castSwapStepsSaveSchema, { enginePrompt: { mode: "llm", llm: llm({ model: "no-such-model" }) } })).toEqual(["unknown_model"])
  })

  it("refuses a model that sees no pictures when shown the role photos (model_cannot_see_images)", () => {
    const steps = { enginePrompt: { mode: "llm", llm: llm({ model: "text-only-test-model", inputs: ["rolePhotos"] }) } }
    expect(codesOf(castSwapStepsSaveSchema, steps)).toEqual(["model_cannot_see_images"])
    expect(codesOf(castSwapStepsSaveSchema, { enginePrompt: { mode: "llm", llm: llm({ model: "text-only-test-model", inputs: ["extraPrompt"] }) } })).toEqual([])
  })

  it("refuses the clip for an image-only model other than the clip-as-picture lane (model_cannot_read_clip)", () => {
    expect(codesOf(castSwapStepsSaveSchema, { sceneDescription: { mode: "llm", llm: llm({ model: "claude-sonnet-5" }) } })).toEqual(["model_cannot_read_clip"])
    // The clip-as-picture lane, and a model that takes video.
    expect(codesOf(castSwapStepsSaveSchema, { sceneDescription: { mode: "llm", llm: llm({ model: "gemini-3.8-flash" }) } })).toEqual([])
    expect(codesOf(castSwapStepsSaveSchema, { sceneDescription: { mode: "llm", llm: llm({ model: "gemini-3.1-pro" }) } })).toEqual([])
  })

  it("names where each problem is", () => {
    const r = castSwapStepsSaveSchema.safeParse({ sceneDescription: { mode: "llm", llm: llm({ model: "claude-sonnet-5" }) } })
    expect(r.success).toBe(false)
    if (!r.success) expect(stepsProblems(r.error, "steps")).toEqual([
      { path: "steps.sceneDescription.llm.model", code: "model_cannot_read_clip", message: expect.any(String) },
    ])
  })
})

describe("clipBody (Body from the clip)", () => {
  it("accepts on and off, with or without an image prompt, in both schemas", () => {
    for (const clipBody of [{ mode: "on" }, { mode: "off" }, { mode: "on", prompt: "Draw the person." }, { mode: "off", prompt: "kept" }]) {
      expect(castSwapStepsSchema.parse({ clipBody })).toEqual({ clipBody })
      expect(castSwapStepsSaveSchema.parse({ clipBody })).toEqual({ clipBody })
    }
  })

  it("bounds the prompt to 4000 characters and refuses an empty one, an unknown mode and an unknown key", () => {
    expect(castSwapStepsSaveSchema.safeParse({ clipBody: { mode: "on", prompt: "x".repeat(4000) } }).success).toBe(true)
    const long = castSwapStepsSaveSchema.safeParse({ clipBody: { mode: "on", prompt: "x".repeat(4001) } })
    expect(long.success).toBe(false)
    expect(stepsProblems(long.error!, "steps").map((p) => p.path)).toEqual(["steps.clipBody.prompt"])
    expect(castSwapStepsSchema.safeParse({ clipBody: { mode: "on", prompt: "   " } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ clipBody: { mode: "auto" } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ clipBody: { mode: "on", frames: 3 } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ clipBody: {} }).success).toBe(false)
  })

  it("a saved image prompt may name {subject}, {body} and {hair} only (clip_body_placeholder)", () => {
    const save = (prompt: string) => castSwapStepsSaveSchema.safeParse({ clipBody: { mode: "on", prompt } })
    expect(save("Draw {subject} with {body} and {hair}.").success).toBe(true)
    expect(save("No placeholders at all.").success).toBe(true)
    for (const bad of ["{Subject}", "{name}", "{constructor}", "{body} and {face}", "{toString}"]) {
      const r = save(`Draw ${bad}.`)
      expect(r.success, bad).toBe(false)
      expect(stepsProblems(r.error!, "steps").map((p) => ({ path: p.path, code: p.code })), bad).toEqual([
        { path: "steps.clipBody.prompt", code: "clip_body_placeholder" },
      ])
    }
    expect(stepsProblems(save("{name} {name} {other}").error!)[0]!.message).toMatch(/\{name\}, \{other\}/)
    // The stored reading stays tolerant (a saved version is never broken by a rule).
    expect(castSwapStepsSchema.safeParse({ clipBody: { mode: "on", prompt: "{name}" } }).success).toBe(true)
  })

  it("counts as set on its own, and is kept by normaliseSteps", () => {
    expect(stepsSet({ clipBody: { mode: "off" } })).toBe(true)
    expect(normaliseSteps({ clipBody: { mode: "off" } })).toEqual({ clipBody: { mode: "off" } })
    expect(normaliseSteps({ clipBody: undefined })).toBeUndefined()
  })

  it("names its skipped step and the reason for a role with no usable frame", () => {
    expect(SKIPPABLE_STEPS).toContain("clip-body")
    expect(SKIP_REASONS).toContain("no_frame")
  })
})

describe("set or not", () => {
  it("reads absent and {} as unset", () => {
    expect(stepsSet(undefined)).toBe(false)
    expect(stepsSet({})).toBe(false)
    expect(normaliseSteps({})).toBeUndefined()
    expect(stepsSet({ enginePrompt: { mode: "template" } })).toBe(true)
  })
})

describe("gating", () => {
  afterEach(() => _resetPluginSupportsForTests())

  const steps: CastSwapSteps = { enginePrompt: { mode: "template" } }

  it("an engine takes steps only when it declares castSwap.steps", () => {
    expect(engineTakesSteps(undefined)).toBe(false)
    expect(engineTakesSteps({})).toBe(false)
    expect(engineTakesSteps({ steps: false })).toBe(false)
    expect(engineTakesSteps({ steps: true })).toBe(true)
    setPluginSupports({ castSwap: { faceMesh: true } as never })
    expect(loadedEngineTakesSteps()).toBe(false)
    setPluginSupports({ castSwap: { steps: true } as never })
    expect(loadedEngineTakesSteps()).toBe(true)
  })

  it("withStepsFor strips steps for an engine without castSwap.steps, and an empty setting always", () => {
    expect(withStepsFor({ a: 1, steps }, {})).toEqual({ a: 1 })
    expect(Object.hasOwn(withStepsFor({ a: 1, steps }, { steps: false }), "steps")).toBe(false)
    expect(withStepsFor({ a: 1, steps }, { steps: true })).toEqual({ a: 1, steps })
    expect(Object.hasOwn(withStepsFor({ a: 1, steps: {} }, { steps: true }), "steps")).toBe(false)
    const plain: { a: number; steps?: CastSwapSteps } = { a: 1 }
    expect(withStepsFor(plain, { steps: true })).toEqual({ a: 1 })
  })

  it("an engine takes clipBody only when it declares both castSwap.steps and castSwap.clipBodySheet", () => {
    expect(engineTakesClipBodySheet(undefined)).toBe(false)
    expect(engineTakesClipBodySheet({ steps: true })).toBe(false)
    expect(engineTakesClipBodySheet({ clipBodySheet: true })).toBe(false)
    expect(engineTakesClipBodySheet({ steps: true, clipBodySheet: true })).toBe(true)
    setPluginSupports({ castSwap: { steps: true } as never })
    expect(loadedEngineTakesClipBodySheet()).toBe(false)
    setPluginSupports({ castSwap: { steps: true, clipBodySheet: true } as never })
    expect(loadedEngineTakesClipBodySheet()).toBe(true)
  })

  it("stepsForEngine sends clipBody only to an engine that declares it, and nothing when nothing is left", () => {
    const both: CastSwapSteps = { enginePrompt: { mode: "template" }, clipBody: { mode: "off" } }
    expect(stepsForEngine(both, { steps: true, clipBodySheet: true })).toEqual(both)
    expect(stepsForEngine(both, { steps: true })).toEqual({ enginePrompt: { mode: "template" } })
    expect(stepsForEngine(both, { clipBodySheet: true })).toBeUndefined()
    expect(stepsForEngine({ clipBody: { mode: "on", prompt: "p" } }, { steps: true })).toBeUndefined()
    expect(stepsForEngine({ clipBody: { mode: "on", prompt: "p" } }, { steps: true, clipBodySheet: true })).toEqual({ clipBody: { mode: "on", prompt: "p" } })
    // Never the caller's object.
    const sent = stepsForEngine(both, { steps: true, clipBodySheet: true })!
    sent.clipBody!.mode = "on"
    expect(both.clipBody!.mode).toBe("off")
  })

  it("withStepsFor drops the key when only clipBody is set and the engine lacks the capability", () => {
    const only: CastSwapSteps = { clipBody: { mode: "off" } }
    expect(Object.hasOwn(withStepsFor({ a: 1, steps: only }, { steps: true }), "steps")).toBe(false)
    expect(withStepsFor({ a: 1, steps: only }, { steps: true, clipBodySheet: true })).toEqual({ a: 1, steps: only })
  })
})

describe("sceneStepKeyOf", () => {
  it("is absent when unset and stable across key order", () => {
    expect(sceneStepKeyOf(undefined)).toBeUndefined()
    const a = sceneStepKeyOf({ mode: "llm", llm: { model: "gemini-3.8-flash", inputs: ["clip"], maxChars: 900 } })
    const b = sceneStepKeyOf({ llm: { maxChars: 900, inputs: ["clip"], model: "gemini-3.8-flash" }, mode: "llm" } as never)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
    expect(sceneStepKeyOf({ mode: "template" })).not.toBe(a)
  })
})

describe("shotList (the shot list per style)", () => {
  it("reads and saves each style's mode and LLM; an empty style object is nothing set", () => {
    const shotList = { precise: { mode: "on" as const, llm: llm({ inputs: ["clip", "rolePhotos"] }) }, flex: { mode: "on" as const } }
    expect(castSwapStepsSchema.parse({ shotList })).toEqual({ shotList })
    expect(castSwapStepsSaveSchema.parse({ shotList })).toEqual({ shotList })
    expect(stepsSet({ shotList: {} })).toBe(false)
    expect(normaliseSteps({ shotList: {} })).toBeUndefined()
    expect(normaliseSteps({ shotList: { precise: { mode: "off" }, flex: undefined } })).toEqual({ shotList: { precise: { mode: "off" } } })
  })

  it("refuses Flex off, a list not shown the clip, a repeated input, an unknown key", () => {
    expect(codesOf(castSwapStepsSchema, { shotList: { flex: { mode: "off" } } })).toEqual(["shot_list_flex_always_on"])
    expect(codesOf(castSwapStepsSchema, { shotList: { precise: { mode: "on", llm: llm({ inputs: ["rolePhotos"] }) } } })).toEqual(["scene_needs_clip"])
    expect(codesOf(castSwapStepsSchema, { shotList: { precise: { mode: "on", llm: llm({ inputs: ["clip", "clip"] }) } } })).toEqual(["duplicate_input"])
    expect(castSwapStepsSchema.safeParse({ shotList: { precise: { mode: "auto" } } }).success).toBe(false)
    expect(castSwapStepsSchema.safeParse({ shotList: { motion: { mode: "on" } } }).success).toBe(false)
    const flexOff = castSwapStepsSchema.safeParse({ shotList: { flex: { mode: "off" } } })
    expect(stepsProblems(flexOff.error!, "steps").map((p) => p.path)).toEqual(["steps.shotList.flex.mode"])
  })

  it("checks a saved LLM's model like any other step's", () => {
    expect(codesOf(castSwapStepsSaveSchema, { shotList: { flex: { mode: "on", llm: llm({ model: "no-such-model" }) } } })).toEqual(["unknown_model"])
    // The stored reading takes any model name (a model later removed never breaks a saved setting).
    expect(codesOf(castSwapStepsSchema, { shotList: { flex: { mode: "on", llm: llm({ model: "no-such-model" }) } } })).toEqual([])
  })

  it("needs an engine with the shot list only away from its defaults", () => {
    expect(shotListNeedsEngine(undefined)).toBe(false)
    expect(shotListNeedsEngine({ precise: { mode: "off" }, flex: { mode: "on" } })).toBe(false)
    expect(shotListNeedsEngine({ precise: { mode: "on" } })).toBe(true)
    expect(shotListNeedsEngine({ precise: { mode: "off", llm: llm() as never } })).toBe(true)
    expect(shotListNeedsEngine({ flex: { mode: "on", llm: llm() as never } })).toBe(true)
    expect(stepsThatNeedTheEngine({ shotList: { flex: { mode: "on" } } })).toBeUndefined()
    expect(stepsThatNeedTheEngine({ shotList: { precise: { mode: "on" } } })).toEqual({ shotList: { precise: { mode: "on" } } })
  })

  it("is sent only to an engine that declares castSwap.steps and castSwap.shotList", () => {
    const set: CastSwapSteps = { enginePrompt: { mode: "template" }, shotList: { precise: { mode: "on" } } }
    expect(engineTakesShotList({ shotList: true })).toBe(false)
    expect(engineTakesShotList({ steps: true, shotList: true })).toBe(true)
    expect(stepsForEngine(set, { steps: true, shotList: true })).toEqual(set)
    expect(stepsForEngine(set, { steps: true, clipBodySheet: true })).toEqual({ enginePrompt: { mode: "template" } })
    const body: { a: number; steps?: CastSwapSteps } = { a: 1, steps: { shotList: { precise: { mode: "on" } } } }
    expect(Object.hasOwn(withStepsFor(body, { steps: true }), "steps")).toBe(false)
  })
})

describe("styleRefs (Style the role pictures)", () => {
  afterEach(() => _resetPluginSupportsForTests())

  /** An engine that declares every step. */
  const ALL = { steps: true, clipBodySheet: true, shotList: true, styleRefs: true } as const

  it("accepts on and off, each send and an image instruction, in both schemas", () => {
    for (const schema of [castSwapStepsSchema, castSwapStepsSaveSchema]) {
      expect(schema.safeParse({ styleRefs: { mode: "on" } }).success).toBe(true)
      expect(schema.safeParse({ styleRefs: { mode: "off" } }).success).toBe(true)
      expect(schema.safeParse({ styleRefs: { mode: "on", send: "styled-and-original" } }).success).toBe(true)
      expect(schema.safeParse({ styleRefs: { mode: "on", send: "styled", prompt: "Redraw {subject} in the style." } }).success).toBe(true)
      expect(schema.safeParse({ styleRefs: { mode: "off", send: "styled", prompt: "kept while off" } }).success).toBe(true)
    }
  })

  it("refuses an unknown mode, an unknown send, an unknown key, and an empty or too long prompt", () => {
    for (const schema of [castSwapStepsSchema, castSwapStepsSaveSchema]) {
      expect(schema.safeParse({ styleRefs: {} }).success).toBe(false)
      expect(schema.safeParse({ styleRefs: { mode: "auto" } }).success).toBe(false)
      expect(schema.safeParse({ styleRefs: { mode: "on", send: "original" } }).success).toBe(false)
      expect(schema.safeParse({ styleRefs: { mode: "on", model: "x" } }).success).toBe(false)
      expect(schema.safeParse({ styleRefs: { mode: "on", prompt: "   " } }).success).toBe(false)
      expect(schema.safeParse({ styleRefs: { mode: "on", prompt: "x".repeat(STYLE_REFS_PROMPT_MAX + 1) } }).success).toBe(false)
      expect(schema.safeParse({ styleRefs: { mode: "on", prompt: "x".repeat(STYLE_REFS_PROMPT_MAX) } }).success).toBe(true)
    }
    expect(STYLE_REFS_DEFAULT_SEND).toBe("styled-and-original")
  })

  it("an explicit Off is set and kept as it is: never trimmed to a default (the row is shared)", () => {
    const off: CastSwapSteps = { styleRefs: { mode: "off", send: "styled-and-original" } }
    expect(stepsSet(off)).toBe(true)
    expect(normaliseSteps(off)).toEqual(off)
    expect(normaliseSteps({ styleRefs: { mode: "off" } })).toEqual({ styleRefs: { mode: "off" } })
  })

  it("needs the engine only when On (Off, whatever its send and prompt, needs nothing)", () => {
    expect(styleRefsNeedsEngine(undefined)).toBe(false)
    expect(styleRefsNeedsEngine({ mode: "off" })).toBe(false)
    expect(styleRefsNeedsEngine({ mode: "off", send: "styled", prompt: "p" })).toBe(false)
    expect(styleRefsNeedsEngine({ mode: "on" })).toBe(true)
    expect(stepsThatNeedTheEngine({ styleRefs: { mode: "off", send: "styled" } })).toBeUndefined()
    expect(stepsThatNeedTheEngine({ styleRefs: { mode: "on" } })).toEqual({ styleRefs: { mode: "on" } })
  })

  it("is sent only to an engine that declares castSwap.steps and castSwap.styleRefs; the other steps still go", () => {
    const set: CastSwapSteps = { enginePrompt: { mode: "template" }, styleRefs: { mode: "on", send: "styled" } }
    expect(engineTakesStyleRefs({ styleRefs: true })).toBe(false)
    expect(engineTakesStyleRefs({ steps: true })).toBe(false)
    expect(engineTakesStyleRefs({ steps: true, styleRefs: true })).toBe(true)
    expect(stepsForEngine(set, { steps: true, styleRefs: true })).toEqual(set)
    expect(stepsForEngine(set, { steps: true, clipBodySheet: true, shotList: true })).toEqual({ enginePrompt: { mode: "template" } })
    expect(stepsForEngine({ styleRefs: { mode: "on" } }, { steps: true, shotList: true })).toBeUndefined()
    const body: { a: number; steps?: CastSwapSteps } = { a: 1, steps: { styleRefs: { mode: "on" } } }
    expect(Object.hasOwn(withStepsFor(body, { steps: true, shotList: true }), "steps")).toBe(false)
    expect(withStepsFor(body, ALL)).toEqual(body)
  })

  it("reads the loaded engine's capability", () => {
    setPluginSupports({ castSwap: { steps: true } } as never)
    expect(loadedEngineTakesStyleRefs()).toBe(false)
    setPluginSupports({ castSwap: { steps: true, styleRefs: true } } as never)
    expect(loadedEngineTakesStyleRefs()).toBe(true)
  })

  it("names its skipped step", () => {
    expect(SKIPPABLE_STEPS).toContain("style-refs")
  })

  it("PIN: with nothing set, every body is unchanged, whatever the engine declares", () => {
    const bare: { a: number; steps?: CastSwapSteps } = { a: 1 }
    for (const cs of [undefined, {}, { steps: true }, ALL]) {
      expect(withStepsFor(bare, cs)).toEqual({ a: 1 })
      expect(Object.hasOwn(withStepsFor(bare, cs), "steps")).toBe(false)
      expect(Object.hasOwn(withStepsFor({ ...bare, steps: {} }, cs), "steps")).toBe(false)
      expect(stepsForEngine(undefined, cs)).toBeUndefined()
    }
    // A setting from before the step goes out byte-identical to an engine that declares it.
    const before: CastSwapSteps = { enginePrompt: { mode: "template" }, clipBody: { mode: "on", prompt: "p" }, shotList: { precise: { mode: "on" } } }
    const sent = JSON.stringify(withStepsFor({ a: 1, steps: before }, ALL))
    expect(sent).toBe(JSON.stringify({ a: 1, steps: before }))
    expect(sent).toBe(JSON.stringify(withStepsFor({ a: 1, steps: before }, { steps: true, clipBodySheet: true, shotList: true })))
  })
})
