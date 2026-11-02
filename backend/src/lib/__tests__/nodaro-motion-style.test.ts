import { describe, expect, it, vi } from "vitest"
import {
  NODARO_MOTION_STYLE_CHOICES,
  anyStyleForced,
  engineTakesStyleChoice,
  forcedStyles,
  nodaroMotionStyleSchema,
  parseNodaroMotionStyle,
  styleChoices,
  styleForPlugin,
} from "../nodaro-motion-style.js"

/**
 * `nodaro_motion_style` (pure): who chooses a direct Nodaro Motion run's
 * style per engine. Nothing set, an engine left out, or "user" = people
 * choose, exactly as before the setting.
 */
describe("nodaro_motion_style", () => {
  it("offers exactly users choose, always Precise and always Flex", () => {
    expect(NODARO_MOTION_STYLE_CHOICES).toEqual(["user", "precise", "flex"])
  })

  it("an admin's save is strict: the current engine ids, the three choices", () => {
    expect(nodaroMotionStyleSchema.safeParse({}).success).toBe(true)
    expect(nodaroMotionStyleSchema.safeParse({ "motion-prism": "flex", "motion-pulse": "user" }).success).toBe(true)
    for (const bad of [{ "motion-pro": "flex" }, { "seedance-2-5": "flex" }, { "motion-prism": "motion" }, { "motion-prism": "Flex" }, null, "flex"]) {
      expect(nodaroMotionStyleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("stores only the forced engines ('user' is the same as left out)", () => {
    expect(forcedStyles({ "motion-prism": "user", "motion-pulse": "precise" })).toEqual({ "motion-pulse": "precise" })
    expect(forcedStyles({ "motion-prism": "user" })).toEqual({})
    expect(forcedStyles(null)).toEqual({})
    expect(anyStyleForced({ "motion-prism": "user" })).toBe(false)
    expect(anyStyleForced(null)).toBe(false)
    expect(anyStyleForced({ "motion-pulse": "flex" })).toBe(true)
  })

  it("reads the stored row tolerantly: an earlier engine key as the current one, an unknown value dropped", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionStyle({ "motion-pro": "flex", "motion-lite": "precise" }, warn)).toEqual({ "motion-prism": "flex", "motion-pulse": "precise" })
    // The current key wins over the earlier one.
    expect(parseNodaroMotionStyle({ "motion-pro": "precise", "motion-prism": "flex" }, warn)).toEqual({ "motion-prism": "flex" })
    expect(parseNodaroMotionStyle({ "motion-prism": "sometimes", "motion-pulse": "flex" }, warn)).toEqual({ "motion-pulse": "flex" })
    expect(parseNodaroMotionStyle({ "motion-prism": "user" }, warn)).toEqual({})
    expect(parseNodaroMotionStyle("flex", warn)).toBeNull()
    expect(parseNodaroMotionStyle(undefined, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it("answers clients every engine, 'user' where nothing is forced", () => {
    expect(styleChoices(null)).toEqual({ "motion-prism": "user", "motion-pulse": "user" })
    expect(styleChoices({})).toEqual({ "motion-prism": "user", "motion-pulse": "user" })
    expect(styleChoices({ "motion-pulse": "flex" })).toEqual({ "motion-prism": "user", "motion-pulse": "flex" })
  })

  it("answers the plugin null when nothing is forced, else each forced engine under its current and earlier key (fresh copies)", () => {
    expect(styleForPlugin(null)).toBeNull()
    expect(styleForPlugin({})).toBeNull()
    expect(styleForPlugin({ "motion-prism": "user" })).toBeNull()
    const saved = { "motion-prism": "flex" as const }
    const got = styleForPlugin(saved)
    expect(got).toEqual({ "motion-prism": "flex", "motion-pro": "flex" })
    got!["motion-prism"] = "precise"
    expect(saved).toEqual({ "motion-prism": "flex" })
  })

  it("an engine enforces it only when it declares castSwap.styleChoice: true", () => {
    expect(engineTakesStyleChoice(undefined)).toBe(false)
    expect(engineTakesStyleChoice({})).toBe(false)
    expect(engineTakesStyleChoice({ styleChoice: false })).toBe(false)
    expect(engineTakesStyleChoice({ styleChoice: true })).toBe(true)
  })
})
