import { describe, expect, it, vi } from "vitest"
import { CAST_SWAP_PROMPT_WORDINGS } from "@nodaro/render-rules"
import {
  NODARO_MOTION_PROMPT_WORDING_KEY,
  anyNewWording,
  engineTakesPromptWording,
  newWordings,
  nodaroMotionPromptWordingSchema,
  parseNodaroMotionPromptWording,
  promptWordingForPlugin,
  promptWordingOf,
} from "../nodaro-motion-prompt-wording.js"

/**
 * `nodaro_motion_prompt_wording` (pure): how a DIRECT Flex run's prompt is
 * worded, per Nodaro Motion engine. Nothing set, an engine left out, or
 * "current" = today's wording, exactly as before the setting.
 */
describe("nodaro_motion_prompt_wording", () => {
  it("is its own app_settings row, offering exactly current and new", () => {
    expect(NODARO_MOTION_PROMPT_WORDING_KEY).toBe("nodaro_motion_prompt_wording")
    expect(CAST_SWAP_PROMPT_WORDINGS).toEqual(["current", "new"])
  })

  it("an admin's save is strict: the current engine ids, the two wordings", () => {
    expect(nodaroMotionPromptWordingSchema.safeParse({}).success).toBe(true)
    expect(nodaroMotionPromptWordingSchema.safeParse({ "motion-prism": "new", "motion-pulse": "current" }).success).toBe(true)
    for (const bad of [{ "motion-pro": "new" }, { "seedance-2-5": "new" }, { "motion-prism": "New" }, { "motion-prism": "old" }, { "motion-prism": null }, null, "new"]) {
      expect(nodaroMotionPromptWordingSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("stores only the engines on the new wording ('current' is the same as left out)", () => {
    expect(newWordings({ "motion-prism": "current", "motion-pulse": "new" })).toEqual({ "motion-pulse": "new" })
    expect(newWordings({ "motion-prism": "current" })).toEqual({})
    expect(newWordings(null)).toEqual({})
    expect(anyNewWording({ "motion-prism": "current" })).toBe(false)
    expect(anyNewWording(null)).toBe(false)
    expect(anyNewWording({ "motion-pulse": "new" })).toBe(true)
  })

  it("reads each engine's wording, 'current' when none is set", () => {
    expect(promptWordingOf(null, "motion-prism")).toBe("current")
    expect(promptWordingOf({}, "motion-prism")).toBe("current")
    expect(promptWordingOf({ "motion-pulse": "new" }, "motion-prism")).toBe("current")
    expect(promptWordingOf({ "motion-pulse": "new" }, "motion-pulse")).toBe("new")
  })

  it("reads the stored row tolerantly: an earlier engine key as the current one, an unknown value dropped", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPromptWording({ "motion-pro": "new", "motion-lite": "current" }, warn)).toEqual({ "motion-prism": "new" })
    expect(parseNodaroMotionPromptWording({ "motion-prism": "newer", "motion-pulse": "new" }, warn)).toEqual({ "motion-pulse": "new" })
    expect(parseNodaroMotionPromptWording("new", warn)).toBeNull()
    expect(parseNodaroMotionPromptWording(undefined, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it("answers the plugin null when every engine is current, else each engine on the new wording under its current and earlier key (a fresh copy)", () => {
    expect(promptWordingForPlugin(null)).toBeNull()
    expect(promptWordingForPlugin({})).toBeNull()
    expect(promptWordingForPlugin({ "motion-prism": "current" })).toBeNull()
    const saved = { "motion-prism": "new" as const }
    const got = promptWordingForPlugin(saved)
    expect(got).toEqual({ "motion-prism": "new", "motion-pro": "new" })
    got!["motion-prism"] = "current"
    expect(saved).toEqual({ "motion-prism": "new" })
  })

  it("an engine takes a wording only when its castSwap.promptWordings lists it", () => {
    expect(engineTakesPromptWording(undefined, "new")).toBe(false)
    expect(engineTakesPromptWording({}, "new")).toBe(false)
    expect(engineTakesPromptWording({ promptWordings: ["current"] }, "new")).toBe(false)
    expect(engineTakesPromptWording({ promptWordings: ["current", "new"] }, "new")).toBe(true)
  })
})
