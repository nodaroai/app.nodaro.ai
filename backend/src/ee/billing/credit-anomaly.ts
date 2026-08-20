import { supabase } from "../../lib/supabase.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { usdToCredits } from "@nodaro/shared"
import { effectiveMarkupPercent } from "./service-margin.js"

/**
 * Reserve-vs-actual mismatches below this DOLLAR value are noise, not anomalies.
 *
 * Stored in USD rather than credits so it means the same thing after a credit
 * re-denomination. As a hardcoded `1` it would silently become a 10x-tighter
 * filter the moment CREDIT_BASE_USD moved, flooding `credit_anomalies`.
 */
export const ANOMALY_TOLERANCE_USD = 0.02

/** {@link ANOMALY_TOLERANCE_USD} expressed in whole credits at the current base. */
export function anomalyToleranceCredits(): number {
  return usdToCredits(ANOMALY_TOLERANCE_USD)
}

/**
 * Compute actual credits from provider cost in USD.
 * Mirrors the credit pricing formula: 1 credit = CREDIT_BASE_USD at 0% markup.
 *
 * Double-ceil rationale: the base conversion rounds up fractional provider cost
 * to whole credits first, then ceil(× markup) rounds up the markup separately.
 * This ensures we never undercharge even by a fraction of a credit.
 *
 * The base conversion goes through `usdToCredits`, which carries the
 * milli-credit float guard. The previous bare `Math.ceil(cost / base)`
 * over-charged a full credit whenever IEEE-754 division landed just above an
 * integer — observed across production jobs (lip-sync, image-to-video,
 * 2 generate-character), always in the customer's disfavour.
 */
export async function computeActualCredits(providerCostUsd: number, modelIdentifier?: string): Promise<number> {
  const baseCredits = usdToCredits(providerCostUsd)
  const settings = await getAppSettings()
  // Same margin the reserve applied: the identifier's per-service margin when
  // configured, else the global markup. Without this, a margined metered
  // service would have its margin silently refunded at commit (actual < reserved).
  const markupPercent = modelIdentifier !== undefined
    ? effectiveMarkupPercent(settings, modelIdentifier)
    : settings.cost_markup_percent
  if (markupPercent > 0) {
    return Math.ceil(baseCredits * (1 + markupPercent / 100))
  }
  return baseCredits
}

interface AnomalyCheckParams {
  jobId: string
  userId: string
  usageLogId: string
  modelIdentifier: string
  provider: string | null
  reservedCredits: number
  actualCredits: number
  providerCostUsd: number
}

/**
 * Check for credit anomaly and log it if significant.
 * Never throws — anomaly tracking must not break job completion.
 */
export async function checkAndLogAnomaly(params: AnomalyCheckParams): Promise<void> {
  try {
    const { jobId, userId, usageLogId, modelIdentifier, provider, reservedCredits, actualCredits, providerCostUsd } = params
    const diff = actualCredits - reservedCredits

    // Zero-cost reservation with actual charges is always an anomaly
    if (reservedCredits === 0 && actualCredits > 0) {
      // fall through to log as "zero_cost" anomaly
    } else if (Math.abs(diff) <= anomalyToleranceCredits() || reservedCredits === 0 || Math.abs(diff) / reservedCredits <= 0.10) {
      // Skip insignificant mismatches: under the dollar tolerance, or under 10% deviation
      return
    }

    const anomalyType = reservedCredits === 0
      ? "zero_cost" as const
      : diff > 0 ? "undercharge" as const : "overcharge" as const

    console.warn(`[credit-anomaly] ${anomalyType} detected for job ${jobId}: reserved=${reservedCredits}, actual=${actualCredits}, diff=${diff}, model=${modelIdentifier}`)

    await supabase.from("credit_anomalies" as "assets").insert({
      job_id: jobId,
      user_id: userId,
      usage_log_id: usageLogId,
      model_identifier: modelIdentifier,
      provider,
      credits_estimated: reservedCredits,
      credits_actual: actualCredits,
      diff,
      provider_cost_usd: providerCostUsd,
      anomaly_type: anomalyType,
      status: "pending",
    } as Record<string, unknown>)
  } catch (error) {
    console.error("[credit-anomaly] Failed to log anomaly:", error)
  }
}
