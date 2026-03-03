/**
 * Build composite credit model identifiers for variable pricing.
 * Shared between frontend and backend.
 */

import {
  HIGH_QUALITY_PROVIDERS,
  TWO_K_RESOLUTION_PROVIDERS,
  IDEOGRAM_PROVIDERS,
} from "./model-constants.js"

/**
 * Compute composite model identifier for variable credit pricing.
 * Examples: "gpt-image:high", "flux:2K", "nano-banana-pro:4K", "ideogram:TURBO"
 */
export function buildCreditModelIdentifier(
  provider: string,
  quality?: string,
  resolution?: string,
  renderingSpeed?: string,
): string {
  if (HIGH_QUALITY_PROVIDERS.has(provider) && quality === "high") {
    return `${provider}:high`
  }
  if (TWO_K_RESOLUTION_PROVIDERS.has(provider) && resolution === "2K") {
    return `${provider}:2K`
  }
  if (provider === "nano-banana-pro" && resolution === "4K") {
    return `${provider}:4K`
  }
  if (provider === "nano-banana-2" && (resolution === "2K" || resolution === "4K")) {
    return `${provider}:${resolution}`
  }
  if (IDEOGRAM_PROVIDERS.has(provider)) {
    if (renderingSpeed === "TURBO") return `${provider}:TURBO`
    if (renderingSpeed === "QUALITY") return `${provider}:QUALITY`
  }
  return provider
}
