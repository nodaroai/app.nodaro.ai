import type { ImageGenProvider, ImageI2IProvider, ImageToVideoProvider, LipSyncProvider, MotionTransferProviderType, TextToVideoProvider, VideoGenProvider, VideoToVideoProvider } from "@nodaro/shared"
import {
  aspectRatioOptionsByKind,
  resolutionOptionsByKind,
  qualityOptionsByKind,
  durationsByMode,
  creditRangesAll,
  modelsWithFeature,
  isFlux2Model,
  VIDEO_GEN_COLLAPSED_T2V_IDS,
  type LabeledOption,
} from "@nodaro/shared"

export const IMAGE_GEN_MODELS: readonly { value: ImageGenProvider; label: string; desc: string }[] = [
  { value: "flux", label: "Flux", desc: "Photorealistic, highest quality output" },
  { value: "flux-flex", label: "Flux Flex", desc: "Flexible Flux, fast generation" },
  { value: "flux-kontext", label: "Flux Kontext", desc: "Context-aware generation and editing" },
  { value: "flux-kontext-max", label: "Flux Kontext Max", desc: "Highest quality Kontext generation" },
  { value: "gpt-image", label: "GPT Image", desc: "Text rendering, complex compositions" },
  { value: "gpt-image-2", label: "GPT Image 2", desc: "Latest GPT Image, sharper text + photorealism, up to 4K" },
  { value: "grok", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "ideogram-v3", label: "Ideogram V3", desc: "Fast text-to-image, affordable" },
  { value: "imagen4", label: "Imagen 4", desc: "Google's latest, strong prompt adherence" },
  { value: "imagen4-fast", label: "Imagen 4 Fast", desc: "Fast Imagen, lower latency" },
  { value: "imagen4-ultra", label: "Imagen 4 Ultra", desc: "Highest quality Google image gen" },
  { value: "nano-banana", label: "Nano Banana", desc: "Fast drafts, iteration, storyboards" },
  { value: "nano-banana-2", label: "Nano Banana 2", desc: "Updated Nano Banana with web grounding" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production-ready images" },
  { value: "qwen", label: "Qwen", desc: "Versatile, good at diverse styles" },
  { value: "seedream", label: "Seedream", desc: "Photorealistic, high detail" },
  { value: "seedream-5-lite", label: "Seedream 5 Lite", desc: "Latest Seedream, fast and sharp" },
  { value: "z-image", label: "Z-Image", desc: "Fast, lightweight generation" },
  { value: "wan-2.7",     label: "Wan 2.7",     desc: "T2I, 1K/2K/4K, up to 9 ref images" },
  { value: "wan-2.7-pro", label: "Wan 2.7 Pro", desc: "Higher quality T2I, 1K/2K/4K" },
  { value: "flux-2-klein", label: "Flux 2 Klein (Open)", desc: "BFL Flux 2 9B via Replicate — fast, no safety filter" },
  { value: "flux-2-pro", label: "Flux 2 Pro (Safety Tolerance)", desc: "BFL Flux 2 Pro via Replicate — flagship quality, safety_tolerance=5 (max for Pro)" },
  { value: "flux-2-max", label: "Flux 2 Max (Safety Tolerance)", desc: "BFL Flux 2 Max via Replicate — even larger sibling, up to 8 refs, safety_tolerance=5 (variable pricing: 2-62 cr)" },
]

export const IMAGE_GEN_MODEL_IDS = IMAGE_GEN_MODELS.map(m => m.value)

export const IMAGE_I2I_MODELS: readonly { value: ImageI2IProvider; label: string; desc: string }[] = [
  { value: "flux-i2i", label: "Flux-2", desc: "Style-faithful transformations" },
  { value: "flux-pro-i2i", label: "Flux-2 Pro", desc: "Premium quality image transforms" },
  { value: "flux-kontext", label: "Flux Kontext", desc: "Context-aware editing via Kontext" },
  { value: "flux-kontext-max", label: "Flux Kontext Max", desc: "Highest quality Kontext editing" },
  { value: "gpt-image-i2i", label: "GPT Image", desc: "Text rendering, complex compositions" },
  { value: "gpt-image-2-i2i", label: "GPT Image 2", desc: "Latest GPT Image, sharper text + photorealism, up to 4K" },
  { value: "grok-i2i", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "ideogram-edit", label: "Ideogram Edit", desc: "AI-guided image editing" },
  { value: "ideogram-reframe", label: "Ideogram Reframe", desc: "Change aspect ratio intelligently" },
  { value: "ideogram-remix", label: "Ideogram Remix", desc: "Restyle with character consistency" },
  { value: "nano-banana", label: "Nano Banana", desc: "Fast iteration, quick transforms" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production images" },
  { value: "qwen-i2i", label: "Qwen", desc: "Versatile image transformation" },
  { value: "qwen-edit", label: "Qwen Edit", desc: "Targeted image editing" },
  { value: "seedream-5-lite-i2i", label: "Seedream 5 Lite", desc: "Latest Seedream image-to-image" },
  { value: "seedream-edit", label: "Seedream Edit", desc: "Photorealistic image editing" },
  { value: "kontext-multi", label: "Kontext Multi (Open)", desc: "Multi-image Flux Kontext via Replicate — up to 4 refs, no safety filter" },
  { value: "flux-2-pro", label: "Flux 2 Pro (Safety Tolerance)", desc: "BFL Flux 2 Pro via Replicate — flagship quality, safety_tolerance=5" },
  { value: "flux-2-max", label: "Flux 2 Max (Safety Tolerance)", desc: "BFL Flux 2 Max via Replicate — up to 8 refs, safety_tolerance=5 (variable pricing: 2-62 cr)" },
]

export const IMAGE_EDIT_MODELS = [
  { value: "nano-banana-edit", label: "Nano Banana Edit", desc: "Context-aware image editing with prompt" },
  { value: "recraft-remove-bg", label: "Recraft Remove BG", desc: "Remove background, transparent PNG output" },
  { value: "recraft-upscale", label: "Recraft Upscale", desc: "AI-powered upscaling and enhancement" },
  { value: "topaz-image-upscale", label: "Topaz Upscale", desc: "Advanced upscaling with configurable factor" },
] as const

export const MODIFY_IMAGE_MODELS = [
  ...IMAGE_I2I_MODELS,
  { value: "nano-banana-edit", label: "Nano Banana Edit", description: "AI-powered image editing with instructions" },
]

export const UPSCALE_IMAGE_MODELS = [
  { value: "recraft-upscale", label: "Recraft Upscale", description: "Fast, high-quality upscaling" },
  { value: "topaz-image-upscale", label: "Topaz Upscale", description: "Premium AI upscaling with resolution control" },
]

export const VIDEO_I2V_MODELS = [
  { value: "bytedance-lite", label: "Bytedance Lite", desc: "Light, fast, end frame support" },
  { value: "bytedance-pro", label: "Bytedance Pro", desc: "Higher quality Bytedance" },
  { value: "bytedance-pro-fast", label: "Bytedance Pro Fast", desc: "Fast pro generation" },
  { value: "grok-i2v", label: "Grok Imagine 1", desc: "Creative, stylized motion" },
  { value: "hailuo-2.3", label: "Hailuo 2.3", desc: "Latest Hailuo, 6-10s standard" },
  { value: "hailuo-2.3-pro", label: "Hailuo 2.3 Pro", desc: "Latest Hailuo, 6-10s pro quality" },
  { value: "hailuo-standard", label: "Hailuo Standard", desc: "Hailuo 02, end frame support" },
  { value: "kling", label: "Kling", desc: "Versatile, 5-10s clips" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Latest Kling, 3-15s variable duration" },
  { value: "kling-master", label: "Kling Master", desc: "Kling V2.1 Master, high quality" },
  { value: "kling-turbo", label: "Kling Turbo", desc: "Fast generation, end frame support" },
  { value: "minimax", label: "MiniMax", desc: "Fast, reliable 5s clips" },
  { value: "runway-kie", label: "Runway", desc: "Runway Gen-3, 5-10s, 720p/1080p" },
  { value: "seedance", label: "Seedance 1.5", desc: "Bytedance, 4-12s, audio generation" },
  { value: "seedance-2", label: "Seedance 2.0", desc: "Bytedance, 4-15s, multimodal references" },
  { value: "seedance-2-fast", label: "Seedance 2.0 Fast", desc: "Bytedance Fast, 4-15s, multimodal references" },
  { value: "veo3", label: "VEO 3.1 (Quality)", desc: "Top quality, 4/6/8s with audio" },
  { value: "veo3.1", label: "VEO 3.1 (Fast)", desc: "Fast VEO, 4/6/8s with audio" },
  { value: "veo3_lite", label: "VEO 3.1 (Lite)", desc: "Cheapest VEO tier, 4/6/8s with audio" },
  { value: "wan-i2v", label: "Wan 2.6", desc: "Wan I2V, 5-15s, resolution options" },
  { value: "wan-turbo", label: "Wan Turbo", desc: "Fast Wan, 5s clips" },
  { value: "wan-2.7-i2v",    label: "Wan 2.7",            desc: "Wan 2.7 I2V, 2–15s, 720p/1080p, start+end frame" },
  { value: "happyhorse-i2v",  label: "HappyHorse I2V",    desc: "3–15s, 720p/1080p, single start frame" },
  { value: "happyhorse-ref2v", label: "HappyHorse Ref2V", desc: "1–9 reference images to video, 3–15s" },
  { value: "kling-3-omni", label: "Kling 3 Omni", desc: "Replicate, 3–15s, 720p/1080p, end frame + up to 7 reference images" },
  { value: "ltx-2.3-pro", label: "LTX 2.3 Pro", desc: "Lightricks LTX 2.3 Pro — text/image/audio→video, up to 4K" },
  { value: "ltx-2.3-fast", label: "LTX 2.3 Fast", desc: "Lightricks LTX 2.3 Fast — text/image→video, durations up to 20s" },
  { value: "gemini-omni-video", label: "Gemini Omni", desc: "Google, 4–10s, 720p/1080p/4K, native audio, refs + video-edit" },
  { value: "grok-imagine-video-1.5", label: "Grok Imagine 1.5", desc: "xAI Grok, 1–15s, 480p/720p, per-second pricing" },
]

export const VIDEO_T2V_MODELS: readonly { value: TextToVideoProvider; label: string; desc: string }[] = [
  { value: "bytedance-lite", label: "Bytedance Lite", desc: "Fast, 5-10s" },
  { value: "bytedance-pro", label: "Bytedance Pro", desc: "High quality, 5-10s" },
  { value: "grok", label: "Grok Imagine 1", desc: "Creative, stylized motion" },
  { value: "kling", label: "Kling", desc: "Versatile, 5-10s clips" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Latest Kling, 3-15s variable duration" },
  { value: "kling-turbo", label: "Kling Turbo", desc: "Fast generation, 5-10s" },
  { value: "minimax", label: "MiniMax", desc: "Fast, reliable 5s clips" },
  { value: "hailuo-standard", label: "MiniMax Standard", desc: "Budget Hailuo, 6-10s" },
  { value: "runway-kie", label: "Runway", desc: "Runway Gen-3, 5-10s, 720p/1080p" },
  { value: "seedance", label: "Seedance 1.5", desc: "Bytedance, 4-12s with audio option" },
  { value: "seedance-2", label: "Seedance 2.0", desc: "Bytedance, 4-15s, multimodal references" },
  { value: "seedance-2-fast", label: "Seedance 2.0 Fast", desc: "Bytedance Fast, 4-15s, multimodal references" },
  { value: "veo3", label: "VEO 3.1 (Quality)", desc: "Top quality, 4/6/8s with audio" },
  { value: "veo3.1", label: "VEO 3.1 (Fast)", desc: "Fast VEO, 4/6/8s with audio" },
  { value: "veo3_lite", label: "VEO 3.1 (Lite)", desc: "Cheapest VEO tier, 4/6/8s with audio" },
  { value: "wan", label: "Wan 2.6", desc: "High quality, 5-15s, 1080p" },
  { value: "wan-turbo", label: "Wan Turbo", desc: "Fast generation, 5s clips" },
  { value: "wan-2.7-t2v", label: "Wan 2.7",    desc: "Wan 2.7 T2V, 2–15s, 720p/1080p" },
  { value: "happyhorse",   label: "HappyHorse", desc: "3–15s, 720p/1080p" },
  { value: "ltx-2.3-pro", label: "LTX 2.3 Pro", desc: "Lightricks LTX 2.3 Pro — text/image/audio→video, up to 4K" },
  { value: "ltx-2.3-fast", label: "LTX 2.3 Fast", desc: "Lightricks LTX 2.3 Fast — text/image→video, durations up to 20s" },
  { value: "gemini-omni-video", label: "Gemini Omni", desc: "Google, 4–10s, 720p/1080p/4K, native audio, refs + video-edit" },
  { value: "grok-imagine-video-1.5", label: "Grok Imagine 1.5", desc: "xAI Grok, 1–15s, 480p/720p (image required)" },
]

/** Unified generate-video model list — VIDEO_I2V_MODELS ∪ VIDEO_T2V_MODELS,
 *  deduplicated by id. The generate-video node accepts either an upstream
 *  image (i2v path) or pure text (t2v path) per provider's modes, so the
 *  picker exposes every provider that participates in at least one mode.
 *  I2V entries win on collision because their label/desc is the more
 *  general "image-or-text" descriptor in most cases.
 *
 *  Split-id models (Grok Imagine 1, Wan 2.6, Wan 2.7) expose one id per mode
 *  but are ONE user-facing model. We hide the t2v twin (VIDEO_GEN_COLLAPSED_T2V_IDS)
 *  so the picker shows a single row; execution remaps base→mode id by image
 *  presence via resolveVideoProviderForMode (shared). Single source of truth. */
export const VIDEO_GEN_MODELS: readonly { value: VideoGenProvider; label: string; desc: string }[] =
  (() => {
    const seen = new Set<string>()
    const out: { value: VideoGenProvider; label: string; desc: string }[] = []
    for (const m of [...VIDEO_I2V_MODELS, ...VIDEO_T2V_MODELS]) {
      if (seen.has(m.value)) continue
      if (VIDEO_GEN_COLLAPSED_T2V_IDS.has(m.value)) continue
      seen.add(m.value)
      out.push(m as { value: VideoGenProvider; label: string; desc: string })
    }
    return out
  })()

export const VIDEO_V2V_MODELS: readonly { value: VideoToVideoProvider; label: string; desc: string }[] = [
  { value: "luma-modify", label: "Luma Modify", desc: "Luma video modification" },
  { value: "runway-aleph", label: "Runway Aleph", desc: "Runway AI video-to-video conversion" },
  { value: "happyhorse-edit", label: "HappyHorse Edit", desc: "Video-to-video editing, up to 60s input" },
  { value: "wan-videoedit", label: "Wan 2.7 VideoEdit", desc: "Guided video editing with reference image support" },
  { value: "wan", label: "Wan 2.6", desc: "High quality video-to-video" },
  { value: "wan-flash", label: "Wan 2.6 Flash", desc: "Fast V2V with audio & multi-shot" },
]

export const EXTEND_VIDEO_MODELS = [
  { value: "runway-extend", label: "Runway Extend" },
  { value: "veo-extend", label: "VEO Extend" },
  { value: "ltx-2.3-pro", label: "LTX 2.3 Pro" },
] as const

export const V2V_DURATION_OPTIONS = [
  { value: "5", label: "5 seconds" },
  { value: "10", label: "10 seconds" },
] as const

export const V2V_RESOLUTION_OPTIONS = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
] as const

export const V2V_ALEPH_ASPECT_RATIOS = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "1:1", label: "1:1" },
  { value: "21:9", label: "21:9" },
] as const

// =============================================================================
// VARIABLE CREDIT RANGES — derived from MODEL_CATALOG.pricing[]
// Models with variable pricing (quality/resolution) show "min-max CR" instead of a single value.
// =============================================================================

export const MODEL_CREDIT_RANGES: Record<string, { min: number; max: number }> =
  creditRangesAll()

/** Formats the credit badge shown on a model dropdown row. Variable-priced
 *  models render a "min-max CR" range; fixed-price models render "N CR";
 *  zero/unknown cost (e.g. community edition where `useModelCredits` returns 0)
 *  renders no badge. Shared by `ModelSelectOption` (Radix Select rows) and
 *  `ModelSearchSelect`'s cmdk rows so the rule lives in one place.
 *  `credits` is the resolved value from the `useModelCredits` hook — passed in
 *  because this is a plain function, not a component. */
export function formatCreditBadge(value: string, credits: number): string | undefined {
  const range = MODEL_CREDIT_RANGES[value]
  if (range) return `${range.min}-${range.max} CR`
  if (credits > 0) return `${credits} CR`
  return undefined
}

// =============================================================================
// IMAGE MODEL ASPECT RATIOS — derived from MODEL_CATALOG (single source of
// truth). When you add a new model, update its `aspectRatios` in
// `packages/shared/src/model-catalog.ts` and both this map AND the MCP
// `list_models` output update automatically.
// =============================================================================
const DEFAULT_RATIOS: readonly LabeledOption[] = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
] as const

