import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const BLUEPRINT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")

function blueprintFiles(): string[] {
  return readdirSync(BLUEPRINT_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => !["types.tsx"].includes(f))
}

describe("blueprint brand-fill adoption (drift guard)", () => {
  it("no blueprint hardcodes FONT_MAP[\"Montserrat\"] — all use blueprintFontFamily(brand)", () => {
    const offenders: string[] = []
    for (const f of blueprintFiles()) {
      const src = readFileSync(join(BLUEPRINT_DIR, f), "utf8")
      if (src.includes('FONT_MAP["Montserrat"]')) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  it("every blueprint that renders text calls blueprintFontFamily(brand)", () => {
    const missing: string[] = []
    for (const f of blueprintFiles()) {
      const src = readFileSync(join(BLUEPRINT_DIR, f), "utf8")
      // every current blueprint sets a fontFamily; after this task that must be via the helper
      if (src.includes("fontFamily") && !src.includes("blueprintFontFamily(brand)")) missing.push(f)
    }
    expect(missing).toEqual([])
  })

  it("every blueprint uses resolveBlueprintAccent(...) instead of inlining the accent fallback chain", () => {
    // All 13 current blueprints reference an accent color; verified by grep before
    // writing this test. A future blueprint that inlines `?? brand.palette?.accent`
    // instead of calling the shared helper would silently fork the precedence rule
    // (explicit param → brand accent → hardcoded default) — this scan catches it.
    const missing: string[] = []
    for (const f of blueprintFiles()) {
      const src = readFileSync(join(BLUEPRINT_DIR, f), "utf8")
      if (!src.includes("resolveBlueprintAccent")) missing.push(f)
    }
    expect(missing).toEqual([])
  })
})
