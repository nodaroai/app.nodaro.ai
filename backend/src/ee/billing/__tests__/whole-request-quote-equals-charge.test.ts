/**
 * A whole Voice Changer Pro convert's QUOTE is its CHARGE, and so is a dub's.
 *
 * The convert route reserves the SUM of every changed speaker's base credits,
 * marked up ONCE at `voice-changer-pro`; a client adding up per-slot prices on
 * the served (already marked-up, already rounded) rows lands on a different
 * number. `voice-changer-pro:<slots>` names the whole convert, and both price
 * lookups (the batch endpoint's rule over the price table, the single GET)
 * answer it with the reservation: `computeVoiceChangerProPricing` (what the
 * route's `computeCredits` returns through the toolkit) marked up the way the
 * route's guard marks it up. Same for a dub of N started minutes
 * (`elevenlabs-dubbing:<N>u`) against the dubbing route's own base.
 *
 * Held at DISTINCT non-zero margins on every row the price reads, admin rows
 * that differ from the static seeds, mixed slots with fractional seconds and
 * unknown counts, and length pricing both off and on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { settings, rows, flags } = vi.hoisted(() => ({
  settings: { current: { cost_markup_percent: 0, service_margin_percent: {} as Record<string, number> } },
  rows: { current: {} as Record<string, { credit_cost: number; is_enabled: boolean }> },
  flags: { lengthPricing: false },
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true, speechLengthPricingEnabled: () => flags.lengthPricing }
})
function modelPricingQuery() {
  let id: string | undefined
  const query = {
    select: () => query,
    order: () => query,
    eq: (_col: string, value: string) => {
      id = value
      return query
    },
    single: async () => {
      const row = id === undefined ? undefined : rows.current[id]
      return row
        ? { data: { credit_cost: row.credit_cost, is_enabled: row.is_enabled, tier_restriction: null }, error: null }
        : { data: null, error: { code: "PGRST116" } }
    },
    range: async (from: number) => ({
      data: from === 0 ? Object.entries(rows.current).map(([model_identifier, r]) => ({ model_identifier, credit_cost: r.credit_cost })) : [],
      error: null,
    }),
  }
  return query
}
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      return modelPricingQuery()
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings.current }))

import { voiceChangerProQuoteCreditId, type VoiceChangerProQuoteSlot } from "@nodaro/shared"
import { CreditsService, PriceNotConfiguredError, chargedCredits, getChargedPriceTable, getModelCreditBaseCost, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { computeVoiceChangerProPricing } from "../voice-changer-pro-credits.js"
import { VOICE_CHANGER_PRO_QUOTE_MAX_SLOTS } from "../whole-request-quotes.js"
import { priceMarginKey } from "../../../lib/speech-credits.js"
import { dubbingBaseCredits } from "../../../lib/dubbing-span.js"
import { dubbingModelIdentifier } from "../../../lib/dubbing-model.js"

/** Admin rows that differ from the static seeds, so a quote read off the seeds would fail. */
const ADMIN_ROWS = {
  "voice-changer-pro": 37,
  "voice-changer-pro-respeak": 26,
  "elevenlabs-v3:per-100-chars": 3,
  "elevenlabs-v4:per-100-chars": 5,
  "elevenlabs-dubbing": 41,
  "elevenlabs-dubbing-v2": 1013,
}
/** A distinct margin on every row the prices read, and a global one beside them. */
const MARGINS = {
  cost_markup_percent: 15,
  service_margin_percent: { "voice-changer-pro": 23, "voice-changer-pro-respeak": 41, "elevenlabs-v3": 9, "elevenlabs-dubbing": 17, "elevenlabs-dubbing-v2": 31 },
}

beforeEach(() => {
  settings.current = { ...MARGINS, service_margin_percent: { ...MARGINS.service_margin_percent } }
  rows.current = Object.fromEntries(Object.entries(ADMIN_ROWS).map(([id, credit_cost]) => [id, { credit_cost, is_enabled: true }]))
  flags.lengthPricing = false
  invalidateModelPricingCache()
})

const sts = (seconds: number | null): VoiceChangerProQuoteSlot => ({ kind: "sts", seconds })
const respeak = (chars: number | null): VoiceChangerProQuoteSlot => ({ kind: "respeak", chars })

/** Mixed converts: fractional stems, short stems under the floor, unknown counts, Re-speak alone and beside recasts. */
const CONVERTS: Array<[string, VoiceChangerProQuoteSlot[]]> = [
  ["one recast, fractional stem", [sts(26.76)]],
  ["two recasts in one clip", [sts(26.76), sts(41.3)]],
  ["a stem under the six-second floor", [sts(2.4)]],
  ["an unknown stem (one minute)", [sts(null)]],
  ["recasts and Re-speaks mixed", [sts(73.25), respeak(1234), sts(5.01), respeak(87)]],
  ["Re-speak only", [respeak(2999)]],
  ["an unknown Re-speak count (one bucket)", [respeak(null), sts(12)]],
  ["the speaker cap", Array.from({ length: VOICE_CHANGER_PRO_QUOTE_MAX_SLOTS }, (_, i) => (i % 3 === 0 ? respeak(400 + i * 97) : sts(9.5 + i * 13.37)))],
]

