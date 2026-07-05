import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"
import { SUPPORTED_FONT_NAMES } from "@nodaro/shared"
import { BRAND_PRESET_IDS } from "@nodaro/prompts"
const DIR = resolve(__dirname, "../../../../skills/video-director")
const read = (f: string) => readFileSync(resolve(DIR, f), "utf-8")
describe("video-director doctrine", () => {
  it("doctrine.md has the load-bearing sections + machine contract", () => {
    const d = read("doctrine.md")
    for (const h of ["## Narrative arcs","## VO script bank","## Shot-sequence method","## Motion doctrine","## Machine contract"]) expect(d).toContain(h)
    expect(d).toMatch(/```json[\s\S]*"shotSequenceBrief"[\s\S]*```/)
    // motion doctrine must steer away from spring/bouncy
    expect(d.toLowerCase()).toContain("avoid")
    expect(d).toMatch(/easeOut|easeInOut/)
  })
  it("doctrine.md has a Blueprint picker section with all 6 blueprint ids", () => {
    const d = read("doctrine.md")
    expect(d).toContain("## Blueprint picker")
    for (const id of [
      "kinetic-type-beats",
      "dataviz-countup",
      "grid-card-assemble",
      "titlecard-reveal",
      "logo-assemble-lockup",
      "cta-morph-press",
    ]) {
      expect(d).toContain(id)
    }
    // Must include the blueprint reveal JSON shape and the escape hatch
    expect(d).toContain('"blueprint"')
    expect(d).toContain("raw")
  })
  it("genre addenda exist with arc + reveal palette", () => {
    for (const f of ["explainer.md","product-launch.md"]) {
      const g = read(f); expect(g).toContain("## Arc"); expect(g).toContain("## Reveal palette")
    }
  })
  it("doctrine lists every shared brand preset id (drift guard vs BRAND_PRESET_IDS)", () => {
    const d = read("doctrine.md")
    for (const id of BRAND_PRESET_IDS) {
      expect(d, `doctrine.md is missing brand preset "${id}" — it drifted from BRAND_PRESET_IDS`).toContain(id)
    }
  })
  it("doctrine's font list stays in sync with SUPPORTED_FONT_NAMES (count + RTL faces)", () => {
    const d = read("doctrine.md")
    // The font-list sentence hard-codes the supported-font count; assert it matches
    // the shared source of truth so adding/removing a font can't silently drift the doctrine.
    expect(d, `doctrine.md must say "${SUPPORTED_FONT_NAMES.length} supported fonts"`).toContain(
      `${SUPPORTED_FONT_NAMES.length} supported fonts`,
    )
    // The 4 RTL faces must be named so the LLM knows they're available.
    for (const rtl of ["Rubik", "Heebo", "Cairo", "Tajawal"]) {
      expect(d, `doctrine.md is missing RTL font "${rtl}"`).toContain(rtl)
    }
  })
})
