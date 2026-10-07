/**
 * Voice Changer Pro Re-speak on the speech unit rows (D-VCP, decided
 * 2026-10-06): while SPEECH_LENGTH_PRICING_ENABLED is on, a Re-speak speaker
 * costs exactly what the same text costs on the Text to Speech node for the
 * same model — `speechCredits(chars, row)` on the engine's own
 * per-100-characters row (v3 → `elevenlabs-v3`, v4 → `elevenlabs-v4`), with
 * the speech floor (8 units) as the per-slot minimum. Flag off: today's
 * per-started-1K price on the `voice-changer-pro-respeak` row with the
 * speech-to-speech-derived floor, byte for byte.
 *
 * The speech-to-speech slots, the reservation floor and the
 * ceiling-then-settle mechanics (the plugin reserves on the transcript and
 * commits the measured count under that ceiling) are untouched either way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const flag = vi.hoisted(() => ({ on: false }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true, speechLengthPricingEnabled: () => flag.on }
})

// No model_pricing rows → every identifier resolves through STATIC_CREDIT_COSTS.
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
        }),
      }),
    }),
  },
}))

import { getMaxTtsChars, speechCredits } from "@nodaro/shared"
import { speechBaseCredits, speechUnitBaseCredits } from "../../../lib/speech-credits.js"
import { SPEECH_PARITY_CASES } from "../../../lib/__tests__/speech-parity-cases.js"
import {
  computeVoiceChangerProPricing,
  priceVoiceChangerPro,
  priceVoiceChangerProByLength,
  respeakEngineModel,
  voiceChangerProFloor,
  VOICE_CHANGER_PRO_RESPEAK_CHARS_PER_UNIT,
  VOICE_CHANGER_PRO_RESPEAK_MODEL,
} from "../voice-changer-pro-credits.js"
import { STATIC_CREDIT_COSTS, invalidateModelPricingCache } from "../credits.js"

const UNIT = 40   // voice-changer-pro: credits per minute of stem audio (static seed)
const PER_1K = 30 // voice-changer-pro-respeak: credits per started 1K re-spoken chars (static seed)
const V3_UNIT = 4 // elevenlabs-v3's per-100-characters row (static seed)
const V4_UNIT = 4 // elevenlabs-v4's per-100-characters row (static seed)

beforeEach(() => {
  flag.on = false
  invalidateModelPricingCache()
})

/** The (engine, chars) pairs both branches are pinned on. */
const RESPEAK_CASES = [
  ["v3", 1], ["v3", 340], ["v3", 700], ["v3", 1000], ["v3", 1001], ["v3", 5000],
  ["v4", 1], ["v4", 340], ["v4", 1000], ["v4", 1001], ["v4", 5000], ["v4", 10000],
] as const

describe("flag OFF — characterization: today's per-started-1K price, byte for byte", () => {
  it("the flat Re-speak row is the plugin's seed", () => {
    expect(STATIC_CREDIT_COSTS[VOICE_CHANGER_PRO_RESPEAK_MODEL]).toBe(PER_1K)
  })

  it.each(RESPEAK_CASES)("engine %s, %i chars: equals the pure per-1K formula whether or not the engine is sent", async (engine, chars) => {
    const expected = priceVoiceChangerPro(UNIT, PER_1K, { stsSlotSeconds: [26.76], respeakChars: [chars] })
    expect(await computeVoiceChangerProPricing({ stsSlotSeconds: [26.76], respeakChars: [chars] })).toEqual(expected)
    expect(await computeVoiceChangerProPricing({ stsSlotSeconds: [26.76], respeakChars: [chars], respeakEngines: [engine] })).toEqual(expected)
  })

  it("the existing table: 340 → 30, 1000 → 30, 1001 → 60, 18280 → 570; unknown → one 1K bucket (30)", async () => {
    const p = await computeVoiceChangerProPricing({ stsSlotSeconds: [], respeakChars: [340, 1000, 1001, 18280, null, 0], respeakEngines: ["v4", "v4", "v3", undefined] })
    expect(p.respeakCredits).toEqual([30, 30, 60, 570, 30, 30])
    expect(p.respeakPer1K).toBe(PER_1K)
    expect(p.floor).toBe(voiceChangerProFloor(UNIT))
    expect(p.reserveBase).toBe(30 + 30 + 60 + 570 + 30 + 30)
  })

  it("a keep-only recast still reserves the speech-to-speech floor", async () => {
    expect((await computeVoiceChangerProPricing({ stsSlotSeconds: [], respeakChars: [] })).reserveBase).toBe(4)
  })
})

