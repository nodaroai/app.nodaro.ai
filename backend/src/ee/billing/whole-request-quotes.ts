/**
 * Whole-request price ids — ids that name the price of ONE request, priced
 * from the rows that request's own route reserves from, never a row of their
 * own.
 *
 * Every such request is charged as a whole: its base is computed from its
 * rows (summed, multiplied, rounded) and the total is marked up ONCE at the
 * route's identifier. A client that adds up served (already marked-up,
 * already rounded) prices cannot reach that figure, so the price lookups —
 * `getModelCreditBaseCost` (the single GET, `CreditsService.getModelCreditCost`)
 * and `getChargedPriceTable().base` (the batch endpoint, the run estimates) —
 * answer these ids through this ONE registry, with the route's own pricing
 * function. Two kinds today:
 *
 *   - `<rateId>:<units>u`: N units of a per-unit rate, a speech request's
 *     quote included — lib/unit-quote-rates.ts;
 *   - `voice-changer-pro:<slots>`: a whole Voice Changer Pro convert, priced by
 *     `priceVoiceChangerProFromUnits` — the function the convert route's
 *     reservation prices through (`computeVoiceChangerProPricing`).
 *
 * The id is marked up at `priceMarginKey(id)` (lib/speech-credits.ts): the id
 * the request's guard marks up at.
 */
import { parseVoiceChangerProQuoteCreditId, type VoiceChangerProQuoteCreditIdParts } from "@nodaro/shared/credits"
import { speechLengthPricingEnabled } from "../../lib/config.js"
import { parseQuoteCreditId, quoteBaseCredits } from "../../lib/unit-quote-rates.js"
import {
  VOICE_CHANGER_PRO_MINUTE_MODEL,
  VOICE_CHANGER_PRO_UNIT_ROWS,
  priceVoiceChangerProFromUnits,
  voiceChangerProUnitKeys,
  type VoiceChangerProUnits,
} from "./voice-changer-pro-pricing.js"

/** A whole-request price id, read: the rows it is priced from and the price. */
export interface WholeRequestQuote {
  /** Every row the price reads — a lookup reads each through its own row reader first. */
  readonly rows: readonly string[]
  /** The row whose switches (enabled, tier restriction) the quote carries: the id the request's guard checks. */
  readonly gateRow: string
  /** BASE credits from the rows, or undefined when a row is priced nowhere. */
  base(rowOf: (id: string) => number | undefined): number | undefined
}

/**
 * The most changed speakers a convert prices — the convert route's speaker
 * cap (the Voice Changer Pro plugin's `VOICE_RECAST_SPEAKER_CAP`); a quote
 * naming more lands in `missing`.
 */
export const VOICE_CHANGER_PRO_QUOTE_MAX_SLOTS = 8
/** The longest stem a quote prices: an hour, far past any convertible clip. */
export const VOICE_CHANGER_PRO_QUOTE_MAX_STS_SECONDS = 3600
/** The most transcript characters a quote prices for one Re-speak slot (before a translated slot's allowance): far past an hour of speech. */
export const VOICE_CHANGER_PRO_QUOTE_MAX_RESPEAK_CHARS = 200_000

/** The convert's pricing inputs of a `voice-changer-pro:<slots>` id the server prices, or undefined (out of range). */
export function parsePricedVoiceChangerProQuote(id: string): VoiceChangerProQuoteCreditIdParts | undefined {
  const parts = parseVoiceChangerProQuoteCreditId(id)
  if (!parts) return undefined
  if (parts.stsSlotSeconds.length + parts.respeakChars.length > VOICE_CHANGER_PRO_QUOTE_MAX_SLOTS) return undefined
  if (parts.stsSlotSeconds.some((s) => s !== null && s > VOICE_CHANGER_PRO_QUOTE_MAX_STS_SECONDS)) return undefined
  if (parts.respeakChars.some((c) => c !== null && c > VOICE_CHANGER_PRO_QUOTE_MAX_RESPEAK_CHARS)) return undefined
  return parts
}

function voiceChangerProQuote(parts: VoiceChangerProQuoteCreditIdParts): WholeRequestQuote {
  const lengthPricing = speechLengthPricingEnabled()
  const keys = voiceChangerProUnitKeys(lengthPricing)
  return {
    rows: keys.map((k) => VOICE_CHANGER_PRO_UNIT_ROWS[k]),
    gateRow: VOICE_CHANGER_PRO_MINUTE_MODEL,
    base: (rowOf) => {
      const units: Partial<Record<keyof VoiceChangerProUnits, number>> = {}
      for (const k of keys) {
        const row = rowOf(VOICE_CHANGER_PRO_UNIT_ROWS[k])
        if (row === undefined) return undefined
        units[k] = row
      }
      // Each Re-speak slot on its engine (an unnamed one is the default, v3 —
      // what the convert route reserves a slot sent without one at), a
      // translated one on its reserved characters: exactly the arguments the
      // convert route's reservation passes, so the quote is that charge.
      return priceVoiceChangerProFromUnits(
        { minute: units.minute!, respeak: units.respeak!, v3: units.v3, v4: units.v4 },
        lengthPricing,
        {
          stsSlotSeconds: parts.stsSlotSeconds,
          respeakChars: parts.respeakChars,
          respeakEngines: parts.respeakEngines,
          respeakTranslated: parts.respeakTranslated,
        },
      ).reserveBase
    },
  }
}

/** The whole-request quote `id` names, or undefined for every other id. */
export function wholeRequestQuoteOf(id: string): WholeRequestQuote | undefined {
  const rate = parseQuoteCreditId(id)
  if (rate) {
    return {
      rows: [rate.rateId],
      gateRow: rate.rateId,
      base: (rowOf) => {
        const unit = rowOf(rate.rateId)
        return unit === undefined ? undefined : quoteBaseCredits(unit, rate.units)
      },
    }
  }
  const convert = parsePricedVoiceChangerProQuote(id)
  return convert ? voiceChangerProQuote(convert) : undefined
}
