import { describe, it, expect } from "vitest"
import {
  ALL_SCOPES,
  isValidScope,
  parseScopeString,
  formatScopeString,
  hasScope,
  requireScope,
} from "../scopes.js"

describe("scopes", () => {
  it("ALL_SCOPES contains expected core scopes", () => {
    expect(ALL_SCOPES).toContain("workflows:read")
    expect(ALL_SCOPES).toContain("workflows:write")
    expect(ALL_SCOPES).toContain("workflows:execute")
    expect(ALL_SCOPES).toContain("jobs:read")
    expect(ALL_SCOPES).toContain("assets:read")
    expect(ALL_SCOPES).toContain("assets:write")
    expect(ALL_SCOPES).toContain("credits:read")
  })

  it("isValidScope rejects unknown scopes", () => {
    expect(isValidScope("workflows:read")).toBe(true)
    expect(isValidScope("workflows:nuke")).toBe(false)
    expect(isValidScope("")).toBe(false)
  })

  it("parseScopeString splits and validates", () => {
    expect(parseScopeString("workflows:read workflows:write"))
      .toEqual(["workflows:read", "workflows:write"])
  })

  it("parseScopeString throws on invalid scope", () => {
    expect(() => parseScopeString("workflows:read garbage")).toThrow()
  })

  it("parseScopeString deduplicates", () => {
    expect(parseScopeString("workflows:read workflows:read"))
      .toEqual(["workflows:read"])
  })

  it("formatScopeString joins with spaces", () => {
    expect(formatScopeString(["workflows:read", "jobs:read"]))
      .toBe("workflows:read jobs:read")
  })

  it("hasScope is true when scope present", () => {
    expect(hasScope(["workflows:read", "jobs:read"], "workflows:read")).toBe(true)
    expect(hasScope(["workflows:read"], "workflows:write")).toBe(false)
  })

  it("requireScope returns null when granted", () => {
    expect(requireScope(["workflows:read"], "workflows:read")).toBeNull()
  })

  it("requireScope returns error object when missing", () => {
    const err = requireScope(["workflows:read"], "workflows:write")
    expect(err).toEqual({
      statusCode: 403,
      body: { error: { code: "insufficient_scope", message: "Missing required scope: workflows:write", missingScope: "workflows:write" } },
    })
  })
})
