import { supabase } from "../lib/supabase.js"
import { getAppSettings } from "../lib/app-settings.js"
import { CREDIT_BASE_USD } from "@nodaro/shared"

/**
 * Compute actual credits from provider cost in USD.
 * Mirrors the credit pricing formula: 1 credit = $0.02 at 0% markup.
 *
 * Double-ceil rationale: ceil(cost / base) rounds up fractional provider cost
 * to whole credits first, then ceil(× markup) rounds up the markup separately.
 * This ensures we never undercharge even by a fraction of a credit.
 */
export async function computeActualCredits(providerCostUsd: number): Promise<number> {
  const baseCredits = Math.ceil(providerCostUsd / CREDIT_BASE_USD)
  const settings = await getAppSettings()
  if (settings.cost_markup_percent > 0) {
    return Math.ceil(baseCredits * (1 + settings.cost_markup_percent / 100))
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
    } else if (Math.abs(diff) <= 1 || reservedCredits === 0 || Math.abs(diff) / reservedCredits <= 0.10) {
      // Skip insignificant mismatches: 1 credit or less, or under 10% deviation
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
