import { describe, it, expect } from "vitest"
import { SUNO_SLIDER_META } from "../suno-sliders"

describe("SUNO_SLIDER_META", () => {
  it("covers the 3 weight fields in order with non-empty copy", () => {
    expect(SUNO_SLIDER_META.map((s) => s.key)).toEqual(["styleWeight", "weirdnessConstraint", "audioWeight"])
    for (const s of SUNO_SLIDER_META) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(10)
      expect(s.min).toBe(0)
      expect(s.max).toBe(1)
    }
  })
  it("defaults match the config panel (0.5 / 0 / 0.5)", () => {
    expect(SUNO_SLIDER_META.find((s) => s.key === "styleWeight")!.default).toBe(0.5)
    expect(SUNO_SLIDER_META.find((s) => s.key === "weirdnessConstraint")!.default).toBe(0)
    expect(SUNO_SLIDER_META.find((s) => s.key === "audioWeight")!.default).toBe(0.5)
  })
})
