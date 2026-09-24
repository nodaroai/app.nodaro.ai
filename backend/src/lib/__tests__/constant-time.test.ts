/**
 * The comparison both internal-secret doors use (the API auth hook and the
 * plugin daemon host). Its one sharp edge — two empty strings are equal — is
 * why the daemon host refuses a secret shorter than 32 characters.
 */
import { describe, it, expect } from "vitest"
import { constantTimeEqualStr } from "../constant-time.js"

describe("constantTimeEqualStr", () => {
  it("is true only for identical strings", () => {
    expect(constantTimeEqualStr("s".repeat(40), "s".repeat(40))).toBe(true)
    expect(constantTimeEqualStr("s".repeat(40), `${"s".repeat(39)}t`)).toBe(false)
  })

  it("answers false for different lengths without throwing (timingSafeEqual would)", () => {
    expect(constantTimeEqualStr("short", "s".repeat(40))).toBe(false)
    expect(constantTimeEqualStr("s".repeat(40), "")).toBe(false)
  })

  it("compares bytes, not UTF-16 units", () => {
    expect(constantTimeEqualStr("é", "é")).toBe(false)
  })

  it("treats two empty strings as equal — callers must refuse an empty secret", () => {
    expect(constantTimeEqualStr("", "")).toBe(true)
  })
})
