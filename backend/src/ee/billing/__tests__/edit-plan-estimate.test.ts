/**
 * An Edit Plan node carries no `provider`, so the workflow estimate used to
 * fall through to the bare `edit-plan` id — the MAXIMUM of the whole table
 * (premium clips at the 180-minute bucket) — whatever mode and tier the node
 * runs. The estimate must quote the node's OWN mode × tier at the ceiling
 * bucket (no recording length is known here): never under the reservation,
 * never another mode's or tier's price. Mirrors the editor's estimator.
 */
import { describe, it, expect } from "vitest"
import { editPlanFlatCreditId, editPlanRateCreditId, type EditPlanMode, type EditPlanTier } from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"

/** A mode/tier at the 180-minute ceiling: flat + rate × 180 from its rows (decided 2026-10-07). */
const ceilingOf = (mode: EditPlanMode, tier: EditPlanTier) =>
  STATIC_CREDIT_COSTS[editPlanFlatCreditId(mode, tier)]! + STATIC_CREDIT_COSTS[editPlanRateCreditId(mode, tier)]! * 180

const estimate = (data?: Record<string, unknown>) =>
  CreditsService.estimateWorkflowBaseCredits([{ id: "p", type: "edit-plan", data }], [], { scope: "whole-graph" })

describe("workflow estimate — Edit Plan", () => {
  it.each([
    ["tighten", "standard"],
    ["tighten", "economy"],
    ["clips", "premium"],
    ["chapters", "economy"],
  ] as const)("prices a %s / %s node at its own ceiling bucket", (mode, planTier) => {
    const ceiling = ceilingOf(mode, planTier)
    expect(ceiling).toBeGreaterThan(0)
    expect(estimate({ mode, planTier })).toBe(ceiling)
  })

  it("defaults an unset mode and tier the way the run does (tighten, standard)", () => {
    expect(estimate()).toBe(ceilingOf("tighten", "standard"))
  })

  it("is not the bare table maximum for a node that runs a cheaper mode", () => {
    expect(estimate({ mode: "tighten", planTier: "standard" })).not.toBe(STATIC_CREDIT_COSTS["edit-plan"])
  })
})
