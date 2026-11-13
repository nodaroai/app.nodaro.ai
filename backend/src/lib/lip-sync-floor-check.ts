// @registry-enumerates prices the credit id of one model's cheapest run through CreditsService — a credit id, not a node type, so not a @registry-lookup
import type { FastifyRequest } from "fastify"
import { LIP_SYNC_DURATION_BUCKETS, unitQuoteCreditId } from "@nodaro/shared/credits"
import { hasCredits } from "./config.js"
import { checkPayerCanAfford } from "../middleware/credit-guard.js"
import { lipSyncHeldCreditId, type LipSyncAudioPricing } from "./lip-sync-inputs.js"

/**
 * The cheapest run a model priced by its audio's length can be: a bucketed
 * model's smallest tier, a per-second-rate model's minimum seconds.
 */
export function lipSyncFloorCreditId(pricing: LipSyncAudioPricing): string {
  return pricing.kind === "rate"
    ? unitQuoteCreditId(pricing.rate.rateId, pricing.rate.minSeconds)
    : lipSyncHeldCreditId(pricing, LIP_SYNC_DURATION_BUCKETS[0])
}

/**
 * A balance check BEFORE the audio is downloaded and measured (decided
 * 2026-11-13): a payer who cannot cover even the model's cheapest run is
 * refused with the credit guard's own answer for the shortfall (402), so a
 * request that can never run costs no download or decode. The guard still
 * checks the real price once the audio is measured. Balance only, by the
 * reservation's own gates (`checkPayerCanAfford`): the guard's balance check
 * at a price at or below the measured run's, so it refuses nothing the guard
 * would let through. Cloud only; undefined when the payer can cover it, when
 * the account still owes its consent (the guard's consent ask answers it), and
 * when the floor cannot be priced or checked (the guard then answers after the
 * measurement, as before).
 */
export async function lipSyncFloorRefusal(
  req: FastifyRequest,
  pricing: LipSyncAudioPricing,
): Promise<{ readonly statusCode: number; readonly body: unknown } | undefined> {
  if (!hasCredits()) return undefined
  try {
    const { CreditsService } = await import("../ee/billing/credits.js")
    const credits = await CreditsService.getModelCreditCost(lipSyncFloorCreditId(pricing))
    const afford = await checkPayerCanAfford(req, credits)
    if (afford.ok) return undefined
    // An account that still owes its consent is answered by the guard's own
    // consent ask (it comes before the balance there), never a 402 here.
    const { consentPendingFor } = await import("../ee/lib/welcome-consent-gate.js")
    if (req.userId && (await consentPendingFor(req.userId))) return undefined
    return { statusCode: afford.statusCode, body: afford.body }
  } catch {
    // A floor that cannot be priced or checked refuses nothing: the guard prices
    // and checks the measured run itself.
    return undefined
  }
}
