import { describe, it, expect } from "vitest"
import { buildPickerAnalyzerSpec } from "@nodaro/prompts"
import { extractSection, pickerJsonKey, wouldApplyChange } from "../use-picker-json-consumer"

describe("extractSection (tolerant read)", () => {
  it("multi-section returns the picker's own section", () => {
    expect(extractSection({ person: { age: "a" }, styling: { makeup: "m" } }, "styling")).toEqual({ makeup: "m" })
  })
  it("legacy FLAT object is treated as the person section; non-person gets nothing", () => {
    expect(extractSection({ age: "a", type: "t" }, "person")).toEqual({ age: "a", type: "t" })
    expect(extractSection({ age: "a", type: "t" }, "styling")).toBeUndefined()
  })
  it("undefined → undefined", () => {
    expect(extractSection(undefined, "person")).toBeUndefined()
  })
})

describe("pickerJsonKey", () => {
  it("is order-independent", () => {
    expect(pickerJsonKey({ a: 1, b: 2 })).toBe(pickerJsonKey({ b: 2, a: 1 }))
    expect(pickerJsonKey(undefined)).toBe("")
  })
})

describe("wouldApplyChange (sync button after a hand edit)", () => {
  const lens = buildPickerAnalyzerSpec("lens")
  const injected = { lens: "portrait-85mm" }

  it("is false right after an apply", () => {
    expect(wouldApplyChange({ lens: "portrait-85mm", lastAppliedPickerJson: injected }, injected, "override", lens)).toBe(false)
  })

  it("is true once the picker is changed by hand", () => {
    expect(wouldApplyChange({ lens: "fisheye", lastAppliedPickerJson: injected }, injected, "override", lens)).toBe(true)
  })

  it("is true when a hand edit clears a detected value", () => {
    expect(wouldApplyChange({ lens: "", lastAppliedPickerJson: injected }, injected, "override", lens)).toBe(true)
  })

  it("treats unset, null and empty as the same value", () => {
    expect(wouldApplyChange({ lens: "" }, {}, "override", lens)).toBe(false)
    expect(wouldApplyChange({ lens: null }, {}, "override", lens)).toBe(false)
  })

  it("override counts a hand-set value the injection leaves empty", () => {
    expect(wouldApplyChange({ lens: "fisheye" }, {}, "override", lens)).toBe(true)
  })

  it("fill-empty never flags a hand-filled field, since applying would not touch it", () => {
    expect(wouldApplyChange({ lens: "fisheye" }, injected, "fill-empty", lens)).toBe(false)
    expect(wouldApplyChange({ lens: "" }, injected, "fill-empty", lens)).toBe(true)
  })

  it("overwrite-detected flags a hand edit of a detected dimension only", () => {
    expect(wouldApplyChange({ lens: "fisheye" }, injected, "overwrite-detected", lens)).toBe(true)
    expect(wouldApplyChange({ lens: "fisheye" }, {}, "overwrite-detected", lens)).toBe(false)
  })
})
