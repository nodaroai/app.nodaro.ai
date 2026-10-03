import { describe, it, expect } from "vitest"
import { isMissingTableError } from "../postgrest-errors.js"

describe("isMissingTableError", () => {
  it("knows both ways a missing table is reported", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true)
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true)
  })

  it("is false for any other error, or none", () => {
    expect(isMissingTableError({ code: "23505" })).toBe(false)
    expect(isMissingTableError({ code: null })).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
    expect(isMissingTableError(undefined)).toBe(false)
  })
})
