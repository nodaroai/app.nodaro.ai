import { describe, it, expect } from "vitest"
import {
  BRAND_PRESET_IDS,
  BRAND_PRESETS,
  BRAND_PRESET_META,
  resolveBrandInput,
  type BrandTokens,
} from "../brand-tokens.js"
import { SUPPORTED_FONT_NAMES } from "@nodaro/shared"

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

describe("brand presets", () => {
  it("BRAND_PRESET_IDS exactly matches BRAND_PRESETS keys", () => {
    expect([...BRAND_PRESET_IDS].sort()).toEqual(Object.keys(BRAND_PRESETS).sort())
  })

  it("BRAND_PRESET_META has an entry per id with matching id field", () => {
    for (const id of BRAND_PRESET_IDS) {
      expect(BRAND_PRESET_META[id]).toBeDefined()
      expect(BRAND_PRESET_META[id].id).toBe(id)
      expect(BRAND_PRESET_META[id].label.length).toBeGreaterThan(0)
    }
  })

  it("ships exactly 8 presets", () => {
    expect(BRAND_PRESET_IDS.length).toBe(8)
  })

  it("every preset uses supported fonts and valid hex palette colors", () => {
    for (const id of BRAND_PRESET_IDS) {
      const t = BRAND_PRESETS[id]
      expect(SUPPORTED_FONT_NAMES).toContain(t.fonts.heading)
      expect(SUPPORTED_FONT_NAMES).toContain(t.fonts.body)
      for (const [k, v] of Object.entries(t.palette)) {
        if (v === undefined) continue
        expect(v, `${id}.palette.${k}`).toMatch(HEX)
      }
    }
  })
})

describe("resolveBrandInput", () => {
  it("resolves a preset name to its tokens", () => {
    const first = BRAND_PRESET_IDS[0]
    expect(resolveBrandInput(first)).toEqual(BRAND_PRESETS[first])
  })

  it("passes an inline BrandTokens object through unchanged", () => {
    const inline: BrandTokens = {
      palette: { bg: "#000000", text: "#ffffff", accent: "#ff0000" },
      fonts: { heading: "Anton", body: "Inter" },
    }
    expect(resolveBrandInput(inline)).toBe(inline)
  })

  it("throws a clear error on an unknown preset name", () => {
    expect(() => resolveBrandInput("does-not-exist")).toThrow(/unknown brand preset/i)
  })

  it("throws on prototype-pollution-shaped keys instead of returning a prototype member", () => {
    expect(() => resolveBrandInput("__proto__")).toThrow(/unknown brand preset/i)
    expect(() => resolveBrandInput("constructor")).toThrow(/unknown brand preset/i)
  })
})

test("every preset declares heading+body typography weight", () => {
  for (const id of BRAND_PRESET_IDS) {
    const f = BRAND_PRESETS[id].fonts
    expect(typeof f.headingType?.weight).toBe("number")
    expect(typeof f.bodyType?.weight).toBe("number")
  }
})
test("poster-contrast forces uppercase heading + body, mono-slate wide-tracked heading", () => {
  expect(BRAND_PRESETS["poster-contrast"].fonts.headingType?.casing).toBe("uppercase")
  expect(BRAND_PRESETS["poster-contrast"].fonts.bodyType?.tracking).toBe(0.06)
  expect(BRAND_PRESETS["mono-slate"].fonts.headingType?.tracking).toBe(0.12)
})
test("resolveBrandInput passes typography through for a preset name", () => {
  expect(resolveBrandInput("vibrant-pulse").fonts.headingType?.weight).toBe(900)
})
