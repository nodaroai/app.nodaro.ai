/**
 * A per-unit node's own pill and Run button: the server's price for the whole
 * run (`lib/unit-quote.ts`) — the figure its reservation charges — and, until
 * that answer arrives, the one-unit price × the units rounded up.
 */
import { hasCredits } from "@/lib/edition"
import { useModelCreditCost } from "@/hooks/use-model-credit-cost"
import { unitQuoteIdFor, upperUnits } from "@/lib/unit-quote"

/**
 * Credits of `units` of the one-unit row `rateId`: the whole run's served
 * price, else the served one-unit price × the units rounded up; undefined
 * until either is known, and on a build without credits.
 */
export function useUnitQuote(rateId: string | undefined, units: number): number | undefined {
  const { data: unit } = useModelCreditCost(rateId)
  const { data: whole } = useModelCreditCost(unitQuoteIdFor(rateId, units))
  if (!hasCredits()) return undefined
  return whole ?? (unit === undefined ? undefined : unit * upperUnits(units))
}

/**
 * The server's price for the whole run and nothing else: the charge's own
 * arithmetic (the row's base × the units, rounded up once, marked up once),
 * and undefined until it is known, on a build without credits, or where the
 * server does not price that many units. No interim figure: for a run priced
 * per fraction of a row (Nodaro Video Upscale bills a quarter of its
 * four-second row per second), the one-unit price × the units rounded up
 * reads well above the charge, so a pill shows no price until it can show the
 * charge's. A single unit is the row's own price.
 */
export function useExactUnitQuote(rateId: string | undefined, units: number): number | undefined {
  const wholeId = unitQuoteIdFor(rateId, units)
  const { data } = useModelCreditCost(wholeId ?? (units === 1 ? rateId : undefined))
  if (!hasCredits()) return undefined
  return data
}

/** {@link useUnitQuote} as a plain number: `fallback` stands in for the one-unit row until it is fetched; 0 without credits. */
export function useUnitQuoteCredits(rateId: string | undefined, units: number, fallback = 0): number {
  const quote = useUnitQuote(rateId, units)
  if (!hasCredits()) return 0
  return quote ?? fallback * upperUnits(units)
}
