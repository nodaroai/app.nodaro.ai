/**
 * Centralized Provider Routing Layer
 *
 * Handles routing between KIE.ai and Replicate based on app settings.
 *
 * ROUTING LOGIC:
 * When cloud edition (ai_provider=kie) is active:
 *   1. Check if KIE.ai SUPPORTS the model/operation
 *   2. If supported → use KIE.ai (errors propagate to user, NO fallback)
 *   3. If NOT supported → fall back to Replicate with 10% markup
 *
 * When self-hosted (ai_provider=replicate):
 *   - Always use Replicate directly, no markup
 *
 * IMPORTANT: Fallback is ONLY for UNSUPPORTED models, NOT for errors!
 * If KIE.ai supports a model but returns an error (500, timeout, rate limit),
 * that error propagates to the user. We do NOT silently fall back to Replicate.
 */

import { getAppSettings, calculateDisplayCost, type AppSettings } from "../lib/app-settings.js"
import { isKieSupported, getKieCost, type KieCategory } from "./model-mapping.js"

export type ProviderUsed = "kie" | "replicate"

export interface ProviderRoutingResult {
  useKie: boolean
  providerUsed: ProviderUsed
  settings: AppSettings
  /** Apply this markup to Replicate costs when falling back from KIE.ai mode */
  costMarkupPercent: number
}

export interface ProviderExecutionResult<T> {
  result: T
  providerUsed: ProviderUsed
  cost: number | null
  /** Display cost with any markup applied */
  displayCost: number | null
}

// Fallback markup when KIE.ai mode falls back to Replicate (10%)
const [constant removed]

/**
 * Determine which provider to use for a given operation
 *
 * @param category - The KIE.ai category (image, video, text-to-video, etc.)
 * @param provider - The specific model/provider name (e.g., "minimax", "veo3")
 * @param operation - Description of the operation for logging (e.g., "image-to-video")
 * @returns Routing decision with settings and markup info
 */
export async function routeProvider(
  category: KieCategory,
  provider: string,
  operation: string
): Promise<ProviderRoutingResult> {
  const settings = await getAppSettings()

  // If not in KIE.ai mode, always use Replicate
  if (settings.ai_provider !== "kie") {
    console.log(`[routeProvider] ${operation}: Using Replicate (ai_provider=${settings.ai_provider})`)
    return {
      useKie: false,
      providerUsed: "replicate",
      settings,
      costMarkupPercent: 0, // No markup for self-hosted
    }
  }

  // In KIE.ai mode - check if this specific model/operation is supported
  const kieSupported = isKieSupported(category, provider)

  if (kieSupported) {
    console.log(`[routeProvider] ${operation}: Using KIE.ai (provider: ${provider}, category: ${category})`)
    return {
      useKie: true,
      providerUsed: "kie",
      settings,
      costMarkupPercent: settings.cost_markup_percent, // Apply configured markup
    }
  }

  // KIE.ai mode but model not supported - fall back to Replicate with markup
  console.log(`[routeProvider] ${operation}: KIE.ai mode but provider "${provider}" not supported for ${category} - falling back to Replicate with ${FALLBACK_MARKUP_PERCENT}% markup`)
  return {
    useKie: false,
    providerUsed: "replicate",
    settings,
    costMarkupPercent: FALLBACK_MARKUP_PERCENT, // Fallback markup
  }
}

/**
 * Calculate final cost with any applicable markup
 *
 * @param providerCost - Raw cost from the provider (KIE.ai or Replicate)
 * @param markupPercent - Markup percentage to apply
 * @returns Display cost with markup applied
 */
export function applyMarkup(providerCost: number | null, markupPercent: number): number | null {
  if (providerCost === null) return null
  return calculateDisplayCost(providerCost, markupPercent)
}

/**
 * Log the final execution result with cost information
 */
export function logExecutionResult(
  operation: string,
  providerUsed: ProviderUsed,
  cost: number | null,
  displayCost: number | null
): void {
  const costStr = cost !== null ? `$${cost.toFixed(6)}` : "N/A"
  const displayStr = displayCost !== null ? `$${displayCost.toFixed(6)}` : "N/A"
  const markupInfo = displayCost !== null && cost !== null && displayCost !== cost
    ? ` (with markup: ${displayStr})`
    : ""

  console.log(`[${operation}] Completed via ${providerUsed.toUpperCase()}: cost=${costStr}${markupInfo}`)
}

/**
 * Helper to create a standardized execution result
 */
export function createExecutionResult<T>(
  result: T,
  providerUsed: ProviderUsed,
  cost: number | null,
  markupPercent: number
): ProviderExecutionResult<T> {
  return {
    result,
    providerUsed,
    cost,
    displayCost: applyMarkup(cost, markupPercent),
  }
}

/**
 * Get the KIE.ai cost for a supported operation
 * Returns null if not supported on KIE.ai
 */
export function getKieOperationCost(category: KieCategory, provider: string): number | null {
  if (!isKieSupported(category, provider)) return null
  return getKieCost(category, provider)
}
