import { hasCredits } from "./config.js"

/**
 * Base (pre-markup) credit cost of a priced identifier — the admin-editable
 * `model_pricing` row, else the static table — for a core route that settles
 * a count-based reservation (`commitJobCredits(..., baseActual, true)`).
 * Core-safe: `ee/` is reached by dynamic import, exactly like the commit /
 * refund helpers in credits-job-lifecycle.ts. 0 when credits are off.
 */
export async function baseCreditCostFor(modelIdentifier: string): Promise<number> {
  if (!hasCredits()) return 0
  const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
  return (await getModelCreditBaseCost(modelIdentifier)).creditCost
}

/** The base of `units` of a rate whose one-unit base is `unitBase`: rounded up once, as a route reserves it. */
export function quoteBaseCredits(unitBase: number, units: number): number {
  return Math.ceil(unitBase * units)
}

/**
 * What a run of `units` of a per-unit rate is CHARGED, before the markup: the
 * rate's row — `model_pricing`, else `STATIC_CREDIT_COSTS`, read through
 * `getModelCreditBaseCost`, the lookup that prices the run's whole-run quote
 * id (`<rateId>:<units>u`, lib/unit-quote-rates.ts) — times the units, rounded
 * up once ({@link quoteBaseCredits}). Every lane that charges such a run
 * reserves through this (the routes' guards, the workflow run's overrides), so
 * an administrator's retune of a rate's row moves the charge and the quote
 * together. Never a code constant: a rate priced nowhere throws
 * `PriceNotConfiguredError`, as its quote does. 0 when credits are off.
 */
export async function unitRateBaseCredits(rateId: string, units: number): Promise<number> {
  return quoteBaseCredits(await baseCreditCostFor(rateId), units)
}