export const IMAGE_ASPECT_RATIOS: Record<string, readonly LabeledOption[]> =
  aspectRatioOptionsByKind("image")

export function getAspectRatiosForModel(provider: string): readonly LabeledOption[] {
  return IMAGE_ASPECT_RATIOS[provider] ?? DEFAULT_RATIOS
}

// =============================================================================
// VIDEO / COMPOSITION ASPECT RATIO PRESETS
// =============================================================================
export const VIDEO_RATIOS = [
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "1:1", label: "1:1 (Square)" },
] as const

export const COMPOSITION_RATIOS = [
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "1:1", label: "1:1 (Square)" },
  { value: "4:5", label: "4:5 (Social)" },
] as const

// Image resolutions — derived from MODEL_CATALOG. Add new entries to the
// catalog's `resolutions` field, not here.
export const IMAGE_RESOLUTION_OPTIONS: Record<string, readonly LabeledOption[]> =
  resolutionOptionsByKind("image")

// Topaz image upscale isn't generation — it's a post-processing utility — so
// its resolution dropdown lives separately. Derived from the catalog so it
// stays in sync with the pricing tiers.
export const TOPAZ_IMAGE_RESOLUTIONS: readonly LabeledOption[] =
  IMAGE_RESOLUTION_OPTIONS["topaz-image-upscale"] ?? [
    { value: "2K", label: "2K (Standard)" },
    { value: "4K", label: "4K (High)" },
    { value: "8K", label: "8K (Ultra)" },
  ]

