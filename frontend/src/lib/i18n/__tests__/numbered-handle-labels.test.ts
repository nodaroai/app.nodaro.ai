import { describe, it, expect } from "vitest"
import { localizeHandleLabel } from "../labels"
import { translate } from ".."

/**
 * The overlay nodes number their layer pips in code ("Layer 3", one pip per
 * layer slot, up to the slot limit). A label table cannot hold every number,
 * so the localizer translates a numbered label as a whole through the
 * dictionary key that carries the number.
 */
describe("localizeHandleLabel — numbered layer pips", () => {
  it.each(["he", "ja", "ko"] as const)("translates “Layer N” in %s", (locale) => {
    const expected = translate(locale, "proccfg.overlay.layerN", { n: 3 })
    expect(expected).not.toBe("Layer 3")
    expect(localizeHandleLabel("Layer 3", locale)).toBe(expected)
    expect(localizeHandleLabel("Layer 24", locale)).toBe(translate(locale, "proccfg.overlay.layerN", { n: 24 }))
  })

  it("keeps the English label in English", () => {
    expect(localizeHandleLabel("Layer 3", "en")).toBe("Layer 3")
  })

  it("leaves a label that only starts like one alone", () => {
    expect(localizeHandleLabel("Layer three", "he")).toBe("Layer three")
    expect(localizeHandleLabel("Layer 3 mask", "he")).toBe("Layer 3 mask")
  })
})
