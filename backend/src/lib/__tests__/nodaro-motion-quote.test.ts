import { describe, expect, it } from "vitest"
import { neutralBreakdown, privacyCreditsOf, privacyOutcomeOf } from "../nodaro-motion-quote.js"

/**
 * The quote's neutral key names: read the new key first,
 * fall back to the old (an engine before 0.395.0), answer the new only.
 */
describe("neutralBreakdown", () => {
  it("renames an older engine's keys (0.393.0: old keys only)", () => {
    expect(neutralBreakdown({ castSwap: 5, seedance: 32, seedanceExpected: 23, references: 3, masking: 2 })).toEqual({
      castSwap: 5, references: 3, motion: 32, motionExpected: 23, privacy: 2,
    })
    expect(neutralBreakdown({ castSwap: 40, kling: 380, references: 0 })).toEqual({ castSwap: 40, references: 0, motion: 380 })
    expect(neutralBreakdown({ castSwap: 5, seedanceHd: 0 })).toEqual({ castSwap: 5, motionHd: 0 })
  })

  it("prefers the new key where both are sent (0.394.0), and drops the old", () => {
    expect(neutralBreakdown({ castSwap: 5, seedance: 99, motion: 32, masking: 9, privacy: 2, seedanceHd: 7, motionHd: 0 })).toEqual({
      castSwap: 5, motion: 32, privacy: 2, motionHd: 0,
    })
  })

  it("keeps the new keys as they are (0.395.0), any other part, and only finite numbers", () => {
    expect(neutralBreakdown({ castSwap: 5, motion: 7, extra: 1, bad: "x", nan: Number.NaN })).toEqual({ castSwap: 5, motion: 7, extra: 1 })
    expect(neutralBreakdown(undefined)).toEqual({})
    expect(neutralBreakdown([1])).toEqual({})
    expect(neutralBreakdown({ seedance: "7" })).toEqual({})
  })
})

describe("privacyCreditsOf / privacyOutcomeOf", () => {
  it("reads privacyCredits, else maskingCredits", () => {
    expect(privacyCreditsOf({ privacyCredits: 4, maskingCredits: 9 })).toBe(4)
    expect(privacyCreditsOf({ maskingCredits: 9 })).toBe(9)
    expect(privacyCreditsOf({ privacyCredits: "4" })).toBeUndefined()
    expect(privacyCreditsOf(null)).toBeUndefined()
  })

  it("reads the completion's privacy, else faceMasking", () => {
    expect(privacyOutcomeOf({ privacy: { applied: true }, faceMasking: { applied: false } })).toEqual({ applied: true })
    expect(privacyOutcomeOf({ faceMasking: { applied: true, reason: "always" } })).toEqual({ applied: true, reason: "always" })
    expect(privacyOutcomeOf({})).toBeUndefined()
    expect(privacyOutcomeOf("x")).toBeUndefined()
  })
})
