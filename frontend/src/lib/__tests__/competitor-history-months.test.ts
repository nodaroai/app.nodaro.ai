/**
 * The pricing page's "competitor history" bullet is static, like every tier
 * bullet; the window the plugin enforces is seeded into tier_config by
 * migration 459. The two must agree, or the page promises a window the
 * scans do not keep.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PRICING_TIERS } from "../pricing-data"

const MIGRATION = join(import.meta.dirname, "../../../../supabase/migrations/459_competitor_history_months.sql")

/** The tier → months pairs the migration seeds. */
function seededMonths(): Map<string, number> {
  const sql = readFileSync(MIGRATION, "utf8")
  const seeded = new Map<string, number>()
  for (const match of sql.matchAll(/\('([a-z_]+)',\s*(\d+)\)/g)) seeded.set(match[1]!, Number(match[2]))
  return seeded
}

/** The months a tier's bullet promises, or null when it has no such bullet. */
function promisedMonths(features: (typeof PRICING_TIERS)[number]["features"]): number | null {
  const one = features.find((f) => f.key === "pricing.feat.competitorHistoryOne")
  if (one) return 1
  const many = features.find((f) => f.key === "pricing.feat.competitorHistory")
  return many ? Number(many.vars?.n) : null
}

describe("competitor history months", () => {
  const seeded = seededMonths()

  it("the migration seeds every plan the pricing page shows", () => {
    for (const tier of PRICING_TIERS) expect(seeded.has(tier.id), tier.id).toBe(true)
  })

  it("each plan's bullet promises exactly the window the migration seeds", () => {
    for (const tier of PRICING_TIERS) expect(promisedMonths(tier.features), tier.id).toBe(seeded.get(tier.id))
  })

  it("the window grows with the plan: a month for basic, then 3, 6 and 12", () => {
    expect([seeded.get("free"), seeded.get("payg"), seeded.get("basic"), seeded.get("standard"), seeded.get("pro"), seeded.get("business")]).toEqual([1, 1, 1, 3, 6, 12])
  })
})
