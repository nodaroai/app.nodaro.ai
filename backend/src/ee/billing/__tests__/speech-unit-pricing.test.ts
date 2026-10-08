/**
 * Every speech model has a per-100-characters price row, statically and in a
 * migration, derived from the rate table — so a new speech model cannot ship
 * priced flat only, and a rate edit cannot be forgotten in the rows.
 *
 * Not added to credit-pricing-migration-sync's VALUE_SYNCED_FAMILIES on
 * purpose: `familyOf` is prefix-matched (`elevenlabs-v3` would also claim the
 * bare 30-credit row) and shifts VALUE_SYNCED_ROW_COUNT. The value check for
 * these rows is here instead, reading the migration directly.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG, TTS_PROVIDERS, TTS_PROVIDER_ALIASES, SPEECH_PRICE_UNIT_CHARS, speechUnitCreditId, usdToCredits,
} from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"
import { ELEVENLABS_SPEECH_USD_PER_1K_CHARS, elevenlabsSpeechCostUsd } from "../../../lib/pricing/elevenlabs-speech-cost.js"
import { effectiveMarkupPercent, applyMarkupPercent } from "../service-margin.js"

/**
 * Every speech model, FROM THE CATALOG (not a hand list): the text-to-speech
 * models and every dialogue model. A new dialogue model (the v4 dialogue work
 * in flight) fails here until it has a unit row and a rate.
 */
const SPEECH_MODELS = Object.values(MODEL_CATALOG)
  .filter((m) => (m.modes as readonly string[]).includes("tts") || (m.modes as readonly string[]).includes("dialogue"))
  .map((m) => m.id)
const DIALOGUE_ID = "elevenlabs-dialogue"
const DIALOGUE_V4_ID = "elevenlabs-dialogue-v4"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase/migrations")

/** `model_identifier → credit_cost` for every `:per-100-chars` row any migration seeds (last wins). */
function seededUnitRows(): Map<string, number> {
  const out = new Map<string, number>()
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
    for (const m of sql.matchAll(/\(\s*'([^']+:per-100-chars)'\s*,\s*(\d+)/g)) out.set(m[1]!, Number(m[2]))
  }
  return out
}

describe("speech unit rows — coverage", () => {
  it("the catalog walk finds the seven speech models of today (the sanity floor) and every non-alias TTS provider", () => {
    expect(SPEECH_MODELS.length).toBeGreaterThanOrEqual(7)
    for (const id of TTS_PROVIDERS) if (!(id in TTS_PROVIDER_ALIASES)) expect(SPEECH_MODELS).toContain(id)
    expect(SPEECH_MODELS).toContain(DIALOGUE_ID)
    expect(SPEECH_MODELS).toContain(DIALOGUE_V4_ID)
  })

  it("every speech model (text-to-speech and dialogue) has a static :per-100-chars row", () => {
    const missing = SPEECH_MODELS.filter((id) => STATIC_CREDIT_COSTS[speechUnitCreditId(id)] === undefined)
    expect(missing, `speech models with no :per-100-chars row in STATIC_CREDIT_COSTS: ${missing.join(", ")}`).toEqual([])
  })

  it("every static :per-100-chars row is seeded by a migration with the same value, and no extra one is seeded", () => {
    const seeded = seededUnitRows()
    const staticUnitKeys = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k.endsWith(":per-100-chars")).sort()
    expect(staticUnitKeys).toEqual([...seeded.keys()].sort())
    for (const key of staticUnitKeys) expect(seeded.get(key), key).toBe(STATIC_CREDIT_COSTS[key])
  })

  it("a legacy alias has no unit row of its own — it prices on the model it runs as", () => {
    for (const alias of Object.keys(TTS_PROVIDER_ALIASES)) {
      expect(STATIC_CREDIT_COSTS[`${alias}:per-100-chars`]).toBeUndefined()
      expect(STATIC_CREDIT_COSTS[speechUnitCreditId(alias)]).toBeDefined()
    }
  })
})

