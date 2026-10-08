/**
 * Every text-to-speech provider a caller can name has a price.
 *
 * The route's Zod enum is `TTS_PROVIDERS`; the price a run is charged comes
 * from `model_pricing` (admin-editable) with `STATIC_CREDIT_COSTS` as the code
 * fallback, and a provider with neither answers 503 `price_not_configured` at
 * run time. No other guard walks `TTS_PROVIDERS`: `list-models.test.ts` checks
 * catalog rows against the price table, and `credit-pricing-migration-sync`
 * checks price-table rows against migrations — a provider id that is in the enum
 * but in neither would pass both and fail only for a user.
 */
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, TTS_PROVIDERS, TTS_PROVIDER_ALIASES, canonicalTtsProvider, speechUnitCreditId, SPEECH_UNIT_PRICE_NOTE } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"

describe("text-to-speech pricing coverage", () => {
  it("every TTS provider has a static price", () => {
    const missing = TTS_PROVIDERS.filter((id) => STATIC_CREDIT_COSTS[id] === undefined)
    expect(missing, `TTS_PROVIDERS members with no STATIC_CREDIT_COSTS row: ${missing.join(", ")}`).toEqual([])
  })

  it("every non-alias TTS provider is priced in the catalog under its own id, at the static price", () => {
    for (const id of TTS_PROVIDERS) {
      if (id in TTS_PROVIDER_ALIASES) continue
      const row = MODEL_CATALOG[id]?.pricing[0]
      expect(row?.identifier, `${id} catalog pricing identifier`).toBe(id)
      expect(row?.credits, `${id} catalog credits vs STATIC_CREDIT_COSTS`).toBe(STATIC_CREDIT_COSTS[id])
    }
  })

  it("every non-alias TTS provider carries its unit row as pricing[1], at the static value, and no flat row says 'per 1K chars'", () => {
    // The unit row is what GET /v1/models and list_models serve (only while
    // length pricing is on — speech-unit-rows-served.test.ts); a client that
    // sees it quotes speechCredits(chars, row). The flat rows carried a
    // "per 1K chars" note that described a scaling that never existed.
    for (const id of TTS_PROVIDERS) {
      if (id in TTS_PROVIDER_ALIASES) continue
      const rows = MODEL_CATALOG[id]!.pricing
      expect(rows[0]?.note ?? "", id).not.toMatch(/per 1K/i)
      expect(rows[1]?.identifier, id).toBe(speechUnitCreditId(id))
      expect(rows[1]?.credits, id).toBe(STATIC_CREDIT_COSTS[speechUnitCreditId(id)])
      expect(rows[1]?.note, id).toBe(SPEECH_UNIT_PRICE_NOTE)
      expect(rows, id).toHaveLength(2)
    }
  })

  it("a legacy alias is priced as the model it runs as", () => {
    for (const [alias, target] of Object.entries(TTS_PROVIDER_ALIASES)) {
      expect(STATIC_CREDIT_COSTS[alias], alias).toBe(STATIC_CREDIT_COSTS[canonicalTtsProvider(target)])
    }
  })

  it("v4 is priced at parity with v3 — the flat row and the per-100-characters row alike", () => {
    expect(STATIC_CREDIT_COSTS["elevenlabs-v4"]).toBe(STATIC_CREDIT_COSTS["elevenlabs-v3"])
    expect(STATIC_CREDIT_COSTS["elevenlabs-v4:per-100-chars"]).toBe(STATIC_CREDIT_COSTS["elevenlabs-v3:per-100-chars"])
  })

  it("v4 Turbo is priced at parity with Turbo v2.5 — the flat row and the per-100-characters row alike (decided 2026-10-06)", () => {
    expect(STATIC_CREDIT_COSTS["elevenlabs-v4-turbo"]).toBe(STATIC_CREDIT_COSTS["elevenlabs-turbo"])
    expect(STATIC_CREDIT_COSTS["elevenlabs-v4-turbo:per-100-chars"]).toBe(STATIC_CREDIT_COSTS["elevenlabs-turbo:per-100-chars"])
    expect(STATIC_CREDIT_COSTS["elevenlabs-v4-turbo"]).toBe(15)
  })
})
