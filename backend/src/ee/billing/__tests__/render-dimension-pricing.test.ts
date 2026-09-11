/**
 * Scene3D render frame-size tiers — pricing-seed and no-price-move guard.
 *
 * Three properties, each of which has its own failure mode:
 *
 * 1. **The composites exist.** `getModelCreditBaseCost` hard-fails on an
 *    unconfigured identifier, so a tier missing from `STATIC_CREDIT_COSTS`
 *    turns every 2560 px render into a 503 `price_not_configured` — a legal
 *    request refused for a reason nobody can see from outside.
 * 2. **The ladder is the multiplier.** The tiers are DERIVED from the base
 *    render, so repricing the base moves all three together. A hand-edited
 *    number here would break that silently and only show up on an invoice.
 * 3. **Nothing gets more expensive.** The bare `render-video` price is the
 *    promise this change rests on: every frame that was renderable before the
 *    2560 px cap keeps exactly the price it had.
 *
 * The migration is read as TEXT rather than executed: the rows it seeds must
 * carry the same numbers the runtime charges, or `/admin/models` shows an
 * operator a price the platform does not use.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  RENDER_VIDEO_CREDIT_ID,
  SCENE3D_RENDER_TIERS,
  renderVideoCreditId,
  scene3DRenderTierCredits,
} from "@nodaro/shared"
import { STATIC_CREDIT_COSTS, CREDIT_COSTS } from "../credits.js"

const MIGRATION = join(
  process.cwd(),
  process.cwd().endsWith("backend") ? ".." : ".",
  "supabase/migrations/418_scene3d_render_dimension_pricing.sql",
)

/** Every identifier the tier ladder can produce, base included. */
const TIER_IDS = SCENE3D_RENDER_TIERS.map((tier) => ({
  tier,
  id: tier === "base" ? RENDER_VIDEO_CREDIT_ID : `${RENDER_VIDEO_CREDIT_ID}:3d-${tier}`,
}))

describe("Scene3D render dimension pricing", () => {
  it.each(TIER_IDS)('STATIC_CREDIT_COSTS["$id"] is a positive number', ({ id }) => {
    const value = STATIC_CREDIT_COSTS[id]
    expect(typeof value, `${id} missing from STATIC_CREDIT_COSTS (503 trap)`).toBe("number")
    expect(value, `${id} must be a positive hold value, got ${value}`).toBeGreaterThan(0)
  })

  it("prices every tier as the declared multiple of the base render", () => {
    const base = STATIC_CREDIT_COSTS[RENDER_VIDEO_CREDIT_ID]
    for (const { tier, id } of TIER_IDS) {
      expect(STATIC_CREDIT_COSTS[id], `${id} is not ${tier}'s multiple of ${base}`).toBe(
        scene3DRenderTierCredits(base, tier),
      )
    }
  })

  it("leaves the base render at its pre-cap price", () => {
    // The one number this change must NOT move. It is also what the public
    // docs' worked examples (50 / 75 / 125) are computed from.
    expect(STATIC_CREDIT_COSTS[RENDER_VIDEO_CREDIT_ID]).toBe(50)
    expect(STATIC_CREDIT_COSTS["render-video:3d-large"]).toBe(75)
    expect(STATIC_CREDIT_COSTS["render-video:3d-xlarge"]).toBe(125)
  })

  it("keeps the ladder strictly increasing", () => {
    const values = TIER_IDS.map(({ id }) => STATIC_CREDIT_COSTS[id])
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })

  it("seeds each new tier in the migration at the runtime price", () => {
    const sql = readFileSync(MIGRATION, "utf8")
    for (const { tier, id } of TIER_IDS) {
      if (tier === "base") continue
      const row = new RegExp(`'${id}',\\s*(\\d+),\\s*true`).exec(sql)
      expect(row, `${id} not seeded in migration 418`).not.toBeNull()
      expect(Number(row![1]), `${id} seeded at a price the runtime does not charge`).toBe(
        STATIC_CREDIT_COSTS[id],
      )
    }
    expect(sql, "the migration must preserve admin overrides").toContain("ON CONFLICT (model_identifier) DO NOTHING")
  })

  it("never re-seeds or updates the base render row", () => {
    // Re-inserting it would be harmless; UPDATEing it would silently reprice
    // every existing workflow, which is exactly what this change promises not
    // to do.
    const sql = readFileSync(MIGRATION, "utf8")
    const statements = sql.replace(/--[^\n]*/g, "")
    expect(statements).not.toMatch(/UPDATE\s+model_pricing/i)
    expect(statements).not.toMatch(/'render-video'\s*,/)
  })

  it("resolves the node-type estimator to the same id the route charges", () => {
    const resolver = CREDIT_COSTS["render-video"]
    expect(resolver).toBeDefined()
    const plan = { planType: "3d-scene", plan: { width: 2560, height: 2560 } }
    expect(resolver(plan)).toBe(renderVideoCreditId(plan))
    expect(resolver(plan)).toBe("render-video:3d-xlarge")
    // A node whose plan comes from upstream carries none: the flat id, and a
    // configured one — never an unpriced guess.
    expect(resolver({ fps: 30, aspectRatio: "16:9" })).toBe(RENDER_VIDEO_CREDIT_ID)
    expect(STATIC_CREDIT_COSTS[resolver({})]).toBeGreaterThan(0)
  })
})
