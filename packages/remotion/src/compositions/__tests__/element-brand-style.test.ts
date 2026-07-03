import { describe, it, expect } from "vitest"
import { elementTextStyle } from "../shot-sequence-renderer.js"
import { resolveBrand } from "../../lib/brand.js"
import { BRAND_PRESETS } from "@nodaro/shared"

const el = (over: Record<string, unknown> = {}) => ({
  id: "e1", type: "text" as const, text: "hi", fontSize: 80, x: 0, y: 0, ...over,
})

describe("elementTextStyle brand fallback", () => {
  it("uses the element's own fontFamily when set (explicit-wins)", () => {
    const brand = resolveBrand(BRAND_PRESETS["poster-contrast"], "#000") // body = Oswald
    const s = elementTextStyle(el({ fontFamily: "Anton" }), brand)
    expect(s.fontFamily).toContain("Anton")
  })

  it("falls back to brand body font when element omits fontFamily", () => {
    const brand = resolveBrand(BRAND_PRESETS["poster-contrast"], "#000") // body = Oswald
    const s = elementTextStyle(el(), brand)
    expect(s.fontFamily).toContain("Oswald")
  })

  it("with no brand and no element font, uses the Montserrat default (byte-identical intent)", () => {
    // No element fontFamily AND no brand fonts → the hardcoded "Montserrat"
    // default fires, keeping the no-brand output byte-identical to pre-brand.
    const s = elementTextStyle(el(), { backgroundColor: "#000" })
    expect(s.fontFamily).toContain("Montserrat")
  })
})

describe("elementTextStyle brand body typography (weight/transform/tracking)", () => {
  // poster-contrast bodyType: { weight: 700, casing: "uppercase", tracking: 0.06 }
  const posterContrast = () => resolveBrand(BRAND_PRESETS["poster-contrast"], "#000")

  it("element explicit fontWeight wins over brand body weight", () => {
    const s = elementTextStyle(el({ fontWeight: 300 }), posterContrast())
    expect(s.fontWeight).toBe(300)
  })

  it("element without fontWeight falls back to brand body weight", () => {
    const s = elementTextStyle(el(), posterContrast())
    expect(s.fontWeight).toBe(700)
  })

  it("defaults fontWeight to 400 with no brand and no element weight (byte-identical)", () => {
    const s = elementTextStyle(el(), { backgroundColor: "#000" })
    expect(s.fontWeight).toBe(400)
  })

  it("uses brand body tracking (em) when element omits letterSpacing", () => {
    const s = elementTextStyle(el(), posterContrast())
    expect(s.letterSpacing).toBe("0.06em")
  })

  it("element explicit letterSpacing wins over brand tracking", () => {
    const s = elementTextStyle(el({ letterSpacing: 2 }), posterContrast())
    expect(s.letterSpacing).toBe(2)
  })

  it("suppresses brand tracking for Arabic element text (no letterSpacing key)", () => {
    const s = elementTextStyle(el({ text: "مرحبا" }), posterContrast())
    expect("letterSpacing" in s).toBe(false)
  })

  it("omits letterSpacing entirely with no brand and no element letterSpacing (byte-identical)", () => {
    const s = elementTextStyle(el(), { backgroundColor: "#000" })
    expect("letterSpacing" in s).toBe(false)
  })

  it("brand body casing uppercase sets textTransform", () => {
    const s = elementTextStyle(el(), posterContrast())
    expect(s.textTransform).toBe("uppercase")
  })

  it("omits textTransform with no brand (byte-identical)", () => {
    const s = elementTextStyle(el(), { backgroundColor: "#000" })
    expect("textTransform" in s).toBe(false)
  })

  it("omits textTransform when brand body has no casing", () => {
    // midnight-violet bodyType: { weight: 400 } — no casing field
    const brand = resolveBrand(BRAND_PRESETS["midnight-violet"], "#000")
    const s = elementTextStyle(el(), brand)
    expect("textTransform" in s).toBe(false)
  })
})