describe("flag ON — a Re-speak speaker costs what the Text to Speech node charges for the same text on the same model", () => {
  beforeEach(() => { flag.on = true })

  it.each(RESPEAK_CASES)("engine %s, %i chars: per-slot base equals speechBaseCredits on the engine's model", async (engine, chars) => {
    const model = respeakEngineModel(engine)
    const text = "a".repeat(chars)
    const p = await computeVoiceChangerProPricing({ stsSlotSeconds: [], respeakChars: [chars], respeakEngines: [engine] })
    expect(p.respeakCredits).toEqual([await speechBaseCredits(model, text)])
  })

  it("the whole parity fixture on v3 and v4 (every case within the model's cap — a Re-speak count is a measured total, never clamped)", async () => {
    let compared = 0
    for (const [provider, text] of SPEECH_PARITY_CASES) {
      const engine = provider === "elevenlabs-v3" ? "v3" : provider === "elevenlabs-v4" ? "v4" : undefined
      // A count of 0 is UNKNOWN in VCP's contract (one 1K bucket), not an empty text: not a parity case.
      if (!engine || text.length === 0 || text.length > getMaxTtsChars(provider!) || text.includes("[")) continue
      compared++
      const p = await computeVoiceChangerProPricing({ stsSlotSeconds: [], respeakChars: [text.length], respeakEngines: [engine] })
      expect(p.respeakCredits[0], `${engine} ${text.length}`).toBe(await speechBaseCredits(provider, text))
    }
    expect(compared).toBeGreaterThanOrEqual(6)
  })

  it("pins the numbers: 1 → 32, 340 → 32, 1,000 → 40, 1,001 → 44, 5,000 → 200 (v3 and v4 both at 4 per unit today)", async () => {
    const p = await computeVoiceChangerProPricing({
      stsSlotSeconds: [],
      respeakChars: [1, 340, 1000, 1001, 5000, 10000],
      respeakEngines: ["v3", "v4", "v3", "v4", "v3", "v4"],
    })
    expect(p.respeakCredits).toEqual([32, 32, 40, 44, 200, 400])
    expect(p.respeakCredits).toEqual([
      speechCredits(1, V3_UNIT), speechCredits(340, V4_UNIT), speechCredits(1000, V3_UNIT),
      speechCredits(1001, V4_UNIT), speechCredits(5000, V3_UNIT), speechCredits(10000, V4_UNIT),
    ])
    expect(p.reserveBase).toBe(32 + 32 + 40 + 44 + 200 + 400)
  })

  it("the per-slot floor is the speech floor (8 units on the engine's row), no longer the six-second speech-to-speech floor", async () => {
    const p = await computeVoiceChangerProPricing({ stsSlotSeconds: [], respeakChars: [1], respeakEngines: ["v4"] })
    expect(p.respeakCredits).toEqual([speechCredits(0, await speechUnitBaseCredits("elevenlabs-v4"))])
    expect(p.respeakCredits[0]).toBe(32)
    expect(p.respeakCredits[0]).not.toBe(p.floor)
  })

  it("the engine defaults to v3 when absent, null, shorter than the counts, or not a known engine", async () => {
    const v3 = (await computeVoiceChangerProPricing({ stsSlotSeconds: [], respeakChars: [1000], respeakEngines: ["v3"] })).respeakCredits[0]
    expect(v3).toBe(speechCredits(1000, V3_UNIT))
    for (const engines of [undefined, [], [undefined], [null], ["sts"], ["V4"], [""], [7]] as const) {
      const p = await computeVoiceChangerProPricing({ stsSlotSeconds: [], respeakChars: [1000], respeakEngines: engines as never })
      expect(p.respeakCredits, JSON.stringify(engines)).toEqual([v3])
    }
    expect(respeakEngineModel("v4")).toBe("elevenlabs-v4")
    expect(respeakEngineModel("v3")).toBe("elevenlabs-v3")
    expect(respeakEngineModel(undefined)).toBe("elevenlabs-v3")
    expect(respeakEngineModel("nope")).toBe("elevenlabs-v3")
  })

  it("an UNKNOWN count (blind caller: the engine derives the text) reserves one 1,000-character bucket priced by the formula", async () => {
    const p = await computeVoiceChangerProPricing({ stsSlotSeconds: [], respeakChars: [null, 0, Number.NaN], respeakEngines: ["v4", "v3", "v4"] })
    expect(p.respeakCredits).toEqual([
      speechCredits(VOICE_CHANGER_PRO_RESPEAK_CHARS_PER_UNIT, V4_UNIT),
      speechCredits(VOICE_CHANGER_PRO_RESPEAK_CHARS_PER_UNIT, V3_UNIT),
      speechCredits(VOICE_CHANGER_PRO_RESPEAK_CHARS_PER_UNIT, V4_UNIT),
    ])
    expect(p.respeakCredits).toEqual([40, 40, 40])
  })

  it("speech-to-speech slots, the reservation floor and the sum are unchanged by the flag", async () => {
    const off = priceVoiceChangerPro(UNIT, PER_1K, { stsSlotSeconds: [26.76, 60, 3, null], respeakChars: [] })
    const on = await computeVoiceChangerProPricing({ stsSlotSeconds: [26.76, 60, 3, null], respeakChars: [] })
    expect(on).toEqual(off)
    expect(on.stsCredits).toEqual([18, 40, 4, 40])
    expect((await computeVoiceChangerProPricing({ stsSlotSeconds: [], respeakChars: [] })).reserveBase).toBe(4)
    const mixed = await computeVoiceChangerProPricing({ stsSlotSeconds: [26.76], respeakChars: [1500, 200], respeakEngines: ["v4", "v3"] })
    expect(mixed.stsCredits).toEqual([18])
    expect(mixed.respeakCredits).toEqual([60, 32])
    expect(mixed.floor).toBe(4)
    expect(mixed.reserveBase).toBe(18 + 60 + 32)
  })

  it("the result still reports the flat Re-speak row (what is charged while length pricing is off)", async () => {
    const p = await computeVoiceChangerProPricing({ stsSlotSeconds: [], respeakChars: [1000], respeakEngines: ["v4"] })
    expect(p.respeakPer1K).toBe(PER_1K)
    expect(p.unitPerMinute).toBe(UNIT)
  })
})

