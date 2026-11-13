import { describe, it, expect } from "vitest"
import {
  SPEECH_PRICE_UNIT_CHARS,
  SPEECH_FLOOR_UNITS,
  SPEECH_UNIT_CREDIT_SUFFIX,
  SPEECH_PER_1K_CREDIT_SUFFIX,
  speechUnitCreditId,
  speechPriceUnits,
  speechCredits,
  speechCreditsFor,
  speechRowCredits,
  speechRowUnits,
  speechQuoteCreditId,
  parseSpeechQuoteCreditId,
  isSpeechLengthPriceId,
  speechLengthPriceModel,
} from "../credit-estimators/speech.js"
import { getTtsCapabilities } from "../tts-capabilities.js"
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
      expect(speechUnitCreditId(id)).toBe(getTtsCapabilities(id).ratePer1kChars ? `${id}:per-1k-chars` : `${id}:per-100-chars`)
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

describe("speech pricing — a rate quoted per 1,000 characters (decided 2026-11-12)", () => {
  it("names the per-1K row for a model whose sheet says so; the count stays started hundreds", () => {
    expect(SPEECH_PER_1K_CREDIT_SUFFIX).toBe(":per-1k-chars")
    expect(speechUnitCreditId("gemini-3-8-flash-lite-tts")).toBe("gemini-3-8-flash-lite-tts:per-1k-chars")
    expect(speechRowUnits("gemini-2-5-pro-tts")).toBe(10)
    expect(speechRowUnits("elevenlabs-v4")).toBe(1)
    expect(speechRowUnits("elevenlabs")).toBe(1)
    expect(speechRowUnits("not-a-model")).toBe(1)
  })

  // The worked examples in docs/nodes/ai-audio/text-to-speech.md (Gemini rows) are these — change both together.
  it.each([
    // [model, chars, row, base credits]
    ["gemini-3-8-flash-lite-tts", 100, 4, 4], // 8 units × 4 ÷ 10 = 3.2 → 4
    ["gemini-3-8-flash-lite-tts", 1000, 4, 4],
    ["gemini-3-8-flash-tts", 800, 6, 5], // 4.8 → 5
    ["gemini-3-8-flash-tts", 2050, 6, 13], // 21 × 6 ÷ 10 = 12.6 → 13
    ["gemini-3-1-flash-tts", 1000, 13, 13],
    ["gemini-3-1-flash-tts", 100, 13, 11], // 10.4 → 11
    ["gemini-2-5-pro-tts", 10000, 16, 160],
    ["gemini-2-5-pro-tts", 2050, 16, 34], // 33.6 → 34
  ] as const)("%s, %i characters at %i per 1,000 → %i base credits", (model, chars, row, base) => {
    expect(speechCreditsFor(model, chars, row)).toBe(base)
  })

  it("on a per-100 row it is exactly speechCredits", () => {
    for (const chars of [0, 100, 801, 5000]) expect(speechCreditsFor("elevenlabs-v4", chars, 4)).toBe(speechCredits(chars, 4))
    expect(speechRowCredits(9, 4)).toBe(36)
    expect(speechRowCredits(9, 4, 10)).toBe(4)
  })

  it("the request quote keeps one id shape for every model, and reads back with its row and how many hundreds the row prices", () => {
    expect(speechQuoteCreditId("gemini-3-1-flash-tts", 21)).toBe("gemini-3-1-flash-tts:per-100-chars:21u")
    expect(parseSpeechQuoteCreditId("gemini-3-1-flash-tts:per-100-chars:21u")).toEqual({
      model: "gemini-3-1-flash-tts",
      unitId: "gemini-3-1-flash-tts:per-1k-chars",
      units: 21,
      rowUnits: 10,
    })
    expect(parseSpeechQuoteCreditId("elevenlabs-v4:per-100-chars:9u")).toMatchObject({ unitId: "elevenlabs-v4:per-100-chars", rowUnits: 1 })
    // Its cap in started hundreds bounds N, as for every model.
    expect(parseSpeechQuoteCreditId("gemini-3-1-flash-tts:per-100-chars:101u")).toBeUndefined()
  })

  it("a per-1K row is a length price, priced for its model", () => {
    expect(isSpeechLengthPriceId("gemini-2-5-pro-tts:per-1k-chars")).toBe(true)
    expect(speechLengthPriceModel("gemini-2-5-pro-tts:per-1k-chars")).toBe("gemini-2-5-pro-tts")
    expect(isSpeechLengthPriceId("gemini-2-5-pro-tts:per-1k-chars:3u")).toBe(false)
    expect(isSpeechLengthPriceId("gemini-2-5-pro-tts")).toBe(false)
  })
})
