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

/** {@link useUnitQuote} as a plain number: `fallback` stands in for the one-unit row until it is fetched; 0 without credits. */
export function useUnitQuoteCredits(rateId: string | undefined, units: number, fallback = 0): number {
  const quote = useUnitQuote(rateId, units)
  if (!hasCredits()) return 0
  return quote ?? fallback * upperUnits(units)
}
