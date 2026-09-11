import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Migration 419 — 3D Render Pro's tiered per-frame rows, DERIVED.
 *
 * Pro's per-frame rates are deployment configuration seeded by an operator;
 * no Pro rate exists in this repository, so the migration reads each tier from
 * the base row it is a multiple of rather than inventing a number. That makes
 * it a no-op on every database CI ever sees, which in turn makes the migration
 * chain a proof only that the statement PARSES.
 *
 * The arithmetic and the filtering are proved for real against Postgres in
 * `supabase/tests/scene3d-pro-render-tiers.behavior.sql`, which seeds base
 * rows and executes the derivation itself. That only proves something about
 * the MIGRATION as long as the two statements stay identical — which is what
 * this file guards, alongside the multipliers and the id spelling, both of
 * which live in `@nodaro/shared` and must not be restated differently in SQL.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const MIGRATION = join(ROOT, "supabase/migrations/419_scene3d_pro_render_tiered_pricing.sql")
const PROOF = join(ROOT, "supabase/tests/scene3d-pro-render-tiers.behavior.sql")

const START = ">>> DERIVATION"
const END = "<<< DERIVATION <<<"

/** Every statement between the markers, marker lines excluded. */
function derivations(path: string): string[] {
  const lines = readFileSync(path, "utf8").split("\n")
  const blocks: string[] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (line.includes(START)) { current = []; continue }
    if (line.includes(END)) {
      if (current) blocks.push(current.join("\n").trim())
      current = null
      continue
    }
    current?.push(line)
  }
  expect(current, `unterminated ${START} block in ${path}`).toBeNull()
  return blocks
}

/**
 * `pro3DRenderFrameUnit` and `SCENE3D_RENDER_TIER_MULTIPLIERS` arrive with the
 * render-dimension-pricing lane (PR #1340). Read them when they are there so
 * this test governs the SQL from the real source, and fall back to the literal
 * ladder that lane defines until it merges — the fallback is not a second
 * opinion, it is the same ladder written out, and the moment the exports land
 * a divergence fails here rather than mispricing a frame.
 */
const shared = (await import("@nodaro/shared")) as Record<string, unknown>
const MULTIPLIERS =
  (shared.SCENE3D_RENDER_TIER_MULTIPLIERS as Record<string, number> | undefined) ??
  { base: 1, large: 1.5, xlarge: 2.5 }
const frameUnit = shared.pro3DRenderFrameUnit as
  | ((quality: string, tier?: string) => string)
  | undefined

describe("migration 419 — Pro tiered per-frame pricing", () => {
  const migration = derivations(MIGRATION)
  const proof = derivations(PROOF)

  it("the behavioral proof runs the migration's own statement, byte for byte", () => {
    expect(migration).toHaveLength(1)
    expect(proof.length).toBeGreaterThanOrEqual(2)
    for (const block of proof) expect(block).toBe(migration[0])
  })

  it("uses the shared multipliers, not numbers of its own", () => {
    const sql = migration[0]
    const values = /CROSS JOIN \(VALUES (.*?)\) AS tier\(name, multiplier\)/.exec(sql)?.[1]
    expect(values, `no tier VALUES list in:\n${sql}`).toBeTruthy()
    const pairs = [...values!.matchAll(/\('([a-z]+)',\s*([0-9.]+)\)/g)]
      .map(([, name, n]) => [name, Number(n)] as const)
    expect(Object.fromEntries(pairs)).toEqual({
      large: MULTIPLIERS.large,
      xlarge: MULTIPLIERS.xlarge,
    })
    // `base` is 1x by definition and keeps the BARE id, so it must not appear
    // as a row to insert — a `:base` row would be a second price for frames
    // the existing row already prices.
    expect(pairs.map(([name]) => name)).not.toContain("base")
  })

  it("spells the tiered id the way pro3DRenderFrameUnit does", () => {
    // `<base id> || ':' || <tier>` — the SQL half of the same rule.
    expect(migration[0]).toContain("base.model_identifier || ':' || tier.name")
    if (frameUnit) {
      expect(frameUnit("standard", "large")).toBe("pro-3d-render:render-frame:standard:large")
      expect(frameUnit("standard", "xlarge")).toBe("pro-3d-render:render-frame:standard:xlarge")
      expect(frameUnit("standard")).toBe("pro-3d-render:render-frame:standard")
    }
  })

  it("selects base rows only, and never re-tiers a tier", () => {
    const sql = migration[0]
    expect(sql).toContain("LIKE 'pro-3d-render:render-frame:%'")
    expect(sql).toContain("NOT LIKE 'pro-3d-render:render-frame:%:%'")
  })

  it("rounds UP, so a tier can never cost less per frame than its base", () => {
    expect(migration[0]).toMatch(/CEIL\(base\.credit_cost \* tier\.multiplier\)/)
    expect(migration[0]).not.toMatch(/\bROUND\(base\.credit_cost/)
    expect(migration[0]).not.toMatch(/\bFLOOR\(/)
  })

  it("preserves operator overrides and never writes a base row", () => {
    const sql = migration[0]
    expect(sql).toContain("ON CONFLICT (model_identifier) DO NOTHING")
    expect(sql).not.toMatch(/DO UPDATE/i)
    expect(sql).not.toMatch(/^\s*UPDATE\s/im)
    expect(sql).not.toMatch(/^\s*DELETE\s/im)
  })

  it("invents no rate: the migration carries no literal price", () => {
    // The only bare numbers allowed in the whole file are the two multipliers
    // and the ROUND scale. A credit figure here would be someone else's
    // hardware priced from this repository.
    const body = readFileSync(MIGRATION, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
    const numbers = [...body.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((m) => m[0])
    expect(numbers.sort()).toEqual(["1.5", "2.5", "6"])
  })
})
