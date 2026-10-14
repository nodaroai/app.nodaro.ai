/**
 * The translated Re-speak allowance lives on the server, once: a v4 slot that
 * speaks a translation is RESERVED for 1.5× its transcript's characters
 * (rounded up), in both pricing branches. The convert route's reservation
 * (`computeVoiceChangerProPricing`, through the toolkit) and the whole-convert
 * quote both price through `priceVoiceChangerProFromUnits`, which applies it.
 * Reserve-only: arguments without `respeakTranslated` — the metered commit's —
 * price the counts as given.
 */
import { describe, it, expect } from "vitest"
import {
  TRANSLATED_RESPEAK_RESERVE_FACTOR,
  priceVoiceChangerProFromUnits,
  respeakReservedChars,
} from "../voice-changer-pro-pricing.js"

const UNITS = { minute: 40, respeak: 30, v3: 4, v4: 6 }

describe("respeakReservedChars", () => {
  it("is the transcript × 1.5, rounded up, for a translated v4 slot", () => {
    expect(TRANSLATED_RESPEAK_RESERVE_FACTOR).toBe(1.5)
    expect(respeakReservedChars(1001, "v4", true)).toBe(1502)
    expect(respeakReservedChars(1, "v4", true)).toBe(2)
  })

  it("is the transcript as given otherwise — untranslated, or not v4 (only v4 speaks a translation)", () => {
    expect(respeakReservedChars(1001, "v4", false)).toBe(1001)
    expect(respeakReservedChars(1001, "v4", undefined)).toBe(1001)
    expect(respeakReservedChars(1001, "v3", true)).toBe(1001)
    expect(respeakReservedChars(1001, undefined, true)).toBe(1001)
  })

  it("leaves an unknown count unknown (one bucket, priced by the formula)", () => {
    expect(respeakReservedChars(null, "v4", true)).toBeNull()
    expect(respeakReservedChars(0, "v4", true)).toBe(0)
    expect(respeakReservedChars(undefined, "v4", true)).toBeUndefined()
  })
})

describe("priceVoiceChangerProFromUnits applies the allowance in both branches", () => {
  for (const lengthPricing of [false, true]) {
    it(`length pricing ${lengthPricing ? "on" : "off"}: a translated slot prices as its reserved characters`, () => {
      const translated = priceVoiceChangerProFromUnits(UNITS, lengthPricing, {
        stsSlotSeconds: [12],
        respeakChars: [900, 900, 900],
        respeakEngines: ["v4", "v4", "v3"],
        respeakTranslated: [true, false, true],
      })
      const asReserved = priceVoiceChangerProFromUnits(UNITS, lengthPricing, {
        stsSlotSeconds: [12],
        respeakChars: [1350, 900, 900],
        respeakEngines: ["v4", "v4", "v3"],
      })
      expect(translated).toEqual(asReserved)
      expect(translated.respeakCredits[0]).toBeGreaterThan(translated.respeakCredits[1])
    })
  }

  it("prices the counts as given without the flag — the metered commit's arguments", () => {
    const commit = priceVoiceChangerProFromUnits(UNITS, true, { stsSlotSeconds: [], respeakChars: [900], respeakEngines: ["v4"] })
    const reserve = priceVoiceChangerProFromUnits(UNITS, true, {
      stsSlotSeconds: [],
      respeakChars: [900],
      respeakEngines: ["v4"],
      respeakTranslated: [true],
    })
    expect(commit.respeakCredits[0]).toBeLessThan(reserve.respeakCredits[0])
  })
})
