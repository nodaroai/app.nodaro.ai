import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { flux2BaseCredits, FLUX2_RES_MP, type Flux2Model } from "@nodaro/shared"

const MODELS: Flux2Model[] = ["flux-2-klein", "flux-2-pro", "flux-2-max"]

describe("flux-2 pricing consistency (all surfaces == flux2BaseCredits)", () => {
  it("STATIC_CREDIT_COSTS matches the formula for every mp×ref", () => {
    for (const m of MODELS) {
      for (const mp of FLUX2_RES_MP) {
        for (let r = 0; r <= 8; r++) {
          const key = `${m}:${mp}MP:${r}ref`
          expect(STATIC_CREDIT_COSTS[key], `STATIC_CREDIT_COSTS["${key}"]`).toBe(
            flux2BaseCredits(m, Number(mp), r)
          )
        }
      }
    }
  })

  it("migration 183 rows match the formula", () => {
    const sql = readFileSync(
      new URL("../../../../../supabase/migrations/183_flux2_per_mp_pricing.sql", import.meta.url),
      "utf8"
    )
    const rows = [
      ...sql.matchAll(/\('(flux-2-(?:klein|pro|max)):(0\.5|1|2|4)MP:(\d)ref',\s*(\d+)/g),
    ]
    expect(rows.length).toBe(108) // 3 models × 4 mp × 9 refs
    for (const [, model, mp, ref, cost] of rows) {
      const expected = flux2BaseCredits(model as Flux2Model, Number(mp), Number(ref))
      expect(
        Number(cost),
        `migration row ${model}:${mp}MP:${ref}ref`
      ).toBe(expected)
    }
  })
})
