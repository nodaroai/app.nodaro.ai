import { describe, it, expect } from "vitest"
import { isMissingRelationshipError, isMissingTableError } from "../postgrest-errors.js"

describe("isMissingRelationshipError", () => {
  it("is PostgREST's schema-cache PGRST200 (an embedded table it does not know)", () => {
    expect(isMissingRelationshipError({ code: "PGRST200" })).toBe(true)
  })

  it("is false for an ambiguous embed, any other error, or none", () => {
    expect(isMissingRelationshipError({ code: "PGRST201" })).toBe(false)
    expect(isMissingRelationshipError({ code: "PGRST205" })).toBe(false)
    expect(isMissingRelationshipError(null)).toBe(false)
    expect(isMissingRelationshipError(undefined)).toBe(false)
  })
})

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
