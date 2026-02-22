import { describe, it, expect } from "vitest"
import { APP_VERSION } from "../version"

describe("APP_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof APP_VERSION).toBe("string")
    expect(APP_VERSION.length).toBeGreaterThan(0)
  })

  it("matches semver pattern", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