// =============================================================================
// VIDEO MODEL RESOLUTIONS — derived from MODEL_CATALOG.
// Providers with no entry have no resolution lever — `data.resolution` should
// be cleared when the user lands on them so backend Zod doesn't see stale
// values. Hailuo's "1080P (6s max)" decoration lives on the catalog entry's
// `valueLabels` field. Case-sensitive: hailuo uses uppercase ("768P",
// "1080P"), everything else is lowercase ("720p", "1080p").
// =============================================================================
export const VIDEO_RESOLUTION_OPTIONS: Record<string, readonly LabeledOption[]> = {
  ...resolutionOptionsByKind("video"),
  // LTX 2.3 — Lightricks via Replicate. Not yet in MODEL_CATALOG, so the
  // option lists are spliced in here. Both Pro and Fast support 1080p/2K/4K.
  "ltx-2.3-pro": [
    { value: "1080p", label: "1080p" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
  ],
  "ltx-2.3-fast": [
    { value: "1080p", label: "1080p" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
  ],
}

export function getVideoResolutionOptions(
  provider: string,
): readonly LabeledOption[] | undefined {
  return VIDEO_RESOLUTION_OPTIONS[provider]
}

// =============================================================================
// VIDEO MODEL DURATIONS — derived from MODEL_CATALOG via durationsByMode().
// Merges i2v + t2v durations per provider so the generate-video node can
// expose the full union (a provider that supports both modes uses the same
// duration list under one id). Labels are "Ns" suffix; the catalog stores
// raw numbers. Single source of truth — add a new provider's durations to
// `packages/shared/src/model-catalog.ts` and both the dropdown and the
// audit tooling pick it up.
// =============================================================================
const _I2V_DURATIONS = durationsByMode("i2v")
const _T2V_DURATIONS = durationsByMode("t2v")

export const VIDEO_DURATION_OPTIONS: Record<string, ReadonlyArray<{ value: number; label: string }>> =
  (() => {
    const ids = new Set<string>([
      ...Object.keys(_I2V_DURATIONS),
      ...Object.keys(_T2V_DURATIONS),
    ])
    const out: Record<string, ReadonlyArray<{ value: number; label: string }>> = {}
    for (const id of ids) {
      const merged = new Set<number>([
        ...(_I2V_DURATIONS[id] ?? []),
        ...(_T2V_DURATIONS[id] ?? []),
      ])
      const sorted = Array.from(merged).sort((a, b) => a - b)
      if (sorted.length > 0) {
        out[id] = sorted.map((n) => ({ value: n, label: `${n}s` }))
      }
    }
    // LTX 2.3 — Lightricks via Replicate. Not yet in MODEL_CATALOG, so the
    // duration menus are spliced in here. Pro caps at 10s; Fast goes to 20s.
    // The "Fast >10s implies 1080p / 24-25fps only" constraint is enforced by
    // the config panel's snap-stale useEffect, not by this list.
    out["ltx-2.3-pro"] = [6, 8, 10].map((n) => ({ value: n, label: `${n}s` }))
    out["ltx-2.3-fast"] = [6, 8, 10, 12, 14, 16, 18, 20].map((n) => ({ value: n, label: `${n}s` }))
    // Grok t2v alias — KIE_T2V_DURATIONS keys grok image-mode under "grok" but
    // MODEL_CATALOG only tracks the i2v durations under "grok-i2v". Mirror the
    // alias here so the legacy TextToVideoConfig snap-stale effect doesn't
    // silently skip when reading VIDEO_DURATION_OPTIONS["grok"].
    if (!out["grok"] && out["grok-i2v"]) {
      out["grok"] = out["grok-i2v"]
    }
    return out
  })()

/** Duration `{value, label}` options for a video model. Returns `[]` for
 *  providers without a duration lever (fixed-duration models that derive
 *  duration from input, like Wan V2V). */
export function getDurationsForVideoModel(
  provider: string,
): ReadonlyArray<{ value: number; label: string }> {
  return VIDEO_DURATION_OPTIONS[provider] ?? []
}

// =============================================================================
// VIDEO MODEL ASPECT RATIOS — derived from MODEL_CATALOG. Providers without
// an `aspectRatios` entry fall through to the generic VIDEO_RATIOS default
// (16:9 / 9:16 / 1:1) used by the legacy video-configs panels.
// =============================================================================
const _VIDEO_ASPECT_BY_PROVIDER: Record<string, readonly LabeledOption[]> = {
  ...aspectRatioOptionsByKind("video"),
  // LTX 2.3 — Lightricks via Replicate. Not yet in MODEL_CATALOG, so the
  // aspect-ratio menus are spliced in here. Both variants are 16:9 / 9:16.
  "ltx-2.3-pro": [
    { value: "16:9", label: "16:9 (Landscape)" },
    { value: "9:16", label: "9:16 (Portrait)" },
  ],
  "ltx-2.3-fast": [
    { value: "16:9", label: "16:9 (Landscape)" },
    { value: "9:16", label: "9:16 (Portrait)" },
  ],
}

/**
 * Per-provider VIDEO_ASPECT_RATIOS export — re-exposes the per-provider map
 * for callers that need direct access (provider-aware dropdowns, audit
 * tooling). Use `getAspectRatiosForVideoModel(provider)` for the
 * fallback-aware accessor.
 */
export const VIDEO_ASPECT_RATIOS: Record<string, readonly LabeledOption[]> = _VIDEO_ASPECT_BY_PROVIDER

/**
 * Per-provider VIDEO_FPS_OPTIONS — most providers in MODEL_CATALOG don't yet
 * expose an fps lever (the catalog doesn't track it), so this map currently
 * only contains LTX 2.3 entries. Add other providers here as fps becomes a
 * user-facing setting on their config panels. The "Fast >10s implies
 * 24-25fps only" constraint is enforced by the config panel's snap-stale
 * useEffect, not by this list.
 */
export const VIDEO_FPS_OPTIONS: Record<string, ReadonlyArray<{ value: number; label: string }>> = {
  "ltx-2.3-pro": [24, 25, 48, 50].map((n) => ({ value: n, label: `${n} fps` })),
  "ltx-2.3-fast": [24, 25, 48, 50].map((n) => ({ value: n, label: `${n} fps` })),
}

/** Per-provider aspect ratio options for video models. Falls back to the
 *  generic VIDEO_RATIOS triplet (16:9 / 9:16 / 1:1) when the catalog entry
 *  doesn't declare an `aspectRatios` field — matches the legacy
 *  video-configs behavior. */
export function getAspectRatiosForVideoModel(
  provider: string,
): readonly LabeledOption[] {
  return _VIDEO_ASPECT_BY_PROVIDER[provider] ?? (VIDEO_RATIOS as readonly LabeledOption[])
}

/** Builds the capability tooltip for a video model — Durations, Resolutions,
 *  Aspect ratios on three short lines. Used by the model dropdowns in the
 *  generate-video config panel + quick toolbar so hover surfaces what each
 *  model supports without duplicating the marketing description that already
 *  renders inline. Returns `undefined` when no capability info is available
 *  (caller falls back to the marketing description). */
export function getVideoModelCapabilitiesTooltip(provider: string): string | undefined {
  const durations = getDurationsForVideoModel(provider)
  const resolutions = VIDEO_RESOLUTION_OPTIONS[provider]
  const ratios = getAspectRatiosForVideoModel(provider)
  const parts: string[] = []
  if (durations.length > 0) {
    parts.push(`Durations: ${durations.map((d) => `${d.value}s`).join(", ")}`)
  }
  if (resolutions && resolutions.length > 0) {
    parts.push(`Resolutions: ${resolutions.map((r) => r.value).join(", ")}`)
  }
  if (ratios.length > 0) {
    parts.push(`Aspect ratios: ${ratios.map((r) => r.value).join(", ")}`)
  }
  return parts.length > 0 ? parts.join("\n") : undefined
}

// Image qualities — derived from MODEL_CATALOG.
export const IMAGE_QUALITY_OPTIONS: Record<string, readonly LabeledOption[]> =
  qualityOptionsByKind("image")

/**
 * Default resolution for the Flux 2 family when no (or a stale) resolution is
 * set on the node. Flux 2 uses ascending MP options ("0.5 MP" … "4 MP"), so
 * snapping to options[0] would wrongly land on 0.5 MP. Returns undefined for
 * all non-flux-2 providers (let the caller use the existing options[0] logic).
 */
export function defaultResolutionFor(provider: string): string | undefined {
  if (!isFlux2Model(provider)) return undefined
  return provider === "flux-2-klein" ? "1 MP" : "2 MP"
}

// Kling 3.0 supports continuous durations from 3s to 15s.
// Kept as a named export for the few callers that iterate this directly.
export const KLING3_DURATIONS = Array.from({ length: 13 }, (_, i) => i + 3)

// KIE.ai allowed durations per i2v provider — derived from MODEL_CATALOG.
export const KIE_VIDEO_DURATIONS: Record<string, number[]> = durationsByMode("i2v")

// Model capability constants — re-exported from shared package (single source of truth)
export {
  MODELS_WITH_REFERENCE_IMAGE_SUPPORT,
  REF_IMAGE_MAX_LIMITS,
  DEFAULT_REF_IMAGE_MAX,
  NATIVE_NEGATIVE_PROMPT_MODELS,
  I2I_STRENGTH_SUPPORT,
  I2I_MASK_SUPPORT,
  SEED_SUPPORT,
  RENDERING_SPEED_SUPPORT,
  GUIDANCE_SCALE_SUPPORT,
} from "@nodaro/shared"
import { STYLES } from "@nodaro/shared"

/** Inline Style dropdown options for image config panels. Derived from the
 *  canonical STYLES catalog so the dropdown and the standalone Style node
 *  stay in sync — both resolve to the same promptHint at execution time. */
export const IMAGE_STYLE_PRESETS: ReadonlyArray<{ value: string; label: string }> =
  STYLES.map((s) => ({ value: s.id, label: s.label }))

// Providers that support start + end frame (2 images -> video) —
// derived from MODEL_CATALOG.features.includes("end-frame").
export const PROVIDERS_WITH_END_FRAME: string[] = modelsWithFeature("end-frame")

// Providers that accept reference images beyond the start frame —
// derived from MODEL_CATALOG.features.includes("reference-image"),
// filtered to video models so image-side reference flags don't leak in.
export const PROVIDERS_WITH_REFERENCES: string[] = modelsWithFeature("reference-image")
  .filter((id) => {
    // Avoid pulling image-only models (every i2i model has reference-image)
    // by intersecting with the i2v duration map — only video providers
    // appear there.
    return id in KIE_VIDEO_DURATIONS
  })

/** Fallback credit cost per video provider — shown in node badge until `useModelCredits` resolves. */
export const VIDEO_PROVIDER_FALLBACKS: Record<string, number> = {
  minimax: 18, veo3: 79, "veo3.1": 19, "veo3_lite": 10, kling: 28, "kling-turbo": 14,
  "kling-3.0": 63, "grok-i2v": 7, seedance: 7,
  "seedance-2": 82, "seedance-2-fast": 66,
  "wan-i2v": 22, "wan-turbo": 13, "hailuo-2.3-pro": 20, "hailuo-2.3": 10,
  "hailuo-standard": 10, "bytedance-lite": 6, "bytedance-pro": 18,
  "bytedance-pro-fast": 9, "kling-master": 50, "runway-kie": 4,
  "wan-2.7-i2v": 24, "wan-2.7-t2v": 24,
  "happyhorse": 16, "happyhorse-i2v": 16, "happyhorse-ref2v": 19, "happyhorse-edit": 25,
  "kling-3-omni": 32,
  "gemini-omni-video": 47,
}

/** Aspect ratio options supported by Seedance 2.0 (includes 4:3, 3:4, 21:9, adaptive). */
export const SEEDANCE_2_VIDEO_RATIOS = [
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "1:1", label: "1:1 (Square)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "21:9", label: "21:9 (Ultra-wide)" },
  { value: "adaptive", label: "Adaptive" },
] as const

// KIE.ai allowed durations per text-to-video provider — derived from
// MODEL_CATALOG. The "grok" key here is special: image-mode "grok" also
// supports t2v under the same id, so we read its durations from the
// i2v "grok-i2v" entry (same KIE underlying durations).
export const KIE_T2V_DURATIONS: Record<string, number[]> = {
  ...durationsByMode("t2v"),
  // grok image model serves t2v under id "grok" but the catalog tracks
  // its t2v durations on the separate "grok-i2v" entry.
  grok: durationsByMode("i2v")["grok-i2v"] ?? [6, 10],
}

// =============================================================================
// ADDITIONAL MODEL DESCRIPTION ARRAYS (lip-sync, TTS, Suno, motion transfer)
// =============================================================================

export const LIP_SYNC_MODELS: readonly { value: LipSyncProvider; label: string; desc: string }[] = [
  { value: "seedance-2", label: "Seedance 2", desc: "Native phoneme lip sync, 8+ languages, cinematic. Premium quality." },
  { value: "seedance-2-fast", label: "Seedance 2 Fast", desc: "Same lip sync, cheaper / quicker tier" },
  { value: "kling-avatar", label: "Kling Avatar", desc: "Talking head, 720p, speech-optimized" },
  { value: "kling-avatar-pro", label: "Kling Avatar Pro", desc: "Premium talking head, 1080p" },
  { value: "infinitalk", label: "Infinitalk", desc: "KIE flexible resolution, 480p\u2013720p" },
  { value: "latentsync", label: "LatentSync", desc: "Diffusion-based, best for singing" },
  { value: "wav2lip", label: "Wav2Lip", desc: "Fastest and cheapest, image or video input" },
  { value: "video-retalking", label: "Video-Retalking", desc: "Built-in face enhancement, clean output" },
  { value: "sadtalker", label: "SadTalker", desc: "Talking avatar from single image" },
]

export const TTS_MODELS: readonly { value: string; label: string; desc: string }[] = [
  { value: "elevenlabs-v3", label: "ElevenLabs v3", desc: "Latest, supports audio tags for emotions" },
  { value: "elevenlabs-turbo", label: "ElevenLabs Turbo v2.5", desc: "Fast generation, 32 languages" },
  { value: "elevenlabs-multilingual", label: "ElevenLabs Multilingual v2", desc: "29 languages, natural delivery" },
]

export const SUNO_MODELS: readonly { value: string; label: string; desc: string }[] = [
  { value: "V4", label: "Suno V4", desc: "Stable, proven music generation" },
  { value: "V4_5", label: "Suno V4.5", desc: "Improved quality and coherence" },
  { value: "V4_5ALL", label: "Suno V4.5 All", desc: "Full instrument + vocal generation" },
  { value: "V4_5PLUS", label: "Suno V4.5 Plus", desc: "Extended duration support" },
  { value: "V5", label: "Suno V5", desc: "Superior musical expression, faster generation" },
  { value: "V5_5", label: "Suno V5.5", desc: "Custom models tailored to unique taste" },
]

export const MOTION_TRANSFER_MODELS: readonly { value: MotionTransferProviderType; label: string; desc: string }[] = [
  { value: "kling", label: "Kling 2.6", desc: "Standard motion transfer" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Advanced motion control with prompts" },
  { value: "wan-animate-move", label: "Wan Animate Move", desc: "Move subjects within scene" },
  { value: "wan-animate-replace", label: "Wan Animate Replace", desc: "Replace subjects with motion" },
]

/** Flat lookup of model ID to description, built from all model arrays */
export const MODEL_DESCRIPTIONS: Record<string, string> = Object.fromEntries([
  ...IMAGE_GEN_MODELS,
  ...IMAGE_I2I_MODELS,
  ...IMAGE_EDIT_MODELS,
  ...VIDEO_I2V_MODELS,
  ...VIDEO_T2V_MODELS,
  ...VIDEO_V2V_MODELS,
  ...LIP_SYNC_MODELS,
  ...TTS_MODELS,
  ...SUNO_MODELS,
  ...MOTION_TRANSFER_MODELS,
].map(m => [m.value, m.desc]))
