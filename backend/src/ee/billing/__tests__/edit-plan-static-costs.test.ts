/**
 * EDIT PLAN — the price table (STATIC_CREDIT_COSTS fallback; migration 484
 * seeds the same rows into model_pricing).
 *
 * ONE rate row and ONE flat row per mode × tier (decided 2026-10-07). An id a
 * run reserves, `edit-plan:<mode>:<tier>:<N>m`, costs `flat + rate × N`, where
 * the flat is charged in Clips and Trailer modes (Trailer reuses the Clips
 * flat, decided 2026-09-23). The bare `edit-plan` id — the table MAX the
 * pre-run balance gate falls back to — stays 1480.
 *
 * The worked examples are the ones in docs/nodes/processing-video/edit-plan.md:
 * per started minute (a plugin that declares it), and at the step (one that
 * does not yet).
 */
import { describe, it, expect } from "vitest"
import {
  EDIT_PLAN_TIERS,
  buildEditPlanCreditId,
  editPlanFlatCreditId,
  editPlanMinutesCreditId,
  editPlanRateCreditId,
} from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"

/** An id's base price, as every estimate and the reserve read it. */
const priceOf = (id: string) => {
  const parts = id.split(":")
  const base = CreditsService.estimateWorkflowBaseCredits(
    [{ id: "p", type: "edit-plan", data: { mode: parts[1], planTier: parts[2] } }],
    [],
    { scope: "whole-graph" },
  )
  return { id, base }
}

describe("edit-plan trailer rows", () => {
  it("each trailer row equals its clips twin (trailer = clips flat)", () => {
    for (const tier of EDIT_PLAN_TIERS) {
      expect(STATIC_CREDIT_COSTS[editPlanRateCreditId("trailer", tier)]).toBe(STATIC_CREDIT_COSTS[editPlanRateCreditId("clips", tier)])
      expect(STATIC_CREDIT_COSTS[editPlanFlatCreditId("trailer", tier)]).toBe(STATIC_CREDIT_COSTS[editPlanFlatCreditId("clips", tier)])
    }
  })

  it("the bare edit-plan id stays the table MAX, 1480", () => {
    expect(STATIC_CREDIT_COSTS["edit-plan"]).toBe(1480)
    expect(priceOf(buildEditPlanCreditId("trailer", "premium")).base).toBe(1480)
  })
})

/** flat + rate × N from the static rows. */
const formula = (mode: "tighten" | "clips" | "chapters" | "trailer", tier: "economy" | "standard" | "premium", n: number) =>
  STATIC_CREDIT_COSTS[editPlanFlatCreditId(mode, tier)]! + STATIC_CREDIT_COSTS[editPlanRateCreditId(mode, tier)]! * n

describe("edit-plan docs worked examples", () => {
  it.each([
    ["Tighten · standard · 45-min, per started minute", "tighten", "standard", 45, 180],
    ["Tighten · standard · 45-min, at the step (60)", "tighten", "standard", 60, 240],
    ["Chapters · economy · 20-min, per started minute", "chapters", "economy", 20, 40],
    ["Clips · premium · 90-min", "clips", "premium", 90, 760],
    ["Trailer · standard · 60-min", "trailer", "standard", 60, 260],
    ["Trailer · economy · 25-min, per started minute", "trailer", "economy", 25, 60],
    ["Trailer · economy · 25-min, at the step (30)", "trailer", "economy", 30, 70],
  ] as const)("%s", (_label, mode, tier, minutes, credits) => {
    expect(formula(mode, tier, minutes)).toBe(credits)
    expect(editPlanMinutesCreditId(mode, tier, minutes)).toBe(`edit-plan:${mode}:${tier}:${minutes}m`)
  })
})
