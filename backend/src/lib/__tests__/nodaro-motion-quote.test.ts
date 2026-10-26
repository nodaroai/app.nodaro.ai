import { describe, expect, it } from "vitest"
import { neutralBreakdown, privacyCreditsOf, privacyOutcomeOf } from "../nodaro-motion-quote.js"

/**
 * The quote's neutral key names: read the new key first,
 * fall back to the old (an engine before 0.395.0), answer the new only.
 */
describe("neutralBreakdown", () => {
  it("renames an older engine's keys (0.393.0: old keys only)", () => {
    expect(neutralBreakdown({ castSwap: 5, seedance: 32, seedanceExpected: 23, references: 3, masking: 2 })).toEqual({
      references: 3, base: 5, motion: 32, motionExpected: 23, privacy: 2,
    })
    expect(neutralBreakdown({ castSwap: 40, kling: 380, references: 0 })).toEqual({ references: 0, base: 40, motion: 380 })
    expect(neutralBreakdown({ castSwap: 5, seedanceHd: 0 })).toEqual({ base: 5, motionHd: 0 })
  })

  it("prefers the new key where both are sent (0.394.0), and drops the old", () => {
    expect(neutralBreakdown({ castSwap: 5, seedance: 99, motion: 32, masking: 9, privacy: 2, seedanceHd: 7, motionHd: 0 })).toEqual({
      base: 5, motion: 32, privacy: 2, motionHd: 0,
    })
  })

  it("keeps the new keys as they are (0.395.0), any other part, and only finite numbers", () => {
    expect(neutralBreakdown({ base: 5, motion: 7, extra: 1, bad: "x", nan: Number.NaN })).toEqual({ base: 5, motion: 7, extra: 1 })
    expect(neutralBreakdown(undefined)).toEqual({})
    expect(neutralBreakdown([1])).toEqual({})
    expect(neutralBreakdown({ seedance: "7" })).toEqual({})
  })
})

/** The base fee: `castSwap` until Cast Swap 0.396.0, both on 0.396.0, `base` only from 0.397.0. */
describe("neutralBreakdown — the base fee", () => {
  it("reads an older engine's castSwap as base (old key only)", () => {
    expect(neutralBreakdown({ castSwap: 5, motion: 7 })).toEqual({ motion: 7, base: 5 })
  })

  it("keeps base as it is (new key only, 0.397.0)", () => {
    expect(neutralBreakdown({ base: 5, motion: 7 })).toEqual({ base: 5, motion: 7 })
  })

  it("prefers base where both are sent (0.396.0), and drops castSwap", () => {
    expect(neutralBreakdown({ castSwap: 99, base: 5, motion: 7 })).toEqual({ base: 5, motion: 7 })
    expect(neutralBreakdown({ castSwap: 5, base: "x" })).toEqual({ base: 5 })
  })

  it("never answers castSwap", () => {
    for (const b of [{ castSwap: 5 }, { base: 5 }, { castSwap: 5, base: 6 }, { castSwap: "5" }]) {
      expect(Object.keys(neutralBreakdown(b))).not.toContain("castSwap")
    }
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
