import { describe, expect, it, vi } from "vitest"
import { NODARO_MOTION_ADVANCED_KEY, advancedShown, nodaroMotionAdvancedSchema, parseNodaroMotionAdvanced } from "../nodaro-motion-advanced.js"

/**
 * `nodaro_motion_advanced` (pure): whether a Nodaro Motion page shows its
 * Advanced options (Prepare references and the pre-prompt). One switch for
 * the whole page. Nothing saved, or anything but `{ show: true }`, = hidden.
 */
describe("nodaro_motion_advanced", () => {
  it("is the app_settings row nodaro_motion_advanced", () => {
    expect(NODARO_MOTION_ADVANCED_KEY).toBe("nodaro_motion_advanced")
  })

  it("an admin's save is strict: one boolean, nothing else", () => {
    expect(nodaroMotionAdvancedSchema.safeParse({ show: true }).success).toBe(true)
    expect(nodaroMotionAdvancedSchema.safeParse({ show: false }).success).toBe(true)
    for (const bad of [{}, { show: "true" }, { show: 1 }, { show: null }, { show: true, engine: "motion-prism" }, { "motion-prism": true }, true, null, "show", []]) {
      expect(nodaroMotionAdvancedSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("reads the stored row tolerantly: a boolean show is kept, anything else reads as never saved", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionAdvanced({ show: true }, warn)).toEqual({ show: true })
    expect(parseNodaroMotionAdvanced({ show: false }, warn)).toEqual({ show: false })
    // A key this app does not know is left out; the switch is kept.
    expect(parseNodaroMotionAdvanced({ show: true, later: 1 }, warn)).toEqual({ show: true })
    expect(warn).not.toHaveBeenCalled()
    for (const bad of [{ show: "true" }, { show: 1 }, { show: null }, {}, "true", true, null, undefined, []]) {
      expect(parseNodaroMotionAdvanced(bad, warn), JSON.stringify(bad)).toBeNull()
    }
    expect(warn).toHaveBeenCalled()
  })

  it("answers clients hidden unless an admin saved show: true (a new object)", () => {
    expect(advancedShown(null)).toEqual({ show: false })
    expect(advancedShown(undefined)).toEqual({ show: false })
    expect(advancedShown({ show: false })).toEqual({ show: false })
    const saved = { show: true }
    const got = advancedShown(saved)
    expect(got).toEqual({ show: true })
    expect(got).not.toBe(saved)
  })
})
