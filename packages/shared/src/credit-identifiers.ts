/**
 * Build composite credit model identifiers for variable pricing.
 * Shared between frontend and backend.
 */

import {
  HIGH_QUALITY_PROVIDERS,
  TWO_K_RESOLUTION_PROVIDERS,
  RESOLUTION_2K_4K_TIERED_PROVIDERS,
  IDEOGRAM_PROVIDERS,
  DURATION_PRICED_PROVIDERS,
  AUDIO_ADDON_PROVIDERS,
  MODE_ADDON_PROVIDERS,
  RESOLUTION_VIDEO_REF_PRICING,
  RESOLUTION_DURATION_PRICING,
  VEO_RESOLUTION_TIERED_PROVIDERS,
  VIDEO_DURATION_TIERS,
  MOTION_DURATION_TIERS,
  T2I_TO_I2I_VARIANT,
  isVeoProvider,
} from "./model-constants.js"
import { isFlux2Model } from "./flux2-pricing.js"
import { MODEL_CATALOG } from "./model-catalog.js"

/**
 * Compute composite model identifier for variable credit pricing.
 * Examples: "gpt-image:high", "flux:2K", "nano-banana-pro:4K", "ideogram:TURBO",
 *           "flux-2-pro:2MP", "flux-2-max:2MP:1ref" (Flux 2 — billed per megapixel).
 *
 * For image models, uses quality/resolution/renderingSpeed and (Flux 2) the output
 * megapixel count plus (Flux 2 Max) the number of reference images attached at request time.
 * For video models, uses duration/sound params when the model has variable pricing.
 */
