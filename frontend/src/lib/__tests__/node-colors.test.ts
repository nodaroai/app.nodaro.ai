import { describe, it, expect } from "vitest"
import {
  NODE_COLORS,
  LIGHT_COLORS_MAP,
  adjustColor,
  getEffectiveColor,
  readableInk,
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

// The ink (text) colour must follow the surface it sits on, not the theme.
// A tinted node keeps its background when the palette has no light-mode
// counterpart (imports, agents and older seeds carry arbitrary hexes), so a
// theme-fixed "dark text in light mode" rule paints slate-800 on navy — the
// Welcome Demo's sticky notes were unreadable in light mode exactly this way.
describe("readableInk", () => {
  it("picks light ink on a dark surface regardless of theme", () => {
    expect(readableInk("#2d2d44", false)).toBe("light")
    expect(readableInk("#2d2d44", true)).toBe("light")
    expect(readableInk("#0f172a", true)).toBe("light")
  })

  it("picks dark ink on a light surface regardless of theme", () => {
    expect(readableInk("#f1f5f9", false)).toBe("dark")
    expect(readableInk("#f1f5f9", true)).toBe("dark")
    expect(readableInk("#ffffff", true)).toBe("dark")
  })

  it("composites an alpha tint over the theme canvas before deciding", () => {
    // 25% brand pink over the dark canvas is still a dark surface...
    expect(readableInk("#ff007340", true)).toBe("light")
    // ...and over the light canvas it is still a light surface.
    expect(readableInk("#ff007340", false)).toBe("dark")
  })

  it("agrees with the effective (theme-mapped) palette in both themes", () => {
    for (const color of NODE_COLORS) {
      // In light mode the palette maps to a pastel: dark ink.
      expect(readableInk(getEffectiveColor(color, false), false)).toBe("dark")
      // In dark mode the palette is a dark tint: light ink.
      expect(readableInk(getEffectiveColor(color, true), true)).toBe("light")
    }
  })

  it("falls back to the theme's default ink for unparseable input", () => {
    expect(readableInk("not-a-colour", false)).toBe("dark")
    expect(readableInk("not-a-colour", true)).toBe("light")
  })
})
