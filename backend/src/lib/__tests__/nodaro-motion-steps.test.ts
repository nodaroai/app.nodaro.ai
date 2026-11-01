import { describe, expect, it } from "vitest"
import {
  anyStepsSet,
  NODARO_MOTION_STEPS_KEY,
  nodaroMotionStepsSaveSchema,
  nodaroMotionStepsSchema,
  parseNodaroMotionSteps,
  withEarlierStepsKeys,
  withoutEmptySteps,
} from "../nodaro-motion-steps.js"

/** The stored `nodaro_motion_steps` row: read tolerantly, written strictly. */
describe("parseNodaroMotionSteps", () => {
  const collect = () => {
    const warnings: string[] = []
    return { warnings, warn: (m: string) => warnings.push(m) }
  }
  const template = { enginePrompt: { mode: "template" } }
  const scene = { sceneDescription: { mode: "llm", llm: { model: "a-retired-model", inputs: ["clip"], maxChars: 900 } } }

  it("is keyed by app_settings row nodaro_motion_steps", () => {
    expect(NODARO_MOTION_STEPS_KEY).toBe("nodaro_motion_steps")
  })

  it("reads no row, or a row that is not an object, as never saved", () => {
    const { warn } = collect()
    expect(parseNodaroMotionSteps(undefined, warn)).toBeNull()
    expect(parseNodaroMotionSteps(null, warn)).toBeNull()
    expect(parseNodaroMotionSteps("x", warn)).toBeNull()
  })

  it("keeps each valid entry (a removed model included), drops an invalid one with a warning, and leaves an empty one out", () => {
    const { warnings, warn } = collect()
    expect(parseNodaroMotionSteps({ "motion-prism": scene, "motion-pulse": { nope: 1 } }, warn)).toEqual({ "motion-prism": scene })
    expect(warnings).toHaveLength(1)
    expect(parseNodaroMotionSteps({ "motion-prism": {}, "motion-pulse": template }, warn)).toEqual({ "motion-pulse": template })
  })

  it("reads an earlier key as its current one, the current key winning", () => {
    const { warn } = collect()
    expect(parseNodaroMotionSteps({ "motion-pro": template }, warn)).toEqual({ "motion-prism": template })
    expect(parseNodaroMotionSteps({ "motion-pro": scene, "motion-prism": template }, warn)).toEqual({ "motion-prism": template })
  })
})

describe("the saved shape", () => {
  it("is strict on engines, and the save checks the model", () => {
    expect(nodaroMotionStepsSchema.safeParse({ "motion-x": {} }).success).toBe(false)
    expect(nodaroMotionStepsSchema.safeParse({ "motion-prism": { enginePrompt: { mode: "llm", llm: { model: "a-retired-model", inputs: [], maxChars: 900 } } } }).success).toBe(true)
    expect(nodaroMotionStepsSaveSchema.safeParse({ "motion-prism": { enginePrompt: { mode: "llm", llm: { model: "a-retired-model", inputs: [], maxChars: 900 } } } }).success).toBe(false)
  })

  it("an empty entry is nothing set, and is never written", () => {
    expect(anyStepsSet(null)).toBe(false)
    expect(anyStepsSet({ "motion-prism": {} })).toBe(false)
    expect(anyStepsSet({ "motion-prism": { enginePrompt: { mode: "template" } } })).toBe(true)
    expect(withoutEmptySteps({ "motion-prism": {}, "motion-pulse": { enginePrompt: { mode: "template" } } })).toEqual({ "motion-pulse": { enginePrompt: { mode: "template" } } })
  })

  it("is answered under the current and the earlier keys", () => {
    const steps = { "motion-prism": { enginePrompt: { mode: "template" as const } } }
    expect(withEarlierStepsKeys(steps)).toEqual({ "motion-prism": steps["motion-prism"], "motion-pro": steps["motion-prism"] })
  })
})