describe("priceVoiceChangerProByLength — the pure length branch", () => {
  it("prices each Re-speak slot on its engine's unit, the speech-to-speech slots as before, and floors the whole at the speech-to-speech floor", () => {
    const p = priceVoiceChangerProByLength(UNIT, PER_1K, { v3: 4, v4: 5 }, { stsSlotSeconds: [60], respeakChars: [100, 100, 1000], respeakEngines: ["v3", "v4", undefined] })
    expect(p.stsCredits).toEqual([40])
    expect(p.respeakCredits).toEqual([speechCredits(100, 4), speechCredits(100, 5), speechCredits(1000, 4)])
    expect(p.respeakCredits).toEqual([32, 40, 40])
    expect(p.floor).toBe(4)
    expect(p.reserveBase).toBe(40 + 32 + 40 + 40)
    expect(priceVoiceChangerProByLength(UNIT, PER_1K, { v3: 4, v4: 4 }, { stsSlotSeconds: [], respeakChars: [] }).reserveBase).toBe(4)
  })

  it("an admin retune of ONE engine's row moves only that engine's speakers", () => {
    const p = priceVoiceChangerProByLength(UNIT, PER_1K, { v3: 4, v4: 6 }, { stsSlotSeconds: [], respeakChars: [1000, 1000], respeakEngines: ["v3", "v4"] })
    expect(p.respeakCredits).toEqual([40, 60])
  })
})
