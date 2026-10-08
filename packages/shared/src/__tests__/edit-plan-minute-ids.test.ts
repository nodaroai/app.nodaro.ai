/**
 * Edit Plan per started minute (decided 2026-10-07): the id a run reserves is
 * `edit-plan:<mode>:<tier>:<N>m`, N = the started minutes of the source, priced
 * flat + rate × N from one rate row and one flat row per mode × tier. The step
 * ids (15/30/60/90/120/180) keep the same shape, so one parser reads both.
 */
import { describe, it, expect } from "vitest"
import {
  EDIT_PLAN_MAX_MINUTES,
  buildEditPlanCreditId,
  editPlanFlatCreditId,
  editPlanMinutesBaseCredits,
  editPlanRateCreditId,
  editPlanReserveCreditId,
  editPlanStartedMinutes,
  parseEditPlanMinutesCreditId,
} from "../edit-plan-contract.js"

describe("started minutes", () => {
  it.each([
    [1, 1],
    [60, 1],
    [61, 2],
    [44 * 60 + 1, 45],
    [180 * 60, 180],
    [500 * 60, EDIT_PLAN_MAX_MINUTES],
    [0, 1],
  ])("%s s → %s", (sec, minutes) => {
    expect(editPlanStartedMinutes(sec)).toBe(minutes)
  })

  it("an unknown length is the maximum", () => {
    expect(editPlanStartedMinutes(undefined)).toBe(180)
    expect(editPlanStartedMinutes(Number.NaN)).toBe(180)
  })
})

describe("the reserve id", () => {
  it("per started minute when the plugin charges that way", () => {
    expect(editPlanReserveCreditId("tighten", "standard", 44 * 60 + 1, true)).toBe("edit-plan:tighten:standard:45m")
  })

  it("the step otherwise, exactly as before", () => {
    expect(editPlanReserveCreditId("tighten", "standard", 44 * 60 + 1, false)).toBe(buildEditPlanCreditId("tighten", "standard", 44 * 60 + 1))
    expect(editPlanReserveCreditId("tighten", "standard", 44 * 60 + 1, false)).toBe("edit-plan:tighten:standard:60m")
  })

  it("an unknown length reserves the 180-minute maximum either way", () => {
    expect(editPlanReserveCreditId("clips", "premium", undefined, true)).toBe("edit-plan:clips:premium:180m")
    expect(editPlanReserveCreditId("clips", "premium", undefined, false)).toBe("edit-plan:clips:premium:180m")
  })
})

describe("the price rows", () => {
  it("one rate row and one flat row per mode × tier, neither a minutes id", () => {
    expect(editPlanRateCreditId("trailer", "economy")).toBe("edit-plan:trailer:economy:per-minute")
    expect(editPlanFlatCreditId("trailer", "economy")).toBe("edit-plan:trailer:economy:flat")
    expect(parseEditPlanMinutesCreditId(editPlanRateCreditId("trailer", "economy"))).toBeUndefined()
    expect(parseEditPlanMinutesCreditId(editPlanFlatCreditId("trailer", "economy"))).toBeUndefined()
  })

  it("flat + rate × N, rounded up, at least 1", () => {
    expect(editPlanMinutesBaseCredits(20, 4, 45)).toBe(200)
    expect(editPlanMinutesBaseCredits(0, 2, 1)).toBe(2)
    expect(editPlanMinutesBaseCredits(0, 0, 1)).toBe(1)
    expect(editPlanMinutesBaseCredits(0, 0.5, 3)).toBe(2)
  })
})

describe("parsing a minutes id", () => {
  it("reads a started-minute id and a step id alike", () => {
    expect(parseEditPlanMinutesCreditId("edit-plan:tighten:standard:45m")).toEqual({ mode: "tighten", tier: "standard", minutes: 45 })
    expect(parseEditPlanMinutesCreditId("edit-plan:trailer:premium:180m")).toEqual({ mode: "trailer", tier: "premium", minutes: 180 })
  })

  it.each(["edit-plan", "edit-plan:tighten:standard:0m", "edit-plan:tighten:standard:181m", "edit-plan:cut:standard:5m", "edit-plan:tighten:gold:5m", "apply-edl"])(
    "refuses %s",
    (id) => {
      expect(parseEditPlanMinutesCreditId(id)).toBeUndefined()
    },
  )
})
