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
  engineTakesSteps,
  loadedEngineTakesSteps,
  normaliseSteps,
  sceneStepKeyOf,
  SHEET_LAYOUTS,
  stepsProblems,
  stepsSet,
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
    expect(withStepsFor({ a: 1, steps }, false)).toEqual({ a: 1 })
    expect(Object.hasOwn(withStepsFor({ a: 1, steps }, false), "steps")).toBe(false)
    expect(withStepsFor({ a: 1, steps }, true)).toEqual({ a: 1, steps })
    expect(Object.hasOwn(withStepsFor({ a: 1, steps: {} }, true), "steps")).toBe(false)
    const plain: { a: number; steps?: CastSwapSteps } = { a: 1 }
    expect(withStepsFor(plain, true)).toEqual({ a: 1 })
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