/** What the convert route reserves: its `computeCredits` (the toolkit's pricing) marked up by its guard at `voice-changer-pro`. */
async function convertCharge(slots: readonly VoiceChangerProQuoteSlot[]): Promise<number> {
  const stsSlotSeconds = slots.flatMap((s) => (s.kind === "sts" ? [s.seconds] : []))
  const respeakChars = slots.flatMap((s) => (s.kind === "respeak" ? [s.chars] : []))
  const { reserveBase } = await computeVoiceChangerProPricing({ stsSlotSeconds, respeakChars })
  return applyServiceMarkup(reserveBase, settings.current as never, "voice-changer-pro")
}

describe("a whole Voice Changer Pro convert — the quote is the reservation", () => {
  for (const lengthPricing of [false, true]) {
    describe(`length pricing ${lengthPricing ? "on" : "off"}`, () => {
      it.each(CONVERTS)("%s", async (_name, slots) => {
        flags.lengthPricing = lengthPricing
        const id = voiceChangerProQuoteCreditId(slots)
        const charge = await convertCharge(slots)
        expect(chargedCredits(await getChargedPriceTable(), id)).toBe(charge)
        invalidateModelPricingCache()
        expect(await CreditsService.getModelCreditCost(id)).toBe(charge)
      })
    })
  }

  it("is a figure per-slot math on the served rows cannot reach (the reason the id exists)", async () => {
    // A 30-second stem: 37/min marked up 23% is served as 46/min, and half a minute of
    // that is 23 — while the convert reserves ceil(19 × 1.23) = 24.
    const slots = [sts(30)]
    const table = await getChargedPriceTable()
    const servedPerMinute = chargedCredits(table, "voice-changer-pro")!
    const perSlot = slots.reduce((sum, s) => sum + Math.ceil((servedPerMinute * (s.kind === "sts" ? s.seconds! : 0)) / 60), 0)
    expect(chargedCredits(table, voiceChangerProQuoteCreditId(slots))).not.toBe(perSlot)
  })

  it("is marked up at voice-changer-pro, the id the convert's guard marks up at", () => {
    expect(priceMarginKey(voiceChangerProQuoteCreditId([sts(10), respeak(500)]))).toBe("voice-changer-pro")
  })

  it("carries the voice-changer-pro row's switch: a disabled convert quotes as disabled", async () => {
    rows.current["voice-changer-pro"] = { credit_cost: 37, is_enabled: false }
    invalidateModelPricingCache()
    expect((await getModelCreditBaseCost(voiceChangerProQuoteCreditId([sts(10)]))).isEnabled).toBe(false)
  })

  it("reads the documented examples (the client builds the same strings)", () => {
    expect(voiceChangerProQuoteCreditId([sts(26.76), respeak(1200), sts(null)])).toBe("voice-changer-pro:sts-26.76,respeak-1200,sts")
    expect(voiceChangerProQuoteCreditId([respeak(0), sts(0)])).toBe("voice-changer-pro:respeak,sts")
  })

  it.each([
    ["no slots", "voice-changer-pro:"],
    ["a slot kind the convert has not", "voice-changer-pro:sts-10,dub-3"],
    ["a zero count", "voice-changer-pro:sts-0"],
    ["an exponent", "voice-changer-pro:sts-1e3"],
    ["an empty slot", "voice-changer-pro:sts-10,,respeak-5"],
    ["more speakers than a convert takes", `voice-changer-pro:${Array.from({ length: VOICE_CHANGER_PRO_QUOTE_MAX_SLOTS + 1 }, () => "sts-10").join(",")}`],
    ["a stem past an hour", "voice-changer-pro:sts-3600.5"],
    ["more characters than any speaker", "voice-changer-pro:respeak-200001"],
  ])("refuses %s — priced nowhere", async (_label, id) => {
    expect(chargedCredits(await getChargedPriceTable(), id)).toBeUndefined()
    await expect(CreditsService.getModelCreditCost(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
  })
})

describe("a dub of N started minutes — the quote is the dubbing route's reservation", () => {
  it.each([
    ["en", 1, 37],
    ["es", 3, 150],
    ["en", 30, 1800],
    ["he", 1, 60],
    ["he", 7, 401],
  ] as const)("%s, %i minute(s) (a %is span)", async (language, minutes, spanSec) => {
    const rateId = dubbingModelIdentifier(language)
    // routes/dubbing.ts: creditGuard(dubbingModelIdentifier(lang), { computeCredits: dubbingBaseCredits(lang, span) }).
    const charge = applyServiceMarkup(await dubbingBaseCredits(language, spanSec), settings.current as never, rateId)
    const id = `${rateId}:${minutes}u`
    expect(chargedCredits(await getChargedPriceTable(), id)).toBe(charge)
    expect(await CreditsService.getModelCreditCost(id)).toBe(charge)
  })

  it.each([
    ["a fractional minute (a dub is charged whole minutes)", "elevenlabs-dubbing:2.5u"],
    ["more minutes than a dub may cover", "elevenlabs-dubbing:31u"],
    ["the project lane past the cap", "elevenlabs-dubbing-v2:31u"],
  ])("refuses %s — priced nowhere", async (_label, id) => {
    expect(chargedCredits(await getChargedPriceTable(), id)).toBeUndefined()
    await expect(CreditsService.getModelCreditCost(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
  })
})
