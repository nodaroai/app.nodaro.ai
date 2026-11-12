/**
 * The render's check that a Mask Composite was charged for the leading video
 * it downloaded (the foreground, or the background with pixelate / blur): a
 * file up to half a second longer than measured is the same file; a longer one
 * is refused (and refunded), and so is a job that carries no priced units.
 */
import { describe, it, expect } from "vitest"
import { MASK_COMPOSITE_REMEASURE_SLACK_SEC } from "@nodaro/shared/media"
import { maskCompositeRefusalForCharge } from "../mask-composite-refusal.js"

describe("maskCompositeRefusalForCharge", () => {
  it("the slack is half a second", () => {
    expect(MASK_COMPOSITE_REMEASURE_SLACK_SEC).toBe(0.5)
  })

  it("a lead no longer than it measured when priced passes", () => {
    expect(maskCompositeRefusalForCharge("foreground", 2, 10)).toBeUndefined()
    expect(maskCompositeRefusalForCharge("background", 60, 300)).toBeUndefined()
    // Charged for more than it needs (never refused for being shorter).
    expect(maskCompositeRefusalForCharge("foreground", 12, 4)).toBeUndefined()
  })

  it("a re-measure up to half a second longer is the same file: billed for 10 s, downloaded at 10.4 s renders; 10.6 s is refused", () => {
    expect(maskCompositeRefusalForCharge("foreground", 2, 10.4)).toBeUndefined()
    expect(maskCompositeRefusalForCharge("foreground", 2, 10.6)).toEqual({
      code: "mask_composite_lead_changed",
      message: "The foreground video is 11 seconds, longer than the 10 seconds this run was priced for — run it again",
    })
    // A very short lead never reads as "not known" (the cap) after the slack.
    expect(maskCompositeRefusalForCharge("foreground", 1, 0.3)).toBeUndefined()
  })

  it("a lead longer than the units charged is refused, named by the input the result follows", () => {
    expect(maskCompositeRefusalForCharge("foreground", 1, 60)).toEqual({
      code: "mask_composite_lead_changed",
      message: "The foreground video is 60 seconds, longer than the 5 seconds this run was priced for — run it again",
    })
    expect(maskCompositeRefusalForCharge("background", 3, 41)).toEqual({
      code: "mask_composite_lead_changed",
      message: "The background video is 41 seconds, longer than the 15 seconds this run was priced for — run it again",
    })
  })

  it("a job that carries no usable priced units is refused — never rendered at a default", () => {
    for (const billedUnits of [undefined, null, 0, -1, Number.NaN, "3"]) {
      expect(maskCompositeRefusalForCharge("foreground", billedUnits, 5)).toEqual({
        code: "mask_composite_lead_changed",
        message: "This run was not priced for its foreground video — run it again",
      })
    }
    expect(maskCompositeRefusalForCharge("background", undefined, 5)?.message).toBe("This run was not priced for its background video — run it again")
  })
})
