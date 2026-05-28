import { describe, it, expect } from "vitest"
import {
  NODE_COLORS,
  LIGHT_COLORS_MAP,
  adjustColor,
  getEffectiveColor,
} from "@/lib/node-colors"

describe("NODE_COLORS", () => {
  it("has 6 entries", () => {
    expect(NODE_COLORS).toHaveLength(6)
  })

  it("all entries are valid hex format", () => {
    // Accept 6-digit (#RRGGBB) or 8-digit (#RRGGBBAA) hex — the last 3
    // palette entries use an alpha channel so the bright brand tints
    // blend onto the canvas in dark mode (case-insensitive to allow
    // both lowercase and the uppercase used for capitalized hex like
    // `#A855F740`).
    for (const color of NODE_COLORS) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
    }
  })
})

describe("LIGHT_COLORS_MAP", () => {
  it("has an entry for each NODE_COLOR", () => {
    for (const color of NODE_COLORS) {
      expect(LIGHT_COLORS_MAP).toHaveProperty(color)
    }
  })
})

describe("adjustColor", () => {
  it("brightens a dark color by the given amount", () => {
    // #0f172a: r=15, g=23, b=42 -> r=35(0x23), g=43(0x2b), b=62(0x3e)
    expect(adjustColor("#0f172a", 20)).toBe("#232b3e")
  })

  it("clamps channels at 255 when brightening white", () => {
    expect(adjustColor("#ffffff", 20)).toBe("#ffffff")
  })

  it("clamps channels at 0 when darkening black", () => {
    expect(adjustColor("#000000", -20)).toBe("#000000")
  })

  it("returns the input unchanged for non-6-digit hex", () => {
    expect(adjustColor("invalid", 10)).toBe("invalid")
  })

  it("returns the same color when amount is 0", () => {
    expect(adjustColor("#808080", 0)).toBe("#808080")
  })
})

describe("getEffectiveColor", () => {
  it("returns the color as-is in dark mode", () => {
    expect(getEffectiveColor("#0f172a", true)).toBe("#0f172a")
  })

  it("maps to the light equivalent in light mode", () => {
    expect(getEffectiveColor("#0f172a", false)).toBe("#f1f5f9")
  })

  it("returns the color as-is in light mode when no mapping exists", () => {
    expect(getEffectiveColor("#unknown", false)).toBe("#unknown")
  })
})
