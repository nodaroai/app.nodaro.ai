import { describe, it, expect } from "vitest"
import { getQuickConfigs, quickConfigSnapPatch, resolveQuickConfigOptions, type QuickConfigControl } from "../node-quick-configs"

/**
 * Mask Composite's strip: Background fit and Audio do nothing with a pixelate / blur fill (the background is the
 * frame and the only sound), so both hide there — as in the panel — and keep their stored value for the Video fill.
 */
const control = (field: string): QuickConfigControl => {
  const c = getQuickConfigs("mask-composite").find((q) => q.field === field)
  if (!c) throw new Error(`mask-composite has no ${field} control`)
  return c
}

describe("mask-composite quick strip", () => {
  it.each(["backgroundFit", "audioSource"])("%s shows for the Video fill (and an unset fill)", (field) => {
    expect(resolveQuickConfigOptions(control(field), {}).length).toBeGreaterThan(0)
    expect(resolveQuickConfigOptions(control(field), { fill: "video" }).length).toBeGreaterThan(0)
  })

  it.each(["backgroundFit", "audioSource"])("%s hides for Pixelate / Blur without clearing the stored value", (field) => {
    for (const fill of ["pixelate", "blur"]) {
      const c = control(field)
      const options = resolveQuickConfigOptions(c, { fill })
      expect(options).toEqual([])
      expect(quickConfigSnapPatch(c, field === "audioSource" ? "none" : "contain", options, { fill })).toBeUndefined()
    }
  })
})
