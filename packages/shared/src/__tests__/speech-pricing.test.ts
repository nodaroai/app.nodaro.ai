import { describe, it, expect } from "vitest"
import {
  SPEECH_PRICE_UNIT_CHARS,
  SPEECH_FLOOR_UNITS,
  SPEECH_UNIT_CREDIT_SUFFIX,
  speechUnitCreditId,
  speechPriceUnits,
  speechCredits,
} from "../credit-estimators/speech.js"
import { TTS_PROVIDERS, TTS_PROVIDER_ALIASES, canonicalTtsProvider } from "../index.js"

describe("speech pricing — the unit", () => {
  it("prices per started 100 characters with a minimum of 8 units (decided 2026-10-06)", () => {
    expect(SPEECH_PRICE_UNIT_CHARS).toBe(100)
    expect(SPEECH_FLOOR_UNITS).toBe(8)
  })

  it.each([
    [0, 8], [1, 8], [100, 8], [800, 8],
    [801, 9], [1000, 10], [1001, 11], [2500, 25], [5000, 50], [10000, 100], [40000, 400],
  ])("%i characters → %i units", (chars, units) => {
    expect(speechPriceUnits(chars)).toBe(units)
  })

  it("a count that is not a usable number is the floor, never NaN or a throw", () => {
    for (const bad of [Number.NaN, -5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0]) {
      expect(speechPriceUnits(bad), String(bad)).toBe(SPEECH_FLOOR_UNITS)
    }
  })

  // The worked examples in docs/nodes/ai-audio/text-to-speech.md and
  // text-to-dialogue.md are these rows — change both together.
  it.each([
    // [chars, perUnit, credits]
    [100, 4, 32], [800, 4, 32], [801, 4, 36], [1000, 4, 40], [2500, 4, 100], [5000, 4, 200], [10000, 4, 400],
    [100, 2, 16], [1000, 2, 20], [5000, 2, 100], [40000, 2, 800],
  ])("%i characters at %i per unit → %i credits", (chars, perUnit, credits) => {
    expect(speechCredits(chars, perUnit)).toBe(credits)
  })

  it("an admin retune moves the floor with it: units × the row, not a second row", () => {
    expect(speechCredits(100, 5)).toBe(40)
    expect(speechCredits(1000, 5)).toBe(50)
    expect(speechCredits(100, 0)).toBe(0) // a free row prices nothing (community has no rows at all)
  })
})

describe("speech pricing — the unit row id", () => {
  it("is the model id plus the suffix, for every text-to-speech model and for dialogue", () => {
    expect(SPEECH_UNIT_CREDIT_SUFFIX).toBe(":per-100-chars")
    for (const id of TTS_PROVIDERS) {
      if (id in TTS_PROVIDER_ALIASES) continue
      expect(speechUnitCreditId(id)).toBe(`${id}:per-100-chars`)
    }
    expect(speechUnitCreditId("elevenlabs-dialogue")).toBe("elevenlabs-dialogue:per-100-chars")
  })

  it("a legacy alias prices on the row of the model it runs as", () => {
    for (const [alias, target] of Object.entries(TTS_PROVIDER_ALIASES)) {
      expect(speechUnitCreditId(alias)).toBe(speechUnitCreditId(canonicalTtsProvider(target)))
    }
    expect(speechUnitCreditId("elevenlabs")).toBe("elevenlabs-turbo:per-100-chars")
  })

  it("the suffix sits on a `:` boundary, so a per-service margin on the model id covers its unit id", () => {
    const id = speechUnitCreditId("elevenlabs-v4")
    expect(id.startsWith("elevenlabs-v4:")).toBe(true)
  })
})
