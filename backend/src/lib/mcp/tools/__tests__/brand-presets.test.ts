import { describe, it, expect } from "vitest"
import { listBrandPresets } from "../brand-presets.js"
import { BRAND_PRESET_IDS } from "@nodaro/shared"

describe("listBrandPresets", () => {
  it("returns one catalog entry per preset id with label/mood + palette/font summary", () => {
    const out = listBrandPresets()
    expect(out.map((p) => p.id).sort()).toEqual([...BRAND_PRESET_IDS].sort())
    for (const p of out) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.mood.length).toBeGreaterThan(0)
      expect(p.palette.accent).toMatch(/^#/)
      expect(p.fonts.heading.length).toBeGreaterThan(0)
    }
  })
})
