import { LTX_EXTEND_PER_SECOND_CREDIT_ID, ltxExtendDurationSec } from "@nodaro/shared"
import { baseCreditCostFor } from "./credit-base-cost.js"

/**
 * LTX 2.3 Pro Extend: the BASE (pre-markup) price of one run — the per-second
 * row (`ltx-2.3-pro-extend:per-second`, admin-editable in model_pricing) times
 * the seconds it adds, read by `ltxExtendDurationSec` (1–20, default 6), the
 * same reading that decides how many seconds are sent to the model.
 *
 * One function for the route's credit guard and the workflow run's
 * reservation (node-executor), so an extend holds the same amount wherever it
 * runs. Before it existed both reserved the flat `ltx-2.3-pro` row (a 6-second
 * generation) whatever the length asked for.
 *
 * The run settles on the measured cost of the render (`meteredCost`), so this
 * amount is the hold and the most the run can be charged; anything unused is
 * refunded when the job completes. 0 when credits are off.
 */
export async function ltxExtendBaseCredits(duration: unknown): Promise<number> {
  return (await baseCreditCostFor(LTX_EXTEND_PER_SECOND_CREDIT_ID)) * ltxExtendDurationSec(duration)
}
