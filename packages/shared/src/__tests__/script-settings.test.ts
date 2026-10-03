import { describe, it, expect } from "vitest"
import {
  readScriptSettings,
  SCRIPT_SCENE_COUNT_RANGE,
  SCRIPT_TARGET_DURATION_RANGE,
  SCRIPT_TONE_MAX_LENGTH,
} from "../script-settings.js"

describe("readScriptSettings", () => {
  it("passes typed values through", () => {
    expect(readScriptSettings({ sceneCount: 4, tone: "dramatic", targetLength: 90, styleGuide: "noir" })).toEqual({
      sceneCount: 4,
      tone: "dramatic",
      targetDuration: 90,
      styleGuide: "noir",
    })
  })

  it("turns a number given as text into a whole number (a mapped Scene Count / Duration node)", () => {
    const s = readScriptSettings({ sceneCount: "7", targetLength: "44.6" })
    expect(s.sceneCount).toBe(7)
    expect(s.targetDuration).toBe(45)
  })

  it("clamps numbers to the route's ranges", () => {
    expect(readScriptSettings({ sceneCount: 0, targetLength: 1 })).toMatchObject({
      sceneCount: SCRIPT_SCENE_COUNT_RANGE.min,
      targetDuration: SCRIPT_TARGET_DURATION_RANGE.min,
    })
    expect(readScriptSettings({ sceneCount: 500, targetLength: 99999 })).toMatchObject({
      sceneCount: SCRIPT_SCENE_COUNT_RANGE.max,
      targetDuration: SCRIPT_TARGET_DURATION_RANGE.max,
    })
  })

  it("drops a value it cannot use, so the generator's default applies", () => {
    const s = readScriptSettings({ sceneCount: "many", targetLength: "", tone: "   ", styleGuide: 42 })
    expect(s).toEqual({ sceneCount: undefined, tone: undefined, targetDuration: undefined, styleGuide: undefined })
  })

  it("trims text and cuts the tone to its limit", () => {
    const s = readScriptSettings({ tone: `  ${"a".repeat(SCRIPT_TONE_MAX_LENGTH + 50)}  `, styleGuide: "  warm  " })
    expect(s.tone).toHaveLength(SCRIPT_TONE_MAX_LENGTH)
    expect(s.styleGuide).toBe("warm")
  })

  it("reads the older keys only when the panel's field is absent", () => {
    expect(readScriptSettings({ style: "somber", targetDuration: 30 })).toMatchObject({ tone: "somber", targetDuration: 30 })
    expect(readScriptSettings({ tone: "bright", style: "somber", targetLength: 20, targetDuration: 30 })).toMatchObject({
      tone: "bright",
      targetDuration: 20,
    })
  })

  it("resolves {Node Label} references in the style guide only", () => {
    const refMap = new Map([["Brand", "teal and coral, rounded type"]])
    const s = readScriptSettings({ styleGuide: "Use {Brand}. Keep {Missing} as typed.", tone: "{Brand}" }, refMap)
    expect(s.styleGuide).toBe("Use teal and coral, rounded type. Keep {Missing} as typed.")
    expect(s.tone).toBe("{Brand}")
  })
})
