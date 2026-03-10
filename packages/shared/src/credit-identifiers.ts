/**
 * Build composite credit model identifiers for variable pricing.
 * Shared between frontend and backend.
 */

import {
  HIGH_QUALITY_PROVIDERS,
  TWO_K_RESOLUTION_PROVIDERS,
  IDEOGRAM_PROVIDERS,
  DURATION_PRICED_PROVIDERS,
  AUDIO_ADDON_PROVIDERS,
  VIDEO_DURATION_TIERS,
} from "./model-constants.js"

/**
 * Compute composite model identifier for variable credit pricing.
 * Examples: "gpt-image:high", "flux:2K", "nano-banana-pro:4K", "ideogram:TURBO"
 *
 * For image models, uses quality/resolution/renderingSpeed.
 * For video models, uses duration/sound params when the model has variable pricing.
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

/**
 * Compute composite model identifier for video models with duration/audio-based pricing.
 * Examples: "kling-3.0:5s", "kling-3.0:10s:audio"
 *
 * @param provider - Video model key (e.g., "kling-3.0")
 * @param duration - Video duration in seconds
 * @param sound - Whether audio/sound is enabled
 */
export function buildVideoCreditModelIdentifier(
  provider: string,
  duration?: number | string,
  sound?: boolean,
): string {
  if (!DURATION_PRICED_PROVIDERS.has(provider)) {
    return provider
  }

  const durationSec = typeof duration === "string" ? parseInt(duration, 10) : (duration ?? 5)
  const tiers = VIDEO_DURATION_TIERS[provider]
  if (!tiers) return provider

  // Find the matching duration tier
  const tier = tiers.find(t => durationSec <= t.maxSeconds) ?? tiers[tiers.length - 1]
  let identifier = `${provider}:${tier.suffix}`

  // Append audio suffix if applicable
  if (AUDIO_ADDON_PROVIDERS.has(provider) && sound) {
    identifier += ":audio"
  }

  return identifier
}
