import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { BRAND_HUES, brandHueStyle, brandHues } from "../brand-colors"

const brand = (id: string, day: number) => ({ id, createdAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00Z` })

describe("brandHues", () => {
  it("gives every brand one of the ten hues, never the same one twice among ten", () => {
    const brands = Array.from({ length: 10 }, (_, i) => brand(`brand-${i}`, i + 1))
    const hues = brandHues(brands)
    expect(new Set(hues.values()).size).toBe(10)
    for (const hue of hues.values()) expect(BRAND_HUES).toContain(hue)
  })

  it("keeps the brands' colors when a new brand is added", () => {
    const before = brandHues([brand("a", 1), brand("b", 2), brand("c", 3)])
    const after = brandHues([brand("a", 1), brand("b", 2), brand("c", 3), brand("d", 4)])
    for (const id of ["a", "b", "c"]) expect(after.get(id)).toBe(before.get(id))
  })

  it("keeps a brand's color whatever order the list arrives in", () => {
    const one = brandHues([brand("a", 1), brand("b", 2), brand("c", 3)])
    const other = brandHues([brand("c", 3), brand("a", 1), brand("b", 2)])
    expect([...other.entries()].sort()).toEqual([...one.entries()].sort())
  })

  it("past ten brands still gives whole hues from 0 to 359", () => {
    const hues = brandHues(Array.from({ length: 14 }, (_, i) => brand(`brand-${i}`, i + 1)))
    expect(hues.size).toBe(14)
    for (const hue of hues.values()) {
      expect(Number.isInteger(hue)).toBe(true)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })
})

describe("brandHueStyle", () => {
  it("hands over a number only, and nothing for no hue", () => {
    expect(brandHueStyle(250)).toEqual({ "--brand-hue": "250" })
    expect(brandHueStyle(undefined)).toBeUndefined()
    expect(brandHueStyle(Number.NaN)).toBeUndefined()
  })
})

describe("the brand color classes", () => {
  const css = readFileSync(resolve(__dirname, "../../../globals.css"), "utf8")

  it("paint the hue lighter in light mode and brighter in dark mode, in both places it is used", () => {
    expect(css).toMatch(/\.brand-swatch\s*\{[^}]*background-color:\s*oklch\(0\.62 0\.15 var\(--brand-hue\)\)/)
    expect(css).toMatch(/\.dark \.brand-swatch\s*\{[^}]*background-color:\s*oklch\(0\.76 0\.14 var\(--brand-hue\)\)/)
    expect(css).toMatch(/\.brand-top\s*\{[^}]*border-top-color:\s*oklch\(0\.62 0\.15 var\(--brand-hue\)\)/)
    expect(css).toMatch(/\.dark \.brand-top\s*\{[^}]*border-top-color:\s*oklch\(0\.76 0\.14 var\(--brand-hue\)\)/)
  })
})