export function buildCreditModelIdentifier(
  provider: string,
  quality?: string,
  resolution?: string,
  renderingSpeed?: string,
  targetResolution?: string,
  referenceImageCount?: number,
): string {
  // Flux 2 family: billed per output megapixel AND per reference image (each
  // ref counts as input megapixels). Resolution arrives as "N MP" strings (the
  // UI value space); strip the unit. ALL three models encode the ref count
  // (capped at 8): Pro/Klein i2i always carry the source image as a ref and
  // their cost formula charges per input MP, so the reserved identifier must
  // reflect refs (there is no metered true-up to correct an under-reserved tier).
  if (isFlux2Model(provider)) {
    const mp = (resolution ?? "1 MP").replace(/\s*MP$/i, "").trim()
    return `${provider}:${mp}MP:${Math.min(referenceImageCount ?? 0, 8)}ref`
  }
  if (HIGH_QUALITY_PROVIDERS.has(provider) && quality === "high") {
    return `${provider}:high`
  }
  if (TWO_K_RESOLUTION_PROVIDERS.has(provider) && resolution === "2K") {
    return `${provider}:2K`
  }
  if (provider === "nano-banana-pro" && resolution === "4K") {
    return `${provider}:4K`
  }
  if (RESOLUTION_2K_4K_TIERED_PROVIDERS.has(provider) && (resolution === "2K" || resolution === "4K")) {
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

/**
 * Reference-aware image-generation credit identifier — the SINGLE source of
 * truth shared by the single-node routes (`/v1/generate-image`,
 * `/v1/image-to-image`) and the workflow orchestrator
 * (`payload-builder.ts`). It centralises the two pricing dimensions that must
 * match across both paths or a Flux 2 generation is billed the wrong tier
 * (Flux 2 commits non-metered / has no upward true-up, so the reserved
 * identifier IS the final charge):
 *   - `refCount`: the number of reference images sent to the provider (Flux 2
 *     bills per ref). generate-image passes the assembled count (0 for pure
 *     text-to-image); image-to-image passes 1 (the primary `imageUrl`) + extras.
 *   - `swapToI2i`: generate-image auto-swaps a bare T2I provider to its i2i
 *     sibling (`T2I_TO_I2I_VARIANT`) when refs are attached, so the credit id
 *     matches the variant actually invoked. image-to-image is already an i2i
 *     provider → pass `false`.
 *
 * The LoRA short-circuit (`flux-lora-character`) stays at the call site because
 * the routing decision needs a DB lookup the routes/orchestrator own.
 */
export function resolveImageGenCreditIdentifier(opts: {
  provider: string | undefined
  quality?: string
  resolution?: string
  renderingSpeed?: string
  refCount: number
  swapToI2i?: boolean
}): string {
  const provider = opts.provider || "nano-banana"
  const effectiveProvider =
    opts.swapToI2i && opts.refCount > 0 ? (T2I_TO_I2I_VARIANT[provider] ?? provider) : provider
  return buildCreditModelIdentifier(
    effectiveProvider,
    opts.quality,
    opts.resolution,
    opts.renderingSpeed,
    undefined,
    opts.refCount,
  )
}

// T2V-specific credit overrides: some providers have different costs for T2V
// vs I2V/V2V due to different default resolutions or colliding with image model names.
const T2V_CREDIT_OVERRIDES: Record<string, string> = {
  "grok": "grok-i2v",           // T2V grok, same as I2V grok (not image grok = 4 cr)
  "wan": "wan-t2v",             // T2V wan 1080p = (V2V wan 720p = 70 cr)
  "wan-turbo": "wan-turbo-t2v", // T2V wan-turbo 720p = (I2V wan-turbo 480p = 40 cr)
}

/**
 * Compute composite model identifier for video models with duration/audio-based pricing.
 * Examples: "kling-3.0:5s", "kling-3.0:10s:audio", "seedance-2:8s:720p-ref"
 *
 * @param provider - Video model key (e.g., "kling-3.0")
 * @param duration - Video duration in seconds
 * @param sound - Whether audio/sound is enabled
 * @param nodeType - Node type for T2V-specific cost overrides
 * @param mode - Quality variant that affects pricing
 * @param resolution - Output resolution (used by Seedance 2 for 480p/720p pricing)
 * @param hasVideoRef - Whether a reference video is connected (Seedance 2 uses a lower per-second rate when true)
 */
/** Gemini Omni Video duration tiers (seconds). Mirrors `MODEL_CATALOG["gemini-omni-video"].durations`
 *  and `KIE_VIDEO_MODELS["gemini-omni-video"].allowedDurations`. Hoisted to module scope so the
 *  nearest-tier snap below doesn't reallocate on every (hot-path) call. */
const GEMINI_OMNI_DURATIONS = [4, 6, 8, 10]

/**
 * LTX 2.3 (Lightricks via Replicate) credit tiers: priced by
 * (resolution-band × duration-seconds). Keys mirror STATIC_CREDIT_COSTS /
 * model_pricing EXACTLY (lowercase band + raw seconds + "s"), e.g.
 * "ltx-2.3-pro:1080p:6s". This map is the source of truth for the nearest-tier
 * snap below, so an off-catalog (resolution, duration) from a direct API/SDK
 * call maps to a SEEDED price instead of hard-failing (price_not_configured
 * 503). Pro: 6/8/10s at every band. Fast: up to 20s at 1080p, 6/8/10s at 2k/4k.
 */
const LTX_DURATION_TIERS: Record<string, Record<string, number[]>> = {
  "ltx-2.3-pro": { "1080p": [6, 8, 10], "2k": [6, 8, 10], "4k": [6, 8, 10] },
  "ltx-2.3-fast": { "1080p": [6, 8, 10, 12, 14, 16, 18, 20], "2k": [6, 8, 10], "4k": [6, 8, 10] },
}

export function buildVideoCreditModelIdentifier(
  provider: string,
  duration?: number | string,
  sound?: boolean,
  nodeType?: "image-to-video" | "text-to-video",
  mode?: string,
  resolution?: string,
  hasVideoRef?: boolean,
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

  // VEO 3.x resolution-tiered pricing: 720p is the base (no suffix), 1080p gets
  // ":1080p" (Fast/Lite only), and 4K gets ":4k" for ALL three tiers — direct-4K
  // generation chains KIE's get-4k-video off the base generation (the base runs
  // at 1080p). Duration is fixed at 8s for VEO so the duration-tier path below
  // does not apply.
  if (isVeoProvider(effectiveProvider)) {
    if (resolution === "4k") return `${effectiveProvider}:4k`
    // 1080p tier is Fast/Lite only (Quality has no 1080p surcharge).
    if (resolution === "1080p" && VEO_RESOLUTION_TIERED_PROVIDERS.has(effectiveProvider)) return `${effectiveProvider}:1080p`
    return effectiveProvider
  }

  // Gemini Omni Video: priced by (resolution-band × duration), with a flat
  // per-generation rate when a source video is supplied (V2V). Lowercase "4k".
  if (effectiveProvider === "gemini-omni-video") {
    if (hasVideoRef) {
      return resolution === "4k" ? "gemini-omni-video:4k:vref" : "gemini-omni-video:vref"
    }
    // Snap to nearest allowed tier (NOT a min/max clamp) so off-tier durations
    // map to a SEEDED composite; default 8 when unset.
    const raw = parseInt(String(duration ?? 8), 10)
    const d = Number.isNaN(raw) ? 8 : GEMINI_OMNI_DURATIONS.reduce((b, a) => (Math.abs(a - raw) < Math.abs(b - raw) ? a : b))
    return resolution === "4k" ? `gemini-omni-video:4k:${d}` : `gemini-omni-video:${d}`
  }

  // LTX 2.3: priced by (resolution-band × duration-seconds). The RESERVE must be
  // the correct composite — commit_credits (migration 176) only refunds a surplus
  // (actual < reserved) and NEVER collects an upward delta, so an under-reserved
  // LTX run (the bare-id default = cheapest 1080p:6s tier) stays under-charged
  // even with meteredCost:true. Snap to a seeded tier so the id always prices.
  if (effectiveProvider === "ltx-2.3-pro" || effectiveProvider === "ltx-2.3-fast") {
    const bands = LTX_DURATION_TIERS[effectiveProvider]
    const band = bands[String(resolution)] ? String(resolution) : "1080p"
    const allowed = bands[band]
    const raw = typeof duration === "string" ? parseInt(duration, 10) : (duration ?? allowed[0])
    const want = Number.isNaN(raw) ? allowed[0] : raw
    const dur = allowed.reduce((b, a) => (Math.abs(a - want) < Math.abs(b - want) ? a : b))
    return `${effectiveProvider}:${band}:${dur}s`
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

  // Seedance 2.0 family: per-second billing with resolution + video-ref dimensions.
  // KIE accepts 480p / 720p / 1080p natively; per-second rates rise non-linearly
  // so each tier gets its own composite identifier.
  if (RESOLUTION_VIDEO_REF_PRICING.has(effectiveProvider)) {
    // Clamp to the model's catalog resolutions (single source of truth): e.g.
    // seedance-2-mini exposes only 480p/720p, so a stale/explicit 1080p (or 4k)
    // maps to its top priced tier instead of emitting an unpriced composite
    // (which the hard-fail credit guard would 503 on at runtime).
    const supported = MODEL_CATALOG[effectiveProvider]?.resolutions ?? ["480p", "720p", "1080p"]
    const want = resolution === "4k" ? "4k" : resolution === "1080p" ? "1080p" : resolution === "720p" ? "720p" : "480p"
    // Unsupported (e.g. a stale 1080p on seedance-2-mini) clamps to the model's
    // top priced tier so the emitted composite is always seeded.
    const res = supported.includes(want) ? want : (supported[supported.length - 1] ?? "480p")
    identifier += `:${res}`
    if (hasVideoRef) identifier += "-ref"
  }

  // Duration × resolution pricing without a -ref dimension. Resolutions
  // outside the provider's priced tiers (or undefined) collapse to the first
  // (default) tier so the emitted composite is always seeded — the hard-fail
  // guard fuzzes the whole resolution space.
  const resTiers = RESOLUTION_DURATION_PRICING[effectiveProvider]
  if (resTiers) {
    const res = resolution && resTiers.includes(resolution) ? resolution : resTiers[0]!
    identifier += `:${res}`
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
