import { LTX_RETAKE_PER_SECOND_CREDIT_ID, ltxRetakeDurationSec } from "@nodaro/shared"
import { baseCreditCostFor } from "./credit-base-cost.js"

/**
 * LTX 2.3 Pro Retake: the BASE (pre-markup) price of one run — the per-second
 * row (`ltx-2.3-pro-retake:per-second`, admin-editable in model_pricing) times
 * the seconds of the replaced window (`ltxRetakeDurationSec`: at least 2, the
 * value sent to the model), rounded up to a whole credit.
 *
 * One function for the route's credit guard and the workflow run's
 * reservation (node-executor), so a retake holds the same amount wherever it
 * runs. Before it existed the workflow run reserved the flat `video-retake`
 * row whatever the window. 0 when credits are off.
 */
export async function ltxRetakeBaseCredits(retakeDuration: unknown): Promise<number> {
  return Math.ceil((await baseCreditCostFor(LTX_RETAKE_PER_SECOND_CREDIT_ID)) * ltxRetakeDurationSec(retakeDuration))
}
