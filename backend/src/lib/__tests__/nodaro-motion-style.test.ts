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
 * `nodaro_motion_style` (pure): who chooses a direct Video Remake run's
 * style per engine. Nothing set, an engine left out, or "user" = people
 * choose, exactly as before the setting.
 */
describe("nodaro_motion_style", () => {
  it("offers exactly users choose, Precise in Video Remake and always Flex", () => {
    expect(NODARO_MOTION_STYLE_CHOICES).toEqual(["user", "precise", "flex"])
  })

  it("an admin's save is strict: the current engine ids, the three choices", () => {
    expect(nodaroMotionStyleSchema.safeParse({}).success).toBe(true)
    expect(nodaroMotionStyleSchema.safeParse({ "nodaro-prism": "flex", "nodaro-pulse": "user" }).success).toBe(true)
    for (const bad of [{ "motion-pro": "flex" }, { "seedance-2-5": "flex" }, { "nodaro-prism": "motion" }, { "nodaro-prism": "Flex" }, null, "flex"]) {
      expect(nodaroMotionStyleSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("stores only the forced engines ('user' is the same as left out)", () => {
    expect(forcedStyles({ "nodaro-prism": "user", "nodaro-pulse": "precise" })).toEqual({ "nodaro-pulse": "precise" })
    expect(forcedStyles({ "nodaro-prism": "user" })).toEqual({})
    expect(forcedStyles(null)).toEqual({})
    expect(anyStyleForced({ "nodaro-prism": "user" })).toBe(false)
    expect(anyStyleForced(null)).toBe(false)
    expect(anyStyleForced({ "nodaro-pulse": "flex" })).toBe(true)
  })

  it("reads the stored row tolerantly: an earlier engine key as the current one, an unknown value dropped", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionStyle({ "motion-pro": "flex", "motion-lite": "precise" }, warn)).toEqual({ "nodaro-prism": "flex", "nodaro-pulse": "precise" })
    // The ids before nodaro-prism / nodaro-pulse read as the current ones too, the newest key winning.
    expect(parseNodaroMotionStyle({ "motion-prism": "flex", "motion-pulse": "precise" }, warn)).toEqual({ "nodaro-prism": "flex", "nodaro-pulse": "precise" })
    expect(parseNodaroMotionStyle({ "motion-pro": "precise", "motion-prism": "flex" }, warn)).toEqual({ "nodaro-prism": "flex" })
    expect(parseNodaroMotionStyle({ "motion-prism": "precise", "motion-pro": "user", "nodaro-prism": "flex" }, warn)).toEqual({ "nodaro-prism": "flex" })
    // The current key wins over the earlier one.
    expect(parseNodaroMotionStyle({ "motion-pro": "precise", "nodaro-prism": "flex" }, warn)).toEqual({ "nodaro-prism": "flex" })
    expect(parseNodaroMotionStyle({ "nodaro-prism": "sometimes", "nodaro-pulse": "flex" }, warn)).toEqual({ "nodaro-pulse": "flex" })
    expect(parseNodaroMotionStyle({ "nodaro-prism": "user" }, warn)).toEqual({})
    expect(parseNodaroMotionStyle("flex", warn)).toBeNull()
    expect(parseNodaroMotionStyle(undefined, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it("answers clients every engine, 'user' where nothing is forced", () => {
    expect(styleChoices(null)).toEqual({ "nodaro-prism": "user", "nodaro-pulse": "user" })
    expect(styleChoices({})).toEqual({ "nodaro-prism": "user", "nodaro-pulse": "user" })
    expect(styleChoices({ "nodaro-pulse": "flex" })).toEqual({ "nodaro-prism": "user", "nodaro-pulse": "flex" })
  })

  it("answers the plugin null when nothing is forced, else each forced engine under its current and earlier key (fresh copies)", () => {
    expect(styleForPlugin(null)).toBeNull()
    expect(styleForPlugin({})).toBeNull()
    expect(styleForPlugin({ "nodaro-prism": "user" })).toBeNull()
    const saved = { "nodaro-prism": "flex" as const }
    const got = styleForPlugin(saved)
    expect(got).toEqual({ "nodaro-prism": "flex", "motion-prism": "flex", "motion-pro": "flex" })
    got!["nodaro-prism"] = "precise"
    expect(saved).toEqual({ "nodaro-prism": "flex" })
  })

  it("an engine enforces it only when it declares castSwap.styleChoice: true", () => {
    expect(engineTakesStyleChoice(undefined)).toBe(false)
    expect(engineTakesStyleChoice({})).toBe(false)
    expect(engineTakesStyleChoice({ styleChoice: false })).toBe(false)
    expect(engineTakesStyleChoice({ styleChoice: true })).toBe(true)
  })
})
