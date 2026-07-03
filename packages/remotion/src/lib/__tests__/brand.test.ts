import { describe, it, expect } from "vitest"
import { resolveBrand, blueprintFontFamily, resolveBlueprintAccent } from "../brand.js"
import { BRAND_PRESETS } from "@nodaro/shared"

describe("resolveBlueprintAccent (precedence: explicit > brand > default)", () => {
  const brand = resolveBrand(BRAND_PRESETS["midnight-violet"], "#000") // accent = #8B5CF6
  it("explicit param wins", () => {
    expect(resolveBlueprintAccent("#ff0000", brand, "#f5f5f7")).toBe("#ff0000")
  })
  it("brand accent fills when param omitted", () => {
    expect(resolveBlueprintAccent(undefined, brand, "#f5f5f7")).toBe("#8B5CF6")
  })
  it("hardcoded default fills when no param and no brand", () => {
    expect(resolveBlueprintAccent(undefined, resolveBrand(undefined, "#000"), "#f5f5f7")).toBe("#f5f5f7")
  })
})

describe("resolveBrand", () => {
  it("with no brandTokens returns only backgroundColor (byte-identical path)", () => {
    const r = resolveBrand(undefined, "#123456")
    expect(r).toEqual({ backgroundColor: "#123456" })
    expect(r.palette).toBeUndefined()
    expect(r.fonts).toBeUndefined()
  })

  it("with brandTokens overrides backgroundColor from palette.bg and carries palette/fonts/logo", () => {
    const t = BRAND_PRESETS["midnight-violet"]
    const r = resolveBrand(t, "#999999")
    expect(r.backgroundColor).toBe(t.palette.bg)
    expect(r.palette).toEqual(t.palette)
    expect(r.fonts).toEqual(t.fonts)
  })
})

describe("blueprintFontFamily", () => {
  it("defaults to Montserrat when no brand fonts", () => {
    expect(blueprintFontFamily({ backgroundColor: "#000" })).toContain("Montserrat")
  })

  it("uses the brand heading font when present", () => {
    const r = resolveBrand(BRAND_PRESETS["poster-contrast"], "#000")
    // poster-contrast heading is Anton
    expect(blueprintFontFamily(r)).toContain("Anton")
  })
})
