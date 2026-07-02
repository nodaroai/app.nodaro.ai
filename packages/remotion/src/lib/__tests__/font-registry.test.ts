import { describe, it, expect } from "vitest"
import { FONT_MAP, SUPPORTED_FONTS, RTL_FONT_FALLBACK, withRtlFallback } from "../font-registry"

describe("RTL fonts in registry", () => {
  it.each(["Rubik", "Heebo", "Cairo", "Tajawal"])("%s is a supported, mapped font", (name) => {
    expect(SUPPORTED_FONTS).toContain(name)
    expect(FONT_MAP[name]).toBeTruthy()
  })
  it("RTL_FONT_FALLBACK is derived from Rubik's loaded family (not a literal)", () => {
    expect(RTL_FONT_FALLBACK).toContain(FONT_MAP["Rubik"])
    expect(RTL_FONT_FALLBACK).toContain("sans-serif")
  })
  it("withRtlFallback appends the RTL stack to the given family", () => {
    expect(withRtlFallback("Montserrat")).toBe(`Montserrat, ${RTL_FONT_FALLBACK}`)
  })
})
