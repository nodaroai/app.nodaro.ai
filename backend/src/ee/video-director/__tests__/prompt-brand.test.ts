import { describe, it, expect } from "vitest"
import { BRAND_PRESETS } from "@nodaro/shared"
import { buildBrandBlock } from "../prompt.js"

/**
 * Guards the author-prompt brand block's two load-bearing invariants — the
 * symmetric counterpart to the renderer's tested `resolveBrand(undefined, bg)`
 * byte-identical guarantee (element-brand-style.test.ts).
 */
describe("buildBrandBlock", () => {
  it("returns the empty string for no brand (byte-identical no-brand prompt)", () => {
    // A non-empty return here would shift every no-brand prompt byte-for-byte.
    expect(buildBrandBlock(undefined)).toBe("")
  })

  it("emits the palette + fonts for a real preset", () => {
    const preset = BRAND_PRESETS["midnight-violet"]
    const block = buildBrandBlock(preset)

    expect(block.length).toBeGreaterThan(0)
    // Palette hexes must appear verbatim so the LLM authors from THIS brand.
    expect(block).toContain(preset.palette.bg)
    expect(block).toContain(preset.palette.text)
    expect(block).toContain(preset.palette.accent)
    // Both font names must appear.
    expect(block).toContain(preset.fonts.heading)
    expect(block).toContain(preset.fonts.body)
  })
})
