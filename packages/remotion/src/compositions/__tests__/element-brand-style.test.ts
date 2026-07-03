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
