import { describe, it, expect } from "vitest"
import { extractSection, pickerJsonKey } from "../use-picker-json-consumer"

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
