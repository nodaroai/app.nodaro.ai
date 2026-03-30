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
  MODE_ADDON_PROVIDERS,
  VIDEO_DURATION_TIERS,
  MOTION_DURATION_TIERS,
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
  targetResolution?: string,
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
  // Topaz Image Upscale: 2K is default (no suffix), 4K/8K get composite identifiers
  if (provider === "topaz-image-upscale" && targetResolution && targetResolution !== "2K") {
    return `${provider}:${targetResolution}`
  }
  if (IDEOGRAM_PROVIDERS.has(provider)) {
    if (renderingSpeed === "TURBO") return `${provider}:TURBO`
    if (renderingSpeed === "QUALITY") return `${provider}:QUALITY`
  }
  return provider
}

// T2V-specific credit overrides: some providers have different costs for T2V
// vs I2V/V2V due to different default resolutions or colliding with image model names.
const T2V_CREDIT_OVERRIDES: Record<string, string> = {
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
  ***REDACTED-OSS-SCRUB***
}

/**
 * Compute composite model identifier for video models with duration/audio-based pricing.
 * Examples: "kling-3.0:5s", "kling-3.0:10s:audio"
 *
 * @param provider - Video model key (e.g., "kling-3.0")
 * @param duration - Video duration in seconds
 * @param sound - Whether audio/sound is enabled
 * @param nodeType - Node type for T2V-specific cost overrides
 * @param mode - Quality variant that affects pricing
 */
export function buildVideoCreditModelIdentifier(
  provider: string,
  duration?: number | string,
  sound?: boolean,
  nodeType?: "image-to-video" | "text-to-video",
  mode?: string,
): string {
  // T2V overrides: some providers have different base costs for text-to-video
  let effectiveProvider = provider
  if (nodeType === "text-to-video") {
    const override = T2V_CREDIT_OVERRIDES[provider]
    if (override) {
      // If override target also has duration pricing, use it as effective provider
      if (DURATION_PRICED_PROVIDERS.has(override)) {
        effectiveProvider = override
      } else {
        return override
      }
    }
  }

  if (!DURATION_PRICED_PROVIDERS.has(effectiveProvider)) {
    return effectiveProvider
  }

  const parsed = typeof duration === "string" ? parseInt(duration, 10) : (duration ?? 5)
  const durationSec = Number.isNaN(parsed) ? 5 : parsed
  const tiers = VIDEO_DURATION_TIERS[effectiveProvider]
  if (!tiers) return effectiveProvider

  // Find the matching duration tier
  const tier = tiers.find(t => durationSec <= t.maxSeconds) ?? tiers[tiers.length - 1]
  let identifier = `${effectiveProvider}:${tier.suffix}`

  // Append audio suffix if applicable
  if (AUDIO_ADDON_PROVIDERS.has(effectiveProvider) && sound) {
    identifier += ":audio"
  }

  // Append mode suffix for providers with quality-tiered pricing
  // "high" comes from I2V videoSize field, "pro" comes from T2V mode field
  if (MODE_ADDON_PROVIDERS.has(effectiveProvider) && (mode === "high" || mode === "pro")) {
    identifier += ":high"
  }

  return identifier
}

/**
 * Compute composite model identifier for motion control with duration-tiered pricing.
 * Examples: "kling-3.0-motion:10s", "kling-3.0-motion:1080p:15s", "motion-transfer:5s"
 *
 * Wan Animate providers use resolution-tiered pricing (not per-second):
 * "wan-animate-move" (480p default), "wan-animate-move:580p", "wan-animate-move:720p"
 *
 * @param provider - Motion control provider key ("kling" for 2.6, "kling-3.0", "wan-animate-move", "wan-animate-replace")
 * @param resolution - "720p" or "1080p" (Kling), "480p" or "580p" or "720p" (Wan Animate)
 * @param videoDuration - Reference video duration in seconds (defaults to 10s, unused for Wan Animate)
 */
export function buildMotionCreditModelIdentifier(
  provider: string,
  resolution: string,
  videoDuration?: number,
): string {
  // Wan Animate providers use resolution-tiered pricing (not duration-based)
  if (provider === "wan-animate-move" || provider === "wan-animate-replace") {
    // 480p is the default (base identifier), 580p and 720p get composite suffix
    if (resolution === "580p" || resolution === "720p") {
      return `${provider}:${resolution}`
    }
    return provider
  }

  const raw = videoDuration ?? 10
  const durationSec = Math.floor(Number.isNaN(raw) ? 10 : raw) // default 10s; floor to match KIE per-second billing
  const tier = MOTION_DURATION_TIERS.find(t => durationSec <= t.maxSeconds)
    ?? MOTION_DURATION_TIERS[MOTION_DURATION_TIERS.length - 1]

  const base = provider === "kling-3.0" ? "kling-3.0-motion" : "motion-transfer"
  const resSuffix = resolution === "1080p" ? ":1080p" : ""
  return `${base}${resSuffix}:${tier.suffix}`
}
