// @registry-enumerates prices the credit id it is given by getModelCreditBaseCost — a credit id, not a node type, so not a @registry-lookup
import { hasCredits } from "./config.js"

/**
 * The BASE (pre-markup) credits of a credit id — the administrator's
 * `model_pricing` row, else its static row — or `undefined` when there is
 * nothing to price (no credits in this edition, or no row at all: the caller
 * then commits its reservation as before).
 *
 * WHY: a run held at one row and delivered as less settles at the row of what
 * it delivered (Split into Layers: held for the most images it may return,
 * settled on the images it really returned). Reading the ROW, not a formula,
 * keeps an administrator's reprice in force for the settlement as for the
 * hold. Handed to `finalizeJobWithMedia` as `meteredBaseCredits`, which marks
 * it up once at the reservation's margin and never commits above the hold.
 * Core shim over the ee price reader (dynamic import, the credit-guard
 * pattern): community and business never load a billing module.
 */
export async function creditIdBaseCredits(creditId: string): Promise<number | undefined> {
  if (!hasCredits()) return undefined
  const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
  try {
    return (await getModelCreditBaseCost(creditId)).creditCost
  } catch (err) {
    console.error(`[ALERT] credit-id-base: no price for "${creditId}" — the run commits its reservation: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}
