/**
 * EDIT PLAN — the price table (STATIC_CREDIT_COSTS fallback; migrations 432 +
 * 465 seed the same rows into model_pricing).
 *
 * `credits = per_minute(tier) × bucket_minutes + flat(tier)`, where the flat is
 * charged in Clips and Trailer modes (Trailer reuses the Clips flat, decided
 * 2026-09-23). Because Trailer's rows equal Clips' row for row, the bare
 * `edit-plan` id — the table MAX the pre-run balance gate falls back to — stays
 * 1480 (an `ON CONFLICT DO NOTHING` seed could not raise a live row).
 *
 * The worked examples are the ones in docs/nodes/processing-video/edit-plan.md.
 */
import { describe, it, expect } from "vitest"
import { EDIT_PLAN_BUCKET_MINUTES, EDIT_PLAN_TIERS, buildEditPlanCreditId } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"

const trailerIds = EDIT_PLAN_TIERS.flatMap((tier) =>
  EDIT_PLAN_BUCKET_MINUTES.map((bucket) => buildEditPlanCreditId("trailer", tier, bucket * 60)),
)

describe("edit-plan trailer composites", () => {
  it("prices all 18 trailer composites (3 tiers × 6 buckets)", () => {
    expect(trailerIds).toHaveLength(18)
    for (const id of trailerIds) expect(STATIC_CREDIT_COSTS[id], id).toBeTypeOf("number")
  })

  it("each trailer row equals its clips twin (trailer = clips flat)", () => {
    for (const id of trailerIds) {
      const clipsTwin = id.replace("edit-plan:trailer:", "edit-plan:clips:")
      expect(STATIC_CREDIT_COSTS[id], id).toBe(STATIC_CREDIT_COSTS[clipsTwin])
    }
  })

  it("the bare edit-plan id stays the table MAX, 1480", () => {
    const composites = Object.entries(STATIC_CREDIT_COSTS)
      .filter(([k]) => k.startsWith("edit-plan:"))
      .map(([, v]) => v)
    expect(composites).toHaveLength(72) // 4 modes × 3 tiers × 6 buckets
    expect(STATIC_CREDIT_COSTS["edit-plan"]).toBe(1480)
    expect(Math.max(...composites)).toBe(1480)
  })
})

describe("edit-plan docs worked examples", () => {
  it.each([
    ["Tighten · standard · 45-min", "tighten", "standard", 45, 240],
    ["Chapters · economy · 20-min", "chapters", "economy", 20, 60],
    ["Clips · premium · 90-min", "clips", "premium", 90, 760],
    ["Trailer · standard · 60-min", "trailer", "standard", 60, 260],
    ["Trailer · economy · 25-min", "trailer", "economy", 25, 70],
  ] as const)("%s", (_label, mode, tier, minutes, credits) => {
    expect(STATIC_CREDIT_COSTS[buildEditPlanCreditId(mode, tier, minutes * 60)]).toBe(credits)
  })
})
