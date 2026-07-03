import { describe, it, expect, test } from "vitest"
import { resolveBrand, blueprintFontFamily, resolveBlueprintAccent, resolveHeadingType, resolveBodyType } from "../brand.js"
import { resolveBrandInput, BRAND_PRESETS, BRAND_PRESET_IDS, type BrandTypeSpec, type SupportedFontName } from "@nodaro/shared"
import { FONT_LOADED_WEIGHTS } from "../font-registry.js"

/** Shared fixture: a brand with only `fonts.headingType` set (palette is fixed
 *  filler, unused by the assertions below). */
const brandWithHeadingType = (headingType: BrandTypeSpec, font: SupportedFontName = "Inter") =>
  resolveBrand(
    resolveBrandInput({
      palette: { bg: "#000", text: "#fff", accent: "#fff" },
      fonts: { heading: font, body: font, headingType },
    }),
    "#000",
  )

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

const noBrand = resolveBrand(undefined, "#000")

test("byte-identical: no brand + no fallback tracking/casing => keys omitted", () => {
  const s = resolveHeadingType(noBrand, "Hello", { weight: 700 })
  expect(s.fontWeight).toBe(700)
  expect("letterSpacing" in s).toBe(false)
  expect("textTransform" in s).toBe(false)
})
test("no brand keeps fallback tracking + casing", () => {
  const s = resolveHeadingType(noBrand, "Hi", { weight: 700, tracking: "-0.02em", casing: "uppercase" })
  expect(s.letterSpacing).toBe("-0.02em")
  expect(s.textTransform).toBe("uppercase")
})
test("brand weight/casing/tracking override fallback", () => {
  const b = brandWithHeadingType({ weight: 900, casing: "uppercase", tracking: 0.1 })
  const s = resolveHeadingType(b, "Hi", { weight: 700, tracking: "-0.02em" })
  expect(s.fontWeight).toBe(900)
  expect(s.textTransform).toBe("uppercase")
  expect(s.letterSpacing).toBe("0.1em")
})
test('casing "none" forces no transform (overrides fallback uppercase)', () => {
  const b = brandWithHeadingType({ casing: "none" })
  const s = resolveHeadingType(b, "Hi", { weight: 700, casing: "uppercase" })
  expect("textTransform" in s).toBe(false)
})
test("Arabic suppresses tracking (brand AND fallback); Hebrew keeps it", () => {
  const b = brandWithHeadingType({ tracking: 0.1 }, "Cairo")
  expect("letterSpacing" in resolveHeadingType(b, "مرحبا", { weight: 700, tracking: "-0.02em" })).toBe(false)
  expect(resolveHeadingType(b, "שלום", { weight: 700 }).letterSpacing).toBe("0.1em")
  expect("letterSpacing" in resolveHeadingType(noBrand, "مرحبا", { weight: 700, tracking: "-0.02em" })).toBe(false)
})
test("brand tracking:0 overrides fallback tracking", () => {
  const b = brandWithHeadingType({ tracking: 0 })
  expect(resolveHeadingType(b, "Hi", { weight: 700, tracking: "-0.02em" }).letterSpacing).toBe("0em")
})
test("resolveBodyType reads fonts.bodyType (not headingType) and fonts.body (not heading)", () => {
  const b = resolveBrand(
    resolveBrandInput({
      palette: { bg: "#000", text: "#fff", accent: "#fff" },
      fonts: { heading: "Anton", body: "Inter", headingType: { weight: 700 }, bodyType: { weight: 400 } },
    }),
    "#000",
  )
  const s = resolveBodyType(b, "Hi", { weight: 999 })
  // A copy-paste slip reading headingType would yield 700 here instead.
  expect(s.fontWeight).toBe(400)
  expect(s.fontFamily).toContain("Inter")
  expect(s.fontFamily).not.toContain("Anton")
})
test("GUARD: every preset weight is loaded for its font", () => {
  for (const id of BRAND_PRESET_IDS) {
    const f = BRAND_PRESETS[id].fonts
    if (f.headingType?.weight) expect(FONT_LOADED_WEIGHTS[f.heading]).toContain(f.headingType.weight)
    if (f.bodyType?.weight) expect(FONT_LOADED_WEIGHTS[f.body]).toContain(f.bodyType.weight)
  }
})
