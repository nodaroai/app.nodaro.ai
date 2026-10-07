import { describe, it, expect, vi } from "vitest"

// The translate floor is read through the credit layer (a model_pricing row
// wins over the static seed). Mock that one read so the test pins the formula
// AND the "row wins" rule without a database: the row says 3, the seed says 2.
const { mockGetModelCreditBaseCost } = vi.hoisted(() => ({
  mockGetModelCreditBaseCost: vi.fn(async (id: string) => {
    if (id === "voice-changer-pro-translate") return { creditCost: 3 }
    throw new Error(`unexpected identifier ${id}`)
  }),
}))
vi.mock("../credits.js", () => ({ getModelCreditBaseCost: mockGetModelCreditBaseCost }))

import {
  VOICE_CHANGER_PRO_TRANSLATE_MODEL,
  TRANSLATE_CEILING_PER_1K,
  TRANSLATE_CHARS_PER_UNIT,
  translateReserveBase,
  priceTranslate,
  computeVoiceChangerProTranslatePricing,
} from "../voice-changer-pro-credits.js"

describe("translate pricing (host) — the reservation ceiling", () => {
  it("is per started 1K source characters by tier, never below the floor", () => {
    expect(TRANSLATE_CHARS_PER_UNIT).toBe(1000)
    expect(translateReserveBase(2, 5, 0)).toBe(2)
    expect(translateReserveBase(2, 5, 1)).toBe(5)
    expect(translateReserveBase(2, 5, 1_000)).toBe(5)
    expect(translateReserveBase(2, 5, 1_001)).toBe(10)
    expect(translateReserveBase(2, 50, 8_700)).toBe(450)
  })

  it("a hostile character count (NaN, negative, Infinity) reserves the floor, never throws", () => {
    expect(translateReserveBase(2, 5, Number.NaN)).toBe(2)
    expect(translateReserveBase(2, 5, -40)).toBe(2)
    expect(translateReserveBase(2, 5, Number.POSITIVE_INFINITY)).toBe(2)
  })

  it("a floor tuned above one bucket's ceiling wins (the row is admin-tunable)", () => {
    expect(translateReserveBase(8, 5, 400)).toBe(8)
  })

  it("the tiers escalate at the decided ceilings (5 / 10 / 50)", () => {
    expect(TRANSLATE_CEILING_PER_1K).toEqual({ economy: 5, standard: 10, premium: 50 })
    expect(TRANSLATE_CEILING_PER_1K.economy).toBeLessThan(TRANSLATE_CEILING_PER_1K.standard)
    expect(TRANSLATE_CEILING_PER_1K.standard).toBeLessThan(TRANSLATE_CEILING_PER_1K.premium)
  })

  it("priceTranslate echoes the floor, the tier's ceiling and the reservation", () => {
    expect(priceTranslate(2, "premium", 8_700)).toEqual({ floor: 2, ceilingPer1K: 50, reserveBase: 450 })
    expect(priceTranslate(2, "economy", 1_500)).toEqual({ floor: 2, ceilingPer1K: 5, reserveBase: 10 })
    expect(priceTranslate(2, "standard", 0)).toEqual({ floor: 2, ceilingPer1K: 10, reserveBase: 2 })
  })
})

describe("computeVoiceChangerProTranslatePricing — reads the floor through the credit layer", () => {
  it("names the born-private identifier", () => {
    expect(VOICE_CHANGER_PRO_TRANSLATE_MODEL).toBe("voice-changer-pro-translate")
  })

  it("the model_pricing row wins over the static seed", async () => {
    await expect(computeVoiceChangerProTranslatePricing({ sourceChars: 100, tier: "economy" }))
      .resolves.toEqual({ floor: 3, ceilingPer1K: 5, reserveBase: 5 })
    await expect(computeVoiceChangerProTranslatePricing({ sourceChars: 0, tier: "economy" }))
      .resolves.toEqual({ floor: 3, ceilingPer1K: 5, reserveBase: 3 })
    await expect(computeVoiceChangerProTranslatePricing({ sourceChars: 1_500, tier: "premium" }))
      .resolves.toEqual({ floor: 3, ceilingPer1K: 50, reserveBase: 100 })
    expect(mockGetModelCreditBaseCost).toHaveBeenCalledWith("voice-changer-pro-translate")
  })

  it("a refused identifier propagates (no silent free path)", async () => {
    mockGetModelCreditBaseCost.mockRejectedValueOnce(new Error("price_not_configured"))
    await expect(computeVoiceChangerProTranslatePricing({ sourceChars: 10, tier: "economy" }))
      .rejects.toThrow("price_not_configured")
  })
})
