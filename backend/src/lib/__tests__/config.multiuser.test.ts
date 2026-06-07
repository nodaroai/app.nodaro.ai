import { describe, it, expect, afterEach } from "vitest"
import { config, isMultiUser, type Edition } from "../config.js"

// The edition helpers read `config.EDITION` at call time off the (mutable)
// singleton — so the most faithful way to exercise all three editions against
// the REAL implementation is to swap EDITION on the live config object, call
// the real helper, then restore. (vi.doMock can't reach the helper's captured
// `config` binding, so it would silently test nothing — see config.test.ts.)
const originalEdition = config.EDITION

afterEach(() => {
  config.EDITION = originalEdition
})

function withEdition(edition: Edition): boolean {
  config.EDITION = edition
  return isMultiUser()
}

describe("isMultiUser", () => {
  it("is false for community (single-user → sharing is inert)", () => {
    expect(withEdition("community")).toBe(false)
  })

  it("is true for business and cloud", () => {
    expect(withEdition("business")).toBe(true)
    expect(withEdition("cloud")).toBe(true)
  })
})
