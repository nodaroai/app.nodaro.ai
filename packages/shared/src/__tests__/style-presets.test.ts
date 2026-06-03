import { describe, it, expect } from "vitest"
import { STYLE_PRESETS, getStylePreset } from "../style-presets.js"

describe("STYLE_PRESETS", () => {
  it("has a non-trivial catalog", () => {
    expect(STYLE_PRESETS.length).toBeGreaterThanOrEqual(8)
  })

  it("every preset has a unique id", () => {
    const ids = STYLE_PRESETS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("every preset carries usable conditioning + a label + a swatch", () => {
    for (const s of STYLE_PRESETS) {
      expect(s.label.length, `${s.id} label`).toBeGreaterThan(0)
      expect(s.swatch, `${s.id} swatch`).toMatch(/gradient|#/)
      // visualStyle is the load-bearing directive that conditions generation.
      expect(s.directives.visualStyle?.length ?? 0, `${s.id} visualStyle`).toBeGreaterThan(0)
    }
  })
})

describe("getStylePreset", () => {
  it("resolves a known id", () => {
    expect(getStylePreset("cinematic")?.label).toBe("Cinematic Photography")
  })

  it("returns undefined for the Auto / empty / unknown case", () => {
    expect(getStylePreset(undefined)).toBeUndefined()
    expect(getStylePreset("")).toBeUndefined()
    expect(getStylePreset("does-not-exist")).toBeUndefined()
  })
})
