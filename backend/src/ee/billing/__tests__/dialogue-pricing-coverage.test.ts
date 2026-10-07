/**
 * Every dialogue provider a caller can name has a price, under its own id, equal
 * in the catalog and the static table. The route's Zod enum is DIALOGUE_PROVIDERS;
 * a provider with no row answers 503 price_not_configured at run time.
 * (The twin of tts-pricing-coverage.test.ts, which walks only TTS_PROVIDERS.)
 */
import { describe, it, expect } from "vitest"
import { DIALOGUE_PROVIDERS, MODEL_CATALOG, speechUnitCreditId, SPEECH_UNIT_PRICE_NOTE } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"

describe("text-to-dialogue pricing coverage", () => {
  it("every dialogue provider has a static price", () => {
    const missing = DIALOGUE_PROVIDERS.filter((id) => STATIC_CREDIT_COSTS[id] === undefined)
    expect(missing).toEqual([])
  })

  it("each is priced in the catalog under its own id, at the static price, flat (no per-length note)", () => {
    for (const id of DIALOGUE_PROVIDERS) {
      const row = MODEL_CATALOG[id]!.pricing[0]
      expect(row?.identifier, id).toBe(id)
      expect(row?.credits, id).toBe(STATIC_CREDIT_COSTS[id])
      expect(row?.note, `${id} is charged flat per request`).toBeUndefined()
    }
  })

  it("each dialogue model carries its unit row as pricing[1], at the static value, with the one unit note", () => {
    for (const id of DIALOGUE_PROVIDERS) {
      const rows = MODEL_CATALOG[id]!.pricing
      expect(rows[1]?.identifier, id).toBe(speechUnitCreditId(id))
      expect(rows[1]?.credits, id).toBe(STATIC_CREDIT_COSTS[speechUnitCreditId(id)])
      expect(rows[1]?.note, id).toBe(SPEECH_UNIT_PRICE_NOTE)
      expect(rows, id).toHaveLength(2)
    }
  })

  it("the node-type fallback equals the default dialogue model's flat row", () => {
    // Reached only when the dialogue model's own row is unpriced, and as the
    // editor's cold-cache figure (frontend-credit-fallback-parity pins the copy).
    expect(STATIC_CREDIT_COSTS["text-to-dialogue"]).toBe(STATIC_CREDIT_COSTS["elevenlabs-dialogue"])
  })

  it("v4 dialogue costs the same flat 25 credits as v3 dialogue", () => {
    expect(STATIC_CREDIT_COSTS["elevenlabs-dialogue-v4"]).toBe(25)
    expect(STATIC_CREDIT_COSTS["elevenlabs-dialogue-v4"]).toBe(STATIC_CREDIT_COSTS["elevenlabs-dialogue"])
  })
})
