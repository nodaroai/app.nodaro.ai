import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { STYLE_ONLY_PATHS, type StepOutputs, type TextStepSetting } from "../cast-swap-steps.js"
import {
  NODARO_MOTION_STYLE_ONLY_KEY,
  anyStyleOnlyChange,
  engineTakesStyleOnly,
  nodaroMotionStyleOnlyEntrySchema,
  nodaroMotionStyleOnlySchema,
  parseNodaroMotionStyleOnly,
  styleOnlyEntryProblems,
  styleOnlyForPlugin,
  withoutDefaultStyleOnly,
} from "../nodaro-motion-style-only.js"

/**
 * `nodaro_motion_style_only` (pure): the path a DIRECT style-only Nodaro
 * Motion run takes, and its engine-prompt step, per engine. Nothing set, an
 * engine left out, "original" and the template are the same as never saved.
 */
const LLM: TextStepSetting = { mode: "llm", llm: { model: "gemini-3.8-flash", inputs: ["clip"], maxChars: 900 } }
const LLM_STEP = { model: "gemini-3.8-flash", inputs: ["clip" as const], maxChars: 900 }

describe("nodaro_motion_style_only", () => {
  it("is its own app_settings row, offering exactly the original and the flex path", () => {
    expect(NODARO_MOTION_STYLE_ONLY_KEY).toBe("nodaro_motion_style_only")
    expect(STYLE_ONLY_PATHS).toEqual(["original", "flex"])
  })

  it("an admin's save is strict: the current engine ids, the two paths, a text step", () => {
    for (const good of [{}, { "motion-prism": { path: "flex" } }, { "motion-prism": { path: "original", enginePrompt: { mode: "template" } } }, { "motion-pulse": { enginePrompt: LLM } }]) {
      expect(nodaroMotionStyleOnlySchema.safeParse(good).success, JSON.stringify(good)).toBe(true)
    }
    for (const bad of [
      { "motion-pro": { path: "flex" } },
      { "seedance-2-5": { path: "flex" } },
      { "motion-prism": { path: "depth" } },
      { "motion-prism": { path: null } },
      { "motion-prism": { enginePrompt: null } },
      { "motion-prism": { enginePrompt: { mode: "off" } } },
      { "motion-prism": { path: "flex", extra: true } },
      { "motion-prism": "flex" },
      null,
    ]) {
      expect(nodaroMotionStyleOnlySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("checks a stored engine prompt by the stored steps rules (any model name, no input twice), keeping what it parsed", () => {
    expect(nodaroMotionStyleOnlyEntrySchema.safeParse({ enginePrompt: { mode: "llm", llm: { model: "a-retired-model", inputs: [], maxChars: 900 } } }).success).toBe(true)
    const twice = nodaroMotionStyleOnlyEntrySchema.safeParse({ enginePrompt: { mode: "llm", llm: { model: "gemini-3.8-flash", inputs: ["clip", "clip"], maxChars: 900 } } })
    expect(twice.success).toBe(false)
    expect(twice.error?.issues[0]?.path).toEqual(["enginePrompt", "llm", "inputs"])
    const trimmed = nodaroMotionStyleOnlyEntrySchema.parse({ path: "flex", enginePrompt: { mode: "llm", llm: { ...LLM_STEP, instructions: "  Restyle.  " } } })
    expect(trimmed).toStrictEqual({ path: "flex", enginePrompt: { mode: "llm", llm: { ...LLM_STEP, instructions: "Restyle." } } })
    expect(nodaroMotionStyleOnlyEntrySchema.parse({})).toStrictEqual({})
  })

  it("drops the defaults: 'original' and Template are the same as never saved", () => {
    expect(withoutDefaultStyleOnly({ "motion-prism": { path: "original", enginePrompt: { mode: "template" } } })).toStrictEqual({})
    expect(styleOnlyForPlugin({ "motion-prism": { path: "original" } })).toBeNull()
    expect(withoutDefaultStyleOnly(null)).toStrictEqual({})
    expect(styleOnlyForPlugin(null)).toBeNull()
  })

  it("keeps each changed key alone, never writing an unset one (no null, no undefined)", () => {
    expect(withoutDefaultStyleOnly({ "motion-prism": { path: "original", enginePrompt: LLM } })).toStrictEqual({ "motion-prism": { enginePrompt: LLM } })
    expect(withoutDefaultStyleOnly({ "motion-prism": { path: "flex", enginePrompt: { mode: "template" } }, "motion-pulse": {} })).toStrictEqual({ "motion-prism": { path: "flex" } })
    const saved = { "motion-prism": { path: "flex" as const, enginePrompt: LLM } }
    const kept = withoutDefaultStyleOnly(saved)
    expect(kept).toStrictEqual(saved)
    expect(kept["motion-prism"]).not.toBe(saved["motion-prism"])
    expect(kept["motion-prism"]!.enginePrompt).not.toBe(saved["motion-prism"].enginePrompt)
  })

  it("counts a change only when an engine leaves the defaults", () => {
    expect(anyStyleOnlyChange(null)).toBe(false)
    expect(anyStyleOnlyChange({})).toBe(false)
    expect(anyStyleOnlyChange({ "motion-prism": { path: "original", enginePrompt: { mode: "template" } } })).toBe(false)
    expect(anyStyleOnlyChange({ "motion-prism": { path: "flex" } })).toBe(true)
    expect(anyStyleOnlyChange({ "motion-pulse": { enginePrompt: LLM } })).toBe(true)
  })

  it("answers the plugin each changed entry under its current and earlier key", () => {
    expect(styleOnlyForPlugin({ "motion-prism": { path: "flex" } })).toEqual({ "motion-prism": { path: "flex" }, "motion-pro": { path: "flex" } })
    const got = styleOnlyForPlugin({ "motion-prism": { path: "original", enginePrompt: LLM } })
    expect(got).toStrictEqual({ "motion-prism": { enginePrompt: LLM }, "motion-pro": { enginePrompt: LLM } })
    expect(got!["motion-prism"]).not.toBe(got!["motion-pro"])
  })

  it("reads a stored row tolerantly: a bad entry is dropped with a warning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionStyleOnly({ "motion-prism": { path: "depth" } }, warn)).toEqual({})
    expect(warn).toHaveBeenCalledOnce()
  })

  it("reads a stored row: an earlier key as the current one, the defaults left out, not an object as never saved", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionStyleOnly({ "motion-pro": { path: "flex" }, "motion-pulse": { path: "original" } }, warn)).toStrictEqual({ "motion-prism": { path: "flex" } })
    expect(parseNodaroMotionStyleOnly({ "motion-prism": { path: "flex" }, "motion-pulse": { path: null } }, warn)).toStrictEqual({ "motion-prism": { path: "flex" } })
    expect(warn).toHaveBeenCalledOnce()
    expect(parseNodaroMotionStyleOnly(undefined, warn)).toBeNull()
    expect(parseNodaroMotionStyleOnly("flex", warn)).toBeNull()
  })

  it("checks an LLM engine prompt as a save does", () => {
    expect(styleOnlyEntryProblems("motion-prism", { enginePrompt: { mode: "llm", llm: { model: "nope", inputs: [], maxChars: 2000 } } })[0]?.code).toBe("unknown_model")
    expect(styleOnlyEntryProblems("motion-prism", { enginePrompt: { mode: "llm", llm: { model: "nope", inputs: [], maxChars: 2000 } } })[0]?.path).toBe("motion-prism.enginePrompt.llm.model")
    expect(styleOnlyEntryProblems("motion-prism", { path: "flex" })).toEqual([])
    expect(styleOnlyEntryProblems("motion-prism", { enginePrompt: LLM })).toEqual([])
    expect(styleOnlyEntryProblems("motion-prism", { enginePrompt: { mode: "template" } })).toEqual([])
  })

  it("an engine takes the setting only when it declares castSwap.styleOnly", () => {
    expect(engineTakesStyleOnly(undefined)).toBe(false)
    expect(engineTakesStyleOnly({})).toBe(false)
    expect(engineTakesStyleOnly({ styleOnly: false })).toBe(false)
    expect(engineTakesStyleOnly({ styleOnly: true })).toBe(true)
  })

  it("the step record mirrors the engine's: the path taken, and grayscale when the delivered video was made gray", () => {
    expectTypeOf<NonNullable<StepOutputs["styleOnly"]>>().toEqualTypeOf<{ path: "original" | "flex"; grayscale?: true }>()
    const record: StepOutputs = { v: 1, roles: [], styleOnly: { path: "original", grayscale: true } }
    expect(record.styleOnly).toEqual({ path: "original", grayscale: true })
  })
})
