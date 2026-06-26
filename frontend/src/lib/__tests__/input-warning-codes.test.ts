import { describe, it, expect } from "vitest"
import { INPUT_WARNING_CODES, isInputWarningCode } from "../input-warning-codes"

describe("input-warning-codes", () => {
  it("classifies SwitchX input-fit codes as warnings (orange, not red)", () => {
    expect(isInputWarningCode("VIDEO_TOO_MANY_FRAMES")).toBe(true)
    expect(isInputWarningCode("SOURCE_TOO_LARGE")).toBe(true)
  })

  it("does NOT classify real errors / unknown / non-string codes as warnings", () => {
    expect(isInputWarningCode("internal_error")).toBe(false)
    expect(isInputWarningCode("validation_error")).toBe(false)
    expect(isInputWarningCode(undefined)).toBe(false)
    expect(isInputWarningCode(123)).toBe(false)
  })

  it("carries exactly the documented SwitchX input-fit codes (pin the contract)", () => {
    expect([...INPUT_WARNING_CODES].sort()).toEqual(["SOURCE_TOO_LARGE", "VIDEO_TOO_MANY_FRAMES"])
  })
})