describe("speech unit rows — re-derived from the rate table, never scaled", () => {
  it("each unit row equals usdToCredits(rate × 100 / 1000) at the model's listed rate", () => {
    for (const id of SPEECH_MODELS) {
      const rate = ELEVENLABS_SPEECH_USD_PER_1K_CHARS[id]
      expect(rate, `${id} has no rate`).toBeDefined()
      expect(STATIC_CREDIT_COSTS[speechUnitCreditId(id)], id).toBe(usdToCredits((rate! * SPEECH_PRICE_UNIT_CHARS) / 1000))
    }
  })

  it("the rate table names exactly the speech models", () => {
    expect(Object.keys(ELEVENLABS_SPEECH_USD_PER_1K_CHARS).sort()).toEqual([...SPEECH_MODELS].sort())
  })

  it("the recorded provider cost is characters × the rate", () => {
    expect(elevenlabsSpeechCostUsd("elevenlabs-v3", 1000)).toBeCloseTo(ELEVENLABS_SPEECH_USD_PER_1K_CHARS["elevenlabs-v3"]!, 10)
    expect(elevenlabsSpeechCostUsd("elevenlabs", 1000)).toBeCloseTo(ELEVENLABS_SPEECH_USD_PER_1K_CHARS["elevenlabs-turbo"]!, 10)
    expect(elevenlabsSpeechCostUsd("elevenlabs-v4", 0)).toBe(0)
    expect(elevenlabsSpeechCostUsd("not-a-model", 1000)).toBeCloseTo(ELEVENLABS_SPEECH_USD_PER_1K_CHARS["elevenlabs-turbo"]!, 10) // runs as the fallback model
  })

  it("the values decided 2026-10-06: 4 / 4 / 4 / 2 / 4, v4 dialogue at parity with v3 dialogue, and v4 Turbo at parity with Turbo v2.5", () => {
    expect(STATIC_CREDIT_COSTS["elevenlabs-v3:per-100-chars"]).toBe(4)
    expect(STATIC_CREDIT_COSTS["elevenlabs-v4:per-100-chars"]).toBe(4)
    expect(STATIC_CREDIT_COSTS["elevenlabs-multilingual:per-100-chars"]).toBe(4)
    expect(STATIC_CREDIT_COSTS["elevenlabs-turbo:per-100-chars"]).toBe(2)
    expect(STATIC_CREDIT_COSTS["elevenlabs-dialogue:per-100-chars"]).toBe(4)
    expect(STATIC_CREDIT_COSTS["elevenlabs-dialogue-v4:per-100-chars"]).toBe(4)
    expect(STATIC_CREDIT_COSTS["elevenlabs-dialogue-v4:per-100-chars"]).toBe(STATIC_CREDIT_COSTS["elevenlabs-dialogue:per-100-chars"])
    expect(STATIC_CREDIT_COSTS["elevenlabs-v4-turbo:per-100-chars"]).toBe(2)
    expect(STATIC_CREDIT_COSTS["elevenlabs-v4-turbo:per-100-chars"]).toBe(STATIC_CREDIT_COSTS["elevenlabs-turbo:per-100-chars"])
  })
})

describe("speech unit rows — a margin on v4 is v4's alone", () => {
  it("service_margin_percent['elevenlabs-v4'] prices elevenlabs-v4 and its unit row, not elevenlabs-v4-turbo or its unit row", () => {
    // `serviceMarginPrefixMatches` matches on a `:` boundary only — the one place a
    // `-turbo` suffix could silently inherit a neighbour's price.
    const settings = { cost_markup_percent: 10, service_margin_percent: { "elevenlabs-v4": 37 } }
    expect(effectiveMarkupPercent(settings as never, "elevenlabs-v4")).toBe(37)
    expect(effectiveMarkupPercent(settings as never, speechUnitCreditId("elevenlabs-v4"))).toBe(37)
    expect(effectiveMarkupPercent(settings as never, "elevenlabs-v4-turbo")).toBe(10)
    expect(effectiveMarkupPercent(settings as never, speechUnitCreditId("elevenlabs-v4-turbo"))).toBe(10)
  })
})

describe("speech unit rows — markup follows the model id", () => {
  it("a per-service margin on the model id covers its unit id (prefix on a `:` boundary)", () => {
    const settings = { cost_markup_percent: 10, service_margin_percent: { "elevenlabs-v4": 37 } }
    for (const id of SPEECH_MODELS) {
      expect(effectiveMarkupPercent(settings as never, speechUnitCreditId(id)), id).toBe(effectiveMarkupPercent(settings as never, id))
    }
  })

  it("a client that knows only charged prices never under-quotes: units × charged unit ≥ the server's charge", () => {
    for (const percent of [0, 10, 37]) {
      for (const unit of [2, 4, 5]) {
        for (const chars of [1, 99, 100, 101, 800, 801, 1234, 5000, 10000, 39999, 40000]) {
          const units = Math.max(8, Math.ceil(chars / 100))
          const server = applyMarkupPercent(units * unit, percent)
          const client = units * applyMarkupPercent(unit, percent)
          expect(client, `${chars} chars, unit ${unit}, ${percent}%`).toBeGreaterThanOrEqual(server)
          expect(client - server).toBeLessThanOrEqual(units)
        }
      }
    }
  })
})
