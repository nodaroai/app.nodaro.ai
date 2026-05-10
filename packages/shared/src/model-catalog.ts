/**
 * Model catalog — single source of truth for what each Nodaro-exposed model
 * is, who made it, what it's good for, and which knobs it accepts.
 *
 * Consumed by:
 * - Backend MCP `list_models` tool (renders the nested per-kind / per-family
 *   response so Claude can pick the right model for a user's intent)
 * - (future) Frontend config panels — today they read parallel registries
 *   in `frontend/src/components/editor/config-panels/model-options.ts`; a
 *   follow-up will migrate them to import from here.
 *
 * Authoring rules:
 * - Keep `description` to one line (≤120 chars). It's what Claude reads to
 *   decide which model to use.
 * - `useCases` is a small set of short tags (1-3 words) — verbs/nouns Claude
 *   can match against user intent ("typography", "character", "fast",
 *   "cinematic"). Stay consistent across entries: don't write "text" in one
 *   and "typography" in another.
 * - `aspectRatios` / `resolutions` / `qualities` only appear when the model
 *   actually exposes that lever (e.g., Nano Banana base has no `resolution`).
 * - `durations` is in seconds.
 * - `pricing[0]` is ALWAYS the default variant (the bare id without a
 *   composite suffix like `:4K` or `:high`).
 * - Costs are sourced from `STATIC_CREDIT_COSTS` (see backend
 *   `src/billing/credits.ts`). Keep them in sync if the table changes.
 */

export type ModelKind = "image" | "video" | "audio"

export type ModelMode =
  // image
  | "t2i"
  | "i2i"
  | "edit"
  | "upscale"
  | "remove-bg"
  // video
  | "i2v"
  | "t2v"
  | "v2v"
  | "extend"
  | "motion-transfer"
  | "lip-sync"
  | "video-upscale"
  // audio
  | "tts"
  | "music"
  | "sfx"
  | "stt"
  | "voice-clone"
  | "voice-design"
  | "voice-changer"
  | "isolation"
  | "dubbing"
  | "forced-alignment"

export interface PriceVariant {
  /** Composite identifier as it appears in `STATIC_CREDIT_COSTS`. */
  identifier: string
  /** Credits charged at reservation. */
  credits: number
  /** Short human-readable note describing this variant ("1K default", "4K", "with audio"). */
  note?: string
}

export interface ModelCatalogEntry {
  id: string
  kind: ModelKind
  /**
   * Operations this model supports. Many video models (minimax, veo3,
   * seedance) support BOTH i2v AND t2v under the same id — the route handler
   * picks which KIE endpoint to hit based on whether an image was supplied.
   * For those, list both modes here so MCP filters and frontend pickers see
   * the model in either context.
   */
  modes: readonly ModelMode[]
  /** Vendor / lab that produced the model. Used for UI grouping. */
  family: string
  /** Display name (NOT the id — the id is the API enum value). */
  label: string
  /** One-liner. Visible to Claude in MCP `list_models` output. */
  description: string
  /** Short tags Claude matches against user intent. */
  useCases: readonly string[]
  /** Capabilities flags: "reference-image", "end-frame", "audio", etc. */
  features?: readonly string[]
  aspectRatios?: readonly string[]
  resolutions?: readonly string[]
  qualities?: readonly string[]
  durations?: readonly number[]
  pricing: readonly PriceVariant[]
  /** Editorial highlight — "best in tier". Surfaces in MCP output as a ⭐. */
  featured?: boolean
  /**
   * Per-model overrides for the global value label decorations (e.g. Hailuo
   * 2.3 Pro labels its 1080P resolution as "1080P (6s max)" because the
   * model caps long durations at lower resolution). Falls back to
   * `MODEL_VALUE_LABELS` for values not listed here.
   */
  valueLabels?: Record<string, string>
  /**
   * Hide from MCP `list_models` output and tool model enums. Used for legacy
   * model versions superseded by newer entries — they remain in the catalog
   * (and accessible via direct API / frontend pickers for back-compat) but
   * stop showing up in Claude.ai's model picker, which keeps the surface
   * tight and steers the agent to the current generation.
   *
   * Frontend pickers ignore this flag.
   */
  mcpHidden?: boolean
}

/**
 * Editorial recommendations — short "best for X" picks Claude can echo back
 * to the user when they don't know which model to use. Surfaces as a "Quick
 * recommendations" footer in MCP `list_models` output.
 */
export interface ModelRecommendation {
  intent: string
  modelIds: readonly string[]
  note: string
}

export const MODEL_RECOMMENDATIONS: readonly ModelRecommendation[] = [
  // image
  { intent: "best for typography / logos / text-heavy", modelIds: ["nano-banana-pro", "gpt-image-2"], note: "Nano Banana Pro for diagrams / complex text; GPT Image 2 for logos and short copy." },
  { intent: "cheapest realistic image", modelIds: ["z-image", "qwen", "imagen4-fast"], note: "Z-Image is the cheapest at 1 credit. Qwen / Imagen4 Fast for slightly higher quality." },
  { intent: "highest fidelity image", modelIds: ["nano-banana-pro", "imagen4-ultra", "flux-flex"], note: "Pick by family preference; all three are premium tiers." },
  { intent: "image edit / restyle", modelIds: ["flux-kontext", "ideogram-remix", "seedream-5-lite-i2i"], note: "Flux Kontext preserves identity; Ideogram Remix is character-aware; Seedream 5 Lite for instruction-based edits." },
  { intent: "highest-resolution image (4K / 8K)", modelIds: ["topaz-image-upscale", "nano-banana-pro", "gpt-image-2"], note: "Generate at native then Topaz upscale for 8K." },
  { intent: "background removal / cutout", modelIds: ["recraft-remove-bg"], note: "1 credit, no prompt needed." },
  // video
  { intent: "best cinematic video", modelIds: ["veo3", "kling-3.0", "seedance-2"], note: "VEO 3 Quality for premium narrative; Kling 3.0 for music-synced motion; Seedance 2 for reference-driven consistency." },
  { intent: "cheap batch video clips", modelIds: ["veo3.1", "wan-turbo", "bytedance-lite"], note: "VEO 3.1 Fast is the best price/quality balance with native audio." },
  { intent: "video with start + end frame", modelIds: ["veo3", "veo3.1", "kling-turbo", "minimax", "hailuo-standard", "seedance-2"], note: "All listed support an end frame; VEO uses imageUrls[start, end]." },
  { intent: "music / song generation", modelIds: ["suno-v5", "suno"], note: "Suno v5 has better vocal quality at the same price." },
  { intent: "voice over / narration", modelIds: ["elevenlabs-v3", "elevenlabs-turbo"], note: "v3 supports [audio tags] for emotion; Turbo is cheaper for plain narration." },
  { intent: "lip-sync a portrait to audio", modelIds: ["kling-avatar-pro", "kling-avatar", "infinitalk"], note: "Pro for best mouth shape; InfiniTalk for resolution control." },
  { intent: "transcription / captions", modelIds: ["elevenlabs-stt"], note: "Word-level timestamps available." },
  { intent: "motion transfer (drive a subject by another video)", modelIds: ["motion-transfer", "kling-3.0-motion"], note: "Kling 2.6 base is cheap; Kling 3.0 is premium." },
] as const

// =============================================================================
// Aspect ratio presets (mirrored from frontend's model-options.ts so backend
// can consume them. Keep in sync when adding a new ratio set.)
// =============================================================================
const NANO_BANANA_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"] as const
// Note: these arrays are synchronized with the frontend's
// `model-options.ts` constants of the same names. The frontend now imports
// them via the `getAspectRatioOptions(modelId)` helper; if you update one
// you no longer need to touch the other.
const FLUX_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const
const KONTEXT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"] as const
const GROK_RATIOS = ["1:1", "16:9", "9:16", "3:2", "2:3"] as const
const GPT_IMAGE_RATIOS = ["1:1", "3:2", "2:3"] as const
const GPT_IMAGE_2_RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"] as const
const IMAGEN4_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const
const IDEOGRAM_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const
const SEEDREAM_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const
const Z_IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const

const VIDEO_RATIOS_HV = ["16:9", "9:16"] as const
const VIDEO_RATIOS_HVS = ["16:9", "9:16", "1:1"] as const
const WAN_27_IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "8:1", "1:8"] as const
const VIDEO_RATIOS_HVS345 = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const

// =============================================================================
// IMAGE MODELS
// =============================================================================
const IMAGE_MODELS: Record<string, ModelCatalogEntry> = {
  // ── Google Nano Banana ──
  "nano-banana": {
    id: "nano-banana",
    kind: "image",
    // Accepts a reference image via image_input — works as both t2i (no
    // ref) and i2i (with ref) under the same id, so list in both modes.
    modes: ["t2i", "i2i"] as const,
    family: "Google",
    label: "Nano Banana",
    description: "Budget-friendly realistic generation. Wide aspect-ratio support up to 21:9.",
    useCases: ["realistic", "general", "fast"],
    features: ["reference-image"],
    aspectRatios: NANO_BANANA_RATIOS,
    pricing: [{ identifier: "nano-banana", credits: 2, note: "1K" }],
    mcpHidden: true,
  },
  "nano-banana-2": {
    id: "nano-banana-2",
    kind: "image",
    // Accepts reference images via image_input — same as the rest of the
    // Nano Banana family — so reachable for both t2i and i2i.
    modes: ["t2i", "i2i"] as const,
    family: "Google",
    label: "Nano Banana 2",
    description: "Newer Nano Banana with native resolution control (1K/2K/4K) and Google Search context.",
    useCases: ["realistic", "high-res", "factual"],
    features: ["reference-image", "google-search"],
    aspectRatios: NANO_BANANA_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "nano-banana-2", credits: 4, note: "1K default" },
      { identifier: "nano-banana-2:2K", credits: 5, note: "2K" },
      { identifier: "nano-banana-2:4K", credits: 7, note: "4K" },
    ],
  },
  "nano-banana-pro": {
    id: "nano-banana-pro",
    kind: "image",
    modes: ["t2i", "i2i"] as const,
    family: "Google",
    label: "Nano Banana Pro",
    description: "Top-tier Nano Banana — best for text rendering, diagrams, and complex compositions.",
    useCases: ["typography", "diagrams", "premium", "text-heavy"],
    features: ["reference-image"],
    aspectRatios: NANO_BANANA_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "nano-banana-pro", credits: 6, note: "1K / 2K" },
      { identifier: "nano-banana-pro:4K", credits: 8, note: "4K" },
    ],
    featured: true,
  },
  "nano-banana-edit": {
    id: "nano-banana-edit",
    kind: "image",
    modes: ["edit"] as const,
    family: "Google",
    label: "Nano Banana Edit",
    description: "Image-to-image edits via Google's Nano Banana family. Good general-purpose editor.",
    useCases: ["edit", "remix", "general"],
    features: ["reference-image"],
    aspectRatios: NANO_BANANA_RATIOS,
    pricing: [{ identifier: "nano-banana-edit", credits: 2 }],
  },

  // ── Black Forest Labs (Flux) ──
  "flux": {
    id: "flux",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Black Forest Labs",
    label: "Flux 2 Pro",
    description: "Flux 2 Pro text-to-image. Strong realism, fast. Resolution lever to 2K.",
    useCases: ["realistic", "general"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["1K", "2K"],
    pricing: [
      { identifier: "flux", credits: 2, note: "1K default" },
      { identifier: "flux:2K", credits: 3, note: "2K" },
    ],
  },
  "flux-flex": {
    id: "flux-flex",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Black Forest Labs",
    label: "Flux 2 Flex",
    description: "Flux 2 Flex — premium fidelity, more flexible composition. Pricier than Pro.",
    useCases: ["premium", "fidelity", "realistic"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["1K", "2K"],
    pricing: [
      { identifier: "flux-flex", credits: 5, note: "1K default" },
      { identifier: "flux-flex:2K", credits: 8, note: "2K" },
    ],
  },
  "flux-i2i": {
    id: "flux-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Black Forest Labs",
    label: "Flux 2 Flex (I2I)",
    description: "Image-to-image with Flux Flex. Honors source image structure while applying prompt.",
    useCases: ["edit", "restyle", "transform"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["1K", "2K"],
    pricing: [
      { identifier: "flux-i2i", credits: 5, note: "1K default" },
      { identifier: "flux-i2i:2K", credits: 8, note: "2K" },
    ],
  },
  "flux-pro-i2i": {
    id: "flux-pro-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Black Forest Labs",
    label: "Flux 2 Pro (I2I)",
    description: "Image-to-image with Flux Pro. Cheaper than Flex variant, good general edits.",
    useCases: ["edit", "restyle"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["1K", "2K"],
    pricing: [
      { identifier: "flux-pro-i2i", credits: 2, note: "1K default" },
      { identifier: "flux-pro-i2i:2K", credits: 3, note: "2K" },
    ],
  },
  "flux-kontext": {
    id: "flux-kontext",
    kind: "image",
    // Kontext supports both pure t2i (no input image) and edit (with input).
    modes: ["t2i", "edit"] as const,
    family: "Black Forest Labs",
    label: "Flux Kontext Pro",
    description: "Context-aware editing and style transfer. Strong at preserving subject identity through edits.",
    useCases: ["edit", "style-transfer", "preserve-identity"],
    features: ["reference-image"],
    aspectRatios: KONTEXT_RATIOS,
    pricing: [{ identifier: "flux-kontext", credits: 2 }],
  },
  "flux-kontext-max": {
    id: "flux-kontext-max",
    kind: "image",
    modes: ["t2i", "edit"] as const,
    family: "Black Forest Labs",
    label: "Flux Kontext Max",
    description: "Premium Kontext — highest fidelity context-aware edits.",
    useCases: ["edit", "style-transfer", "premium"],
    features: ["reference-image"],
    aspectRatios: KONTEXT_RATIOS,
    pricing: [{ identifier: "flux-kontext-max", credits: 4 }],
  },

  // ── OpenAI (GPT Image) ──
  "gpt-image": {
    id: "gpt-image",
    kind: "image",
    modes: ["t2i"] as const,
    family: "OpenAI",
    label: "GPT Image 1.5",
    description: "Best for text rendering, typography, logos, and graphic design. Limited aspect ratios.",
    useCases: ["typography", "logo", "graphic-design", "text-heavy"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_RATIOS,
    qualities: ["medium", "high"],
    pricing: [
      { identifier: "gpt-image", credits: 4, note: "medium default" },
      { identifier: "gpt-image:high", credits: 7, note: "high quality" },
    ],
    valueLabels: { "3:2": "3:2 (Landscape)", "2:3": "2:3 (Portrait)" },
    mcpHidden: true,
  },
  "gpt-image-i2i": {
    id: "gpt-image-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "OpenAI",
    label: "GPT Image 1.5 (I2I)",
    description: "Image-to-image with GPT Image 1.5. Good text-aware edits.",
    useCases: ["edit", "typography", "remix"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_RATIOS,
    qualities: ["medium", "high"],
    pricing: [
      { identifier: "gpt-image-i2i", credits: 4, note: "medium default" },
      { identifier: "gpt-image-i2i:high", credits: 7, note: "high quality" },
    ],
    valueLabels: { "3:2": "3:2 (Landscape)", "2:3": "2:3 (Portrait)" },
    mcpHidden: true,
  },
  "gpt-image-2": {
    id: "gpt-image-2",
    kind: "image",
    modes: ["t2i"] as const,
    family: "OpenAI",
    label: "GPT Image 2",
    description: "Next-gen GPT Image — broader aspect ratios, resolution-based pricing (1K/2K/4K).",
    useCases: ["typography", "high-res", "general"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "gpt-image-2", credits: 2, note: "1K default" },
      { identifier: "gpt-image-2:2K", credits: 4, note: "2K" },
      { identifier: "gpt-image-2:4K", credits: 7, note: "4K" },
    ],
  },
  "gpt-image-2-i2i": {
    id: "gpt-image-2-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "OpenAI",
    label: "GPT Image 2 (I2I)",
    description: "Image-to-image with GPT Image 2.",
    useCases: ["edit", "high-res"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "gpt-image-2-i2i", credits: 2, note: "1K default" },
      { identifier: "gpt-image-2-i2i:2K", credits: 4, note: "2K" },
      { identifier: "gpt-image-2-i2i:4K", credits: 7, note: "4K" },
    ],
  },

  // ── Ideogram ──
  // Ideogram models use a `rendering_speed` (TURBO / BALANCED / QUALITY)
  // dimension that's distinct from the `quality` lever — frontend exposes
  // it via a separate dropdown — so we don't model it under `qualities`.
  // The composite pricing identifiers (`ideogram-v3:TURBO`, etc.) capture
  // the per-tier credit cost without claiming Claude can pick it from
  // the MCP tool's `quality` enum.
  "ideogram-v3": {
    id: "ideogram-v3",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Ideogram",
    label: "Ideogram V3",
    description: "Strong typography and stylized illustration. Speed/quality tiered (TURBO/BALANCED/QUALITY).",
    useCases: ["typography", "illustration", "stylized"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [
      { identifier: "ideogram-v3", credits: 2, note: "BALANCED default" },
      { identifier: "ideogram-v3:TURBO", credits: 1, note: "fastest" },
      { identifier: "ideogram-v3:QUALITY", credits: 3, note: "best quality" },
    ],
  },
  "ideogram-edit": {
    id: "ideogram-edit",
    kind: "image",
    modes: ["edit"] as const,
    family: "Ideogram",
    label: "Ideogram Edit",
    description: "Inpainting / mask-based editing with Ideogram. Pair with a mask URL.",
    useCases: ["edit", "inpaint", "typography"],
    features: ["reference-image", "mask"],
    // No aspectRatios — Ideogram Edit takes output dimensions from the input
    // image + mask. Backend strips aspect_ratio for this provider.
    pricing: [
      { identifier: "ideogram-edit", credits: 6, note: "BALANCED default" },
      { identifier: "ideogram-edit:TURBO", credits: 4, note: "fastest" },
      { identifier: "ideogram-edit:QUALITY", credits: 8, note: "best quality" },
    ],
  },
  "ideogram-remix": {
    id: "ideogram-remix",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Ideogram",
    label: "Ideogram Remix",
    description: "Ideogram remix — character-aware restyling driven by reference images.",
    useCases: ["remix", "character", "stylized"],
    features: ["reference-image"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [
      { identifier: "ideogram-remix", credits: 6, note: "BALANCED default" },
      { identifier: "ideogram-remix:TURBO", credits: 4, note: "fastest" },
      { identifier: "ideogram-remix:QUALITY", credits: 8, note: "best quality" },
    ],
  },
  "ideogram-reframe": {
    id: "ideogram-reframe",
    kind: "image",
    modes: ["edit"] as const,
    family: "Ideogram",
    label: "Ideogram Reframe",
    description: "Outpaint / reframe to a new aspect ratio while preserving subject.",
    useCases: ["outpaint", "reframe"],
    features: ["reference-image"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [
      { identifier: "ideogram-reframe", credits: 3, note: "BALANCED default" },
      { identifier: "ideogram-reframe:TURBO", credits: 2, note: "fastest" },
      { identifier: "ideogram-reframe:QUALITY", credits: 4, note: "best quality" },
    ],
  },

  // ── Google Imagen ──
  "imagen4": {
    id: "imagen4",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Google",
    label: "Imagen 4",
    description: "Google's Imagen 4 — strong photographic quality and prompt fidelity.",
    useCases: ["photographic", "realistic"],
    aspectRatios: IMAGEN4_RATIOS,
    pricing: [{ identifier: "imagen4", credits: 3 }],
  },
  "imagen4-fast": {
    id: "imagen4-fast",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Google",
    label: "Imagen 4 Fast",
    description: "Cheaper / quicker Imagen 4 tier.",
    useCases: ["fast", "realistic", "general"],
    aspectRatios: IMAGEN4_RATIOS,
    pricing: [{ identifier: "imagen4-fast", credits: 2 }],
  },
  "imagen4-ultra": {
    id: "imagen4-ultra",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Google",
    label: "Imagen 4 Ultra",
    description: "Premium Imagen 4 — highest fidelity, slower / more credits.",
    useCases: ["premium", "photographic"],
    aspectRatios: IMAGEN4_RATIOS,
    pricing: [{ identifier: "imagen4-ultra", credits: 4 }],
  },

  // ── Bytedance Seedream ──
  "seedream": {
    id: "seedream",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Bytedance",
    label: "Seedream 4.5",
    description: "Bytedance's Seedream 4.5 — precise control, high resolution at 4K via :high.",
    useCases: ["realistic", "high-res", "control"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    qualities: ["basic", "high"],
    pricing: [
      { identifier: "seedream", credits: 3, note: "basic / 2K default" },
      { identifier: "seedream:high", credits: 4, note: "high / 4K" },
    ],
    mcpHidden: true,
  },
  "seedream-edit": {
    id: "seedream-edit",
    kind: "image",
    modes: ["edit"] as const,
    family: "Bytedance",
    label: "Seedream 4.5 Edit",
    description: "Image editing / transforms via Seedream 4.5.",
    useCases: ["edit", "transform"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    qualities: ["basic", "high"],
    pricing: [
      { identifier: "seedream-edit", credits: 3, note: "basic default" },
      { identifier: "seedream-edit:high", credits: 4, note: "high quality" },
    ],
    mcpHidden: true,
  },
  "seedream-5-lite": {
    id: "seedream-5-lite",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Bytedance",
    label: "Seedream 5 Lite",
    description: "Newer Seedream 5 Lite — instruction-based generation, visual reasoning.",
    useCases: ["realistic", "instruction"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    qualities: ["basic", "high"],
    pricing: [
      { identifier: "seedream-5-lite", credits: 2, note: "basic default" },
      { identifier: "seedream-5-lite:high", credits: 5, note: "high quality" },
    ],
  },
  "seedream-5-lite-i2i": {
    id: "seedream-5-lite-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Bytedance",
    label: "Seedream 5 Lite (I2I)",
    description: "Image-to-image with Seedream 5 Lite.",
    useCases: ["edit", "instruction"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    qualities: ["basic", "high"],
    pricing: [
      { identifier: "seedream-5-lite-i2i", credits: 2, note: "basic default" },
      { identifier: "seedream-5-lite-i2i:high", credits: 5, note: "high quality" },
    ],
  },

  // ── Alibaba Qwen ──
  "qwen": {
    id: "qwen",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Alibaba",
    label: "Qwen",
    description: "Cheap, fast, decent quality. Native negative-prompt support.",
    useCases: ["fast", "cheap", "general"],
    features: ["reference-image"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [{ identifier: "qwen", credits: 1 }],
  },
  "qwen-i2i": {
    id: "qwen-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Alibaba",
    label: "Qwen (I2I)",
    description: "Image-to-image with Qwen.",
    useCases: ["edit", "fast", "cheap"],
    features: ["reference-image"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [{ identifier: "qwen-i2i", credits: 2 }],
  },
  "qwen-edit": {
    id: "qwen-edit",
    kind: "image",
    modes: ["edit"] as const,
    family: "Alibaba",
    label: "Qwen Edit",
    description: "Qwen image edit endpoint with native negative prompt.",
    useCases: ["edit", "cheap"],
    features: ["reference-image"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [{ identifier: "qwen-edit", credits: 2 }],
  },

  // ── Tongyi-MAI Z-Image ──
  "z-image": {
    id: "z-image",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Tongyi-MAI",
    label: "Z-Image",
    description: "Cheapest model in catalog. Fast, stylized output. Limited aspect ratios.",
    useCases: ["cheap", "fast", "stylized"],
    aspectRatios: Z_IMAGE_RATIOS,
    pricing: [{ identifier: "z-image", credits: 1 }],
    featured: true,
  },

  // ── xAI Grok ──
  "grok": {
    id: "grok",
    // Grok serves both t2i (image) and t2v (video) under the same id —
    // backend route resolves which by entry point. We classify the catalog
    // entry by primary kind (image) but list both modes so MCP filters and
    // frontend pickers find it under either context.
    kind: "image",
    modes: ["t2i", "t2v"] as const,
    family: "xAI",
    label: "Grok Imagine",
    description: "Expressive, high-contrast output. Supports both image and video.",
    useCases: ["stylized", "expressive", "general"],
    features: ["reference-image"],
    aspectRatios: GROK_RATIOS,
    pricing: [{ identifier: "grok", credits: 2 }],
  },
  "grok-i2i": {
    id: "grok-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "xAI",
    label: "Grok Imagine (I2I)",
    description: "Image-to-image with Grok.",
    useCases: ["edit", "stylized"],
    features: ["reference-image"],
    pricing: [{ identifier: "grok-i2i", credits: 2 }],
  },
  "grok-upscale": {
    id: "grok-upscale",
    kind: "image",
    modes: ["upscale"] as const,
    family: "xAI",
    label: "Grok Upscale",
    description: "Upscale a previously-generated Grok image. Requires the prior task id.",
    useCases: ["upscale"],
    pricing: [{ identifier: "grok-upscale", credits: 4 }],
  },

  // ── Utilities ──
  "recraft-remove-bg": {
    id: "recraft-remove-bg",
    kind: "image",
    modes: ["remove-bg"] as const,
    family: "Recraft",
    label: "Recraft Remove BG",
    description: "Remove image background. Cheap utility.",
    useCases: ["background-removal", "utility"],
    features: ["reference-image"],
    pricing: [{ identifier: "recraft-remove-bg", credits: 1 }],
  },
  "recraft-upscale": {
    id: "recraft-upscale",
    kind: "image",
    modes: ["upscale"] as const,
    family: "Recraft",
    label: "Recraft Crisp Upscale",
    description: "Light-weight image upscale (Recraft Crisp).",
    useCases: ["upscale", "utility"],
    features: ["reference-image"],
    pricing: [{ identifier: "recraft-upscale", credits: 1 }],
  },
  "topaz-image-upscale": {
    id: "topaz-image-upscale",
    kind: "image",
    modes: ["upscale"] as const,
    family: "Topaz",
    label: "Topaz Image Upscale",
    description: "High-quality image upscale up to 8K. Best for production-ready output.",
    useCases: ["upscale", "high-res", "premium"],
    features: ["reference-image"],
    resolutions: ["2K", "4K", "8K"],
    pricing: [
      { identifier: "topaz-image-upscale", credits: 4, note: "2K default" },
      { identifier: "topaz-image-upscale:4K", credits: 7, note: "4K" },
      { identifier: "topaz-image-upscale:8K", credits: 13, note: "8K" },
    ],
  },
}

// =============================================================================
// VIDEO MODELS
// =============================================================================
const VIDEO_MODELS: Record<string, ModelCatalogEntry> = {
  // ── Hailuo / MiniMax ──
  "minimax": {
    id: "minimax",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "MiniMax",
    label: "Hailuo 02 I2V Pro",
    description: "Hailuo 02 Pro — strong photoreal motion, fixed 5-second clips. Supports end frame.",
    useCases: ["realistic", "motion", "narrative"],
    features: ["end-frame"],
    durations: [5],
    pricing: [{ identifier: "minimax", credits: 18, note: "5s, 1080p" }],
  },
  "hailuo-2.3-pro": {
    id: "hailuo-2.3-pro",
    kind: "video",
    modes: ["i2v"] as const,
    family: "MiniMax",
    valueLabels: { "1080P": "1080P (6s max)" },
    label: "Hailuo 2.3 Pro",
    description: "Hailuo 2.3 Pro — newer Hailuo with 768P / 1080P resolutions.",
    useCases: ["realistic", "motion"],
    durations: [6, 10],
    resolutions: ["768P", "1080P"],
    pricing: [
      { identifier: "hailuo-2.3-pro", credits: 20, note: "10s default" },
      { identifier: "hailuo-2.3-pro:6s", credits: 13, note: "6s" },
      { identifier: "hailuo-2.3-pro:10s", credits: 20, note: "10s" },
    ],
  },
  "hailuo-2.3": {
    id: "hailuo-2.3",
    kind: "video",
    modes: ["i2v"] as const,
    family: "MiniMax",
    resolutions: ["768P", "1080P"],
    valueLabels: { "1080P": "1080P (6s max)" },
    label: "Hailuo 2.3 Standard",
    description: "Cheaper Hailuo 2.3 tier — good baseline quality.",
    useCases: ["realistic", "cheap"],
    durations: [6, 10],
    pricing: [
      { identifier: "hailuo-2.3", credits: 10, note: "6s default" },
      { identifier: "hailuo-2.3:6s", credits: 8, note: "6s" },
      { identifier: "hailuo-2.3:10s", credits: 13, note: "10s" },
    ],
  },
  "hailuo-standard": {
    id: "hailuo-standard",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "MiniMax",
    label: "Hailuo 02 Standard",
    description: "Hailuo 02 Standard — economical option with end-frame support.",
    useCases: ["cheap", "motion"],
    features: ["end-frame"],
    durations: [6, 10],
    resolutions: ["512P", "768P"],
    pricing: [
      { identifier: "hailuo-standard", credits: 10, note: "6s default" },
      { identifier: "hailuo-standard:6s", credits: 8, note: "6s" },
      { identifier: "hailuo-standard:10s", credits: 13, note: "10s" },
    ],
  },

  // ── Google VEO ──
  "veo3": {
    id: "veo3",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Google",
    label: "VEO 3 Quality",
    description: "Google VEO 3 Quality — premium cinematic video. 8s clips, optional end frame, native audio.",
    useCases: ["cinematic", "premium", "narrative"],
    features: ["end-frame", "audio", "reference-image"],
    durations: [8],
    aspectRatios: VIDEO_RATIOS_HV,
    // 720p (default) + 1080p inline. 4K requires KIE's separate
    // /api/v1/veo/get-4k-video endpoint and is exposed via a dedicated
    // upgrade node, not this picker.
    resolutions: ["720p", "1080p"],
    pricing: [{ identifier: "veo3", credits: 79, note: "8s with audio" }],
    featured: true,
  },
  "veo3.1": {
    id: "veo3.1",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Google",
    label: "VEO 3.1 Fast",
    description: "VEO 3.1 Fast — cheaper VEO tier, still 8s with audio. Good balance for most uses.",
    useCases: ["cinematic", "fast", "general"],
    features: ["end-frame", "audio", "reference-image"],
    durations: [8],
    aspectRatios: VIDEO_RATIOS_HV,
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "veo3.1", credits: 19, note: "8s with audio @ 720p" },
      { identifier: "veo3.1:1080p", credits: 21, note: "8s with audio @ 1080p" },
    ],
    featured: true,
  },
  "veo3_lite": {
    id: "veo3_lite",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Google",
    label: "VEO 3.1 Lite",
    description: "VEO 3.1 Lite — most cost-effective VEO tier for high-volume generation. 8s with audio, supports first+last frame.",
    useCases: ["cinematic", "cheap", "high-volume"],
    features: ["end-frame", "audio", "reference-image"],
    durations: [8],
    aspectRatios: VIDEO_RATIOS_HV,
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "veo3_lite", credits: 10, note: "8s with audio @ 720p" },
      { identifier: "veo3_lite:1080p", credits: 11, note: "8s with audio @ 1080p" },
    ],
    featured: false,
  },

  // ── Kling ──
  "kling": {
    id: "kling",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Kuaishou",
    label: "Kling 2.6",
    description: "Kling 2.6 I2V — strong motion realism. 5s/10s, optional native audio.",
    useCases: ["realistic", "motion", "dance"],
    features: ["audio"],
    aspectRatios: VIDEO_RATIOS_HVS,
    durations: [5, 10],
    pricing: [
      { identifier: "kling", credits: 28, note: "10s no audio default" },
      { identifier: "kling:5s", credits: 14, note: "5s no audio" },
      { identifier: "kling:10s", credits: 28, note: "10s no audio" },
      { identifier: "kling:5s:audio", credits: 28, note: "5s with audio" },
      { identifier: "kling:10s:audio", credits: 56, note: "10s with audio" },
    ],
  },
  "kling-turbo": {
    id: "kling-turbo",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Kuaishou",
    label: "Kling 2.5 Turbo Pro",
    description: "Faster Kling — good quality at lower cost. Supports end frame.",
    useCases: ["fast", "motion", "cheap"],
    features: ["end-frame"],
    durations: [5, 10],
    pricing: [
      { identifier: "kling-turbo", credits: 14, note: "5s default" },
      { identifier: "kling-turbo:5s", credits: 11 },
      { identifier: "kling-turbo:10s", credits: 21 },
    ],
  },
  "kling-3.0": {
    id: "kling-3.0",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Kuaishou",
    label: "Kling 3.0",
    description: "Premium Kling 3.0 — variable 3-15s duration, native audio, 720P/1080P.",
    useCases: ["premium", "narrative", "cinematic"],
    features: ["end-frame", "audio"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720P", "1080P"],
    pricing: [
      { identifier: "kling-3.0", credits: 63, note: "5s 1080p with audio" },
      { identifier: "kling-3.0:5s", credits: 43, note: "5s 1080p no audio" },
      { identifier: "kling-3.0:10s", credits: 86, note: "10s 1080p no audio" },
      { identifier: "kling-3.0:15s", credits: 128, note: "15s 1080p no audio" },
      { identifier: "kling-3.0:5s:audio", credits: 63, note: "5s 1080p with audio" },
      { identifier: "kling-3.0:10s:audio", credits: 126, note: "10s 1080p with audio" },
      { identifier: "kling-3.0:15s:audio", credits: 189, note: "15s 1080p with audio" },
    ],
    featured: true,
  },
  "kling-master": {
    id: "kling-master",
    kind: "video",
    modes: ["i2v"] as const,
    family: "Kuaishou",
    label: "Kling 2.1 Master",
    description: "Master tier I2V — strong cinematic quality.",
    useCases: ["cinematic", "premium"],
    durations: [5, 10],
    pricing: [
      { identifier: "kling-master", credits: 50, note: "5s default" },
      { identifier: "kling-master:5s", credits: 40 },
      { identifier: "kling-master:10s", credits: 80 },
    ],
  },

  // ── xAI Grok video ──
  "grok-i2v": {
    id: "grok-i2v",
    kind: "video",
    modes: ["i2v"] as const,
    features: ["reference-image"],
    family: "xAI",
    label: "Grok Imagine (I2V)",
    description: "Grok image-to-video — stylized motion. Up to 15s.",
    useCases: ["stylized", "motion"],
    durations: [6, 10],
    resolutions: ["480p", "720p"],
    pricing: [
      { identifier: "grok-i2v", credits: 7, note: "6s default" },
      { identifier: "grok-i2v:6s", credits: 5 },
      { identifier: "grok-i2v:10s", credits: 8 },
      { identifier: "grok-i2v:15s", credits: 10 },
    ],
  },

  // ── Bytedance Seedance ──
  "seedance": {
    id: "seedance",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Bytedance",
    label: "Seedance 1.5 Pro",
    description: "Bytedance Seedance 1.5 Pro — flexible duration (4/8/12s) with end-frame support.",
    useCases: ["motion", "narrative"],
    features: ["end-frame"],
    durations: [4, 8, 12],
    resolutions: ["480p", "720p", "1080p"],
    pricing: [
      { identifier: "seedance", credits: 7, note: "8s default" },
      { identifier: "seedance:4s", credits: 4 },
      { identifier: "seedance:8s", credits: 7 },
      { identifier: "seedance:12s", credits: 15 },
    ],
    mcpHidden: true,
  },
  "seedance-2": {
    id: "seedance-2",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Bytedance",
    label: "Seedance 2",
    description: "Seedance 2 — premium tier with native audio. Per-second pricing by resolution.",
    useCases: ["premium", "narrative"],
    features: ["end-frame", "audio", "reference-image"],
    aspectRatios: VIDEO_RATIOS_HVS,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["480p", "720p"],
    pricing: [
      { identifier: "seedance-2", credits: 38, note: "default — see :NsR variants for exact" },
      { identifier: "seedance-2:8s:480p", credits: 38, note: "8s 480p" },
      { identifier: "seedance-2:8s:720p", credits: 82, note: "8s 720p" },
      { identifier: "seedance-2:8s:480p-ref", credits: 23, note: "8s 480p with reference" },
      { identifier: "seedance-2:8s:720p-ref", credits: 50, note: "8s 720p with reference" },
    ],
  },
  "seedance-2-fast": {
    id: "seedance-2-fast",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Bytedance",
    label: "Seedance 2 Fast",
    description: "Cheaper / quicker Seedance 2 tier.",
    useCases: ["fast", "motion"],
    features: ["end-frame", "audio", "reference-image"],
    aspectRatios: VIDEO_RATIOS_HVS,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["480p", "720p"],
    pricing: [
      { identifier: "seedance-2-fast", credits: 31, note: "default — see :NsR variants" },
      { identifier: "seedance-2-fast:8s:480p", credits: 31 },
      { identifier: "seedance-2-fast:8s:720p", credits: 66 },
      { identifier: "seedance-2-fast:8s:480p-ref", credits: 16 },
      { identifier: "seedance-2-fast:8s:720p-ref", credits: 40 },
    ],
  },

  // ── Wan ──
  "wan-i2v": {
    id: "wan-i2v",
    kind: "video",
    modes: ["i2v"] as const,
    family: "Alibaba",
    label: "Wan 2.6 I2V",
    description: "Wan 2.6 image-to-video — 5/10/15s at 720p/1080p.",
    useCases: ["motion", "narrative"],
    durations: [5, 10, 15],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "wan-i2v", credits: 22, note: "5s 720p default" },
      { identifier: "wan-i2v:5s", credits: 18 },
      { identifier: "wan-i2v:10s", credits: 35 },
      { identifier: "wan-i2v:15s", credits: 53 },
    ],
  },
  "wan-turbo": {
    id: "wan-turbo",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Alibaba",
    label: "Wan 2.2 Turbo",
    description: "Cheap, fast Wan turbo — 5s. Serves both i2v and t2v under one id.",
    useCases: ["cheap", "fast"],
    aspectRatios: VIDEO_RATIOS_HVS,
    durations: [5],
    resolutions: ["480p", "720p"],
    // Different KIE endpoints (i2v vs t2v) → different costs under
    // composite ids. Route picks endpoint based on whether image was supplied.
    pricing: [
      { identifier: "wan-turbo", credits: 13, note: "i2v 5s 480p" },
      { identifier: "wan-turbo-t2v", credits: 25, note: "t2v 5s 720p" },
    ],
  },
  "wan": {
    id: "wan",
    kind: "video",
    // "wan" id covers v2v AND t2v under different KIE endpoints; the
    // pricing variants tag which mode each cost belongs to.
    modes: ["v2v", "t2v"] as const,
    family: "Alibaba",
    label: "Wan 2.6",
    description: "Wan 2.6 — text-to-video and video-to-video under a single id.",
    useCases: ["v2v", "t2v", "restyle"],
    durations: [5],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "wan", credits: 22, note: "v2v 5s 720p" },
      { identifier: "wan-t2v", credits: 33, note: "t2v 5s 1080p" },
    ],
  },
  "wan-flash": {
    id: "wan-flash",
    kind: "video",
    modes: ["v2v"] as const,
    family: "Alibaba",
    label: "Wan Flash V2V",
    description: "Faster Wan V2V variant.",
    useCases: ["v2v", "fast"],
    pricing: [{ identifier: "wan-flash", credits: 13 }],
  },
  // ── Wan 2.7 ──
  "wan-2.7": {
    id: "wan-2.7",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Alibaba",
    label: "Wan 2.7",
    description: "Wan 2.7 text-to-image — 1K/2K/4K, up to 9 optional style/character reference images.",
    useCases: ["photorealistic", "stylized", "reference"],
    features: ["reference-image"] as const,
    aspectRatios: WAN_27_IMAGE_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "wan-2.7",    credits: 3,  note: "1K base" },
      { identifier: "wan-2.7:2K", credits: 5,  note: "2K" },
      { identifier: "wan-2.7:4K", credits: 10, note: "4K" },
    ],
  },
  "wan-2.7-pro": {
    id: "wan-2.7-pro",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Alibaba",
    label: "Wan 2.7 Pro",
    description: "Wan 2.7 Pro text-to-image — higher quality, 1K/2K/4K, no image input.",
    useCases: ["photorealistic", "premium"],
    aspectRatios: WAN_27_IMAGE_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "wan-2.7-pro",    credits: 4,  note: "1K base" },
      { identifier: "wan-2.7-pro:2K", credits: 8,  note: "2K" },
      { identifier: "wan-2.7-pro:4K", credits: 15, note: "4K" },
    ],
  },
  "wan-2.7-i2v": {
    id: "wan-2.7-i2v",
    kind: "video",
    modes: ["i2v"] as const,
    family: "Alibaba",
    label: "Wan 2.7 I2V",
    description: "Wan 2.7 image-to-video — 2–15s at 720p/1080p, supports start+end frame.",
    useCases: ["motion", "narrative"],
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1080p"],
    features: ["end-frame"],
    pricing: [
      { identifier: "wan-2.7-i2v", credits: 24, note: "5s 720p default" },
    ],
  },
  "wan-2.7-t2v": {
    id: "wan-2.7-t2v",
    kind: "video",
    modes: ["t2v"] as const,
    family: "Alibaba",
    label: "Wan 2.7 T2V",
    description: "Wan 2.7 text-to-video — 2–15s at 720p/1080p.",
    useCases: ["motion", "narrative"],
    aspectRatios: VIDEO_RATIOS_HVS345,
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "wan-2.7-t2v", credits: 24, note: "5s 720p default" },
    ],
  },
  // ── HappyHorse ──
  "happyhorse": {
    id: "happyhorse",
    kind: "video",
    modes: ["t2v"] as const,
    family: "HappyHorse",
    label: "HappyHorse",
    description: "HappyHorse text-to-video — 3–15s at 720p/1080p.",
    useCases: ["motion", "creative"],
    aspectRatios: VIDEO_RATIOS_HVS345,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "happyhorse", credits: 16, note: "5s 720p default" },
    ],
  },
  "happyhorse-i2v": {
    id: "happyhorse-i2v",
    kind: "video",
    modes: ["i2v"] as const,
    family: "HappyHorse",
    label: "HappyHorse I2V",
    description: "HappyHorse image-to-video — 3–15s at 720p/1080p, aspect ratio inferred from input image.",
    useCases: ["motion", "creative"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "happyhorse-i2v", credits: 16, note: "5s 720p default" },
    ],
  },
  "happyhorse-ref2v": {
    id: "happyhorse-ref2v",
    kind: "video",
    modes: ["i2v"] as const,
    family: "HappyHorse",
    label: "HappyHorse Ref2V",
    description: "HappyHorse reference-to-video — 1–9 reference images, 3–15s at 720p/1080p.",
    useCases: ["motion", "reference"],
    aspectRatios: VIDEO_RATIOS_HVS345,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "1080p"],
    features: ["reference-image"],
    pricing: [
      { identifier: "happyhorse-ref2v", credits: 19, note: "5s 720p default" },
    ],
  },
  "happyhorse-edit": {
    id: "happyhorse-edit",
    kind: "video",
    modes: ["v2v"] as const,
    family: "HappyHorse",
    label: "HappyHorse Edit",
    description: "HappyHorse video-edit — video-to-video transformation, up to 60s input, 720p/1080p output.",
    useCases: ["v2v", "restyle"],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "happyhorse-edit", credits: 25, note: "720p default" },
    ],
  },
  // ── Bytedance video lite/pro ──
  "bytedance-lite": {
    id: "bytedance-lite",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Bytedance",
    label: "Bytedance Lite I2V",
    description: "Cheapest Bytedance video tier with end-frame support.",
    useCases: ["cheap", "motion"],
    features: ["end-frame"],
    aspectRatios: VIDEO_RATIOS_HVS,
    durations: [5, 10],
    resolutions: ["480p", "720p", "1080p"],
    pricing: [{ identifier: "bytedance-lite", credits: 6 }],
  },
  "bytedance-pro": {
    id: "bytedance-pro",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Bytedance",
    label: "Bytedance Pro I2V",
    description: "Pro Bytedance video tier — better quality.",
    useCases: ["motion", "narrative"],
    aspectRatios: VIDEO_RATIOS_HVS,
    durations: [5, 10],
    resolutions: ["480p", "720p", "1080p"],
    pricing: [{ identifier: "bytedance-pro", credits: 18 }],
  },
  "bytedance-pro-fast": {
    id: "bytedance-pro-fast",
    kind: "video",
    modes: ["i2v"] as const,
    family: "Bytedance",
    label: "Bytedance Pro Fast I2V",
    description: "Faster Bytedance Pro variant.",
    useCases: ["fast", "motion"],
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    pricing: [{ identifier: "bytedance-pro-fast", credits: 9 }],
  },

  // ── OpenAI Sora ──
  // (Sora2 / Sora2-Pro are listed in KIE models but not in STATIC_CREDIT_COSTS;
  // they're priced at runtime via the per-second tracker, so we omit pricing
  // arrays with composite entries — `list_models` will fall back to whatever
  // base entry exists.)

  // ── Runway ──
  "runway-kie": {
    id: "runway-kie",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Runway",
    label: "Runway (via KIE)",
    description: "Runway Gen-3 routed through KIE. 5/10s at 720p/1080p.",
    useCases: ["motion", "narrative"],
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    pricing: [{ identifier: "runway-kie", credits: 4, note: "5s 720p" }],
  },
  "runway-aleph": {
    id: "runway-aleph",
    kind: "video",
    modes: ["v2v"] as const,
    family: "Runway",
    label: "Runway Aleph V2V",
    description: "Runway Aleph — video-to-video conversion.",
    useCases: ["v2v", "restyle"],
    pricing: [{ identifier: "runway-aleph", credits: 35, note: "5s clip" }],
  },

  // ── Extend / Upscale ──
  "veo-extend": {
    id: "veo-extend",
    kind: "video",
    modes: ["extend"] as const,
    family: "Google",
    label: "VEO Extend",
    description: "Extend an existing VEO 3.1 clip by another segment.",
    useCases: ["extend"],
    pricing: [
      { identifier: "veo-extend", credits: 19, note: "VEO 3.1 Fast default" },
      { identifier: "veo-extend:quality", credits: 79, note: "VEO 3.1 Quality" },
    ],
  },
  "runway-extend": {
    id: "runway-extend",
    kind: "video",
    modes: ["extend"] as const,
    family: "Runway",
    label: "Runway Extend",
    description: "Extend a Runway video by another clip.",
    useCases: ["extend"],
    pricing: [{ identifier: "runway-extend", credits: 32 }],
  },
  "veo-1080p": {
    id: "veo-1080p",
    kind: "video",
    modes: ["video-upscale"] as const,
    family: "Google",
    label: "VEO 1080p Upscale",
    description: "Upscale VEO output to 1080p.",
    useCases: ["upscale"],
    pricing: [{ identifier: "veo-1080p", credits: 2 }],
  },
  "veo-4k": {
    id: "veo-4k",
    kind: "video",
    modes: ["video-upscale"] as const,
    family: "Google",
    label: "VEO 4K Upscale",
    description: "Upscale VEO output to 4K.",
    useCases: ["upscale", "high-res"],
    pricing: [{ identifier: "veo-4k", credits: 38 }],
  },
  "topaz-video": {
    id: "topaz-video",
    kind: "video",
    modes: ["video-upscale"] as const,
    family: "Topaz",
    label: "Topaz Video Upscale",
    description: "High-quality video upscale and enhancement.",
    useCases: ["upscale", "premium"],
    pricing: [{ identifier: "topaz-video", credits: 19, note: "~5s clip" }],
  },

  // ── Motion transfer ──
  "motion-transfer": {
    id: "motion-transfer",
    kind: "video",
    modes: ["motion-transfer"] as const,
    family: "Kuaishou",
    label: "Kling 2.6 Motion Transfer",
    description: "Transfer the motion from a driving video onto a still subject. Kling 2.6 base.",
    useCases: ["motion-transfer"],
    durations: [5, 10, 15, 30],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "motion-transfer", credits: 19, note: "10s 720p default" },
      { identifier: "motion-transfer:5s", credits: 10 },
      { identifier: "motion-transfer:10s", credits: 19 },
      { identifier: "motion-transfer:15s", credits: 29 },
      { identifier: "motion-transfer:30s", credits: 57 },
      { identifier: "motion-transfer:1080p:10s", credits: 29 },
    ],
  },
  "kling-3.0-motion": {
    id: "kling-3.0-motion",
    kind: "video",
    modes: ["motion-transfer"] as const,
    family: "Kuaishou",
    label: "Kling 3.0 Motion Transfer",
    description: "Premium motion transfer via Kling 3.0.",
    useCases: ["motion-transfer", "premium"],
    durations: [5, 10, 15, 30],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "kling-3.0-motion", credits: 38, note: "10s 720p default" },
      { identifier: "kling-3.0-motion:5s", credits: 19 },
      { identifier: "kling-3.0-motion:10s", credits: 38 },
      { identifier: "kling-3.0-motion:1080p:10s", credits: 63 },
    ],
  },

  // ── Lip sync / talking-head ──
  "kling-avatar": {
    id: "kling-avatar",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "Kuaishou",
    label: "Kling Avatar Standard",
    description: "Lip-sync a still portrait to driving audio. Standard quality.",
    useCases: ["lip-sync", "talking-head"],
    pricing: [{ identifier: "kling-avatar", credits: 28, note: "~14s default" }],
  },
  "kling-avatar-pro": {
    id: "kling-avatar-pro",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "Kuaishou",
    label: "Kling Avatar Pro",
    description: "Premium lip-sync — better mouth shape and timing.",
    useCases: ["lip-sync", "talking-head", "premium"],
    pricing: [{ identifier: "kling-avatar-pro", credits: 56 }],
  },
  "infinitalk": {
    id: "infinitalk",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "InfiniTalk",
    label: "InfiniTalk",
    description: "Audio-driven talking-head from a still image. 480p / 720p.",
    useCases: ["lip-sync", "talking-head"],
    resolutions: ["480p", "720p"],
    pricing: [
      { identifier: "infinitalk", credits: 42, note: "720p default" },
      { identifier: "infinitalk:480p", credits: 11 },
      { identifier: "infinitalk:720p", credits: 42 },
    ],
  },
  "hailuo-avatar": {
    id: "hailuo-avatar",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "MiniMax",
    label: "Hailuo Avatar",
    description: "MiniMax avatar lip-sync.",
    useCases: ["lip-sync", "talking-head"],
    pricing: [{ identifier: "hailuo-avatar", credits: 19 }],
  },
}

// =============================================================================
// AUDIO MODELS
// =============================================================================
const AUDIO_MODELS: Record<string, ModelCatalogEntry> = {
  // ── ElevenLabs TTS ──
  "elevenlabs-v3": {
    id: "elevenlabs-v3",
    kind: "audio",
    modes: ["tts"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs v3",
    description: "Latest ElevenLabs TTS — supports [audio tags] for emotion / pacing. Direct API.",
    useCases: ["tts", "voice-over", "narration", "expressive"],
    features: ["audio-tags", "voice-cloning"],
    pricing: [{ identifier: "elevenlabs-v3", credits: 4 }],
    featured: true,
  },
  "elevenlabs-turbo": {
    id: "elevenlabs-turbo",
    kind: "audio",
    modes: ["tts"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs Turbo v2.5",
    description: "Fast, cheap ElevenLabs TTS via KIE. Good for narration.",
    useCases: ["tts", "narration", "fast"],
    pricing: [{ identifier: "elevenlabs-turbo", credits: 2, note: "per 1K chars" }],
  },
  "elevenlabs-multilingual": {
    id: "elevenlabs-multilingual",
    kind: "audio",
    modes: ["tts"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs Multilingual v2",
    description: "Multi-language ElevenLabs TTS via KIE.",
    useCases: ["tts", "multilingual"],
    pricing: [{ identifier: "elevenlabs-multilingual", credits: 4, note: "per 1K chars" }],
  },
  "elevenlabs-dialogue": {
    id: "elevenlabs-dialogue",
    kind: "audio",
    modes: ["tts"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs Dialogue v3",
    description: "Multi-speaker dialogue TTS — give it a script, it voices each role.",
    useCases: ["tts", "dialogue", "multi-speaker"],
    pricing: [{ identifier: "elevenlabs-dialogue", credits: 5, note: "per 1K chars" }],
  },

  // ── ElevenLabs voice utilities ──
  "voice-clone": {
    id: "voice-clone",
    kind: "audio",
    modes: ["voice-clone"] as const,
    family: "ElevenLabs",
    label: "Voice Clone (Instant)",
    description: "Clone a voice from a short reference clip. Instant clone via direct ElevenLabs API.",
    useCases: ["voice-clone", "personalization"],
    pricing: [{ identifier: "voice-clone", credits: 5 }],
  },
  "elevenlabs-voice-design": {
    id: "elevenlabs-voice-design",
    kind: "audio",
    modes: ["voice-design"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs Voice Design",
    description: "Design a synthetic voice from a description (no reference clip needed).",
    useCases: ["voice-design", "synthetic"],
    pricing: [{ identifier: "elevenlabs-voice-design", credits: 5 }],
  },
  "elevenlabs-voice-changer": {
    id: "elevenlabs-voice-changer",
    kind: "audio",
    modes: ["voice-changer"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs Voice Changer",
    description: "Speech-to-speech: convert one voice to another while preserving prosody.",
    useCases: ["voice-conversion", "dubbing"],
    pricing: [{ identifier: "elevenlabs-voice-changer", credits: 4 }],
  },
  "elevenlabs-stt": {
    id: "elevenlabs-stt",
    kind: "audio",
    modes: ["stt"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs STT",
    description: "Speech-to-text — transcribe audio with timestamps.",
    useCases: ["transcription", "stt"],
    pricing: [{ identifier: "elevenlabs-stt", credits: 3 }],
  },
  "elevenlabs-isolation": {
    id: "elevenlabs-isolation",
    kind: "audio",
    modes: ["isolation"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs Voice Isolation",
    description: "Strip background noise / music from a vocal track.",
    useCases: ["cleanup", "isolation"],
    pricing: [{ identifier: "elevenlabs-isolation", credits: 8, note: "variable per second" }],
  },
  "elevenlabs-dubbing": {
    id: "elevenlabs-dubbing",
    kind: "audio",
    modes: ["dubbing"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs Dubbing",
    description: "Translate + dub a video into a new language. Async.",
    useCases: ["dubbing", "multilingual"],
    pricing: [{ identifier: "elevenlabs-dubbing", credits: 8 }],
  },
  "elevenlabs-forced-alignment": {
    id: "elevenlabs-forced-alignment",
    kind: "audio",
    modes: ["forced-alignment"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs Forced Alignment",
    description: "Align an existing transcript to audio with word-level timestamps.",
    useCases: ["alignment", "captions"],
    pricing: [{ identifier: "elevenlabs-forced-alignment", credits: 3 }],
  },

  // ── ElevenLabs SFX ──
  "elevenlabs-sfx": {
    id: "elevenlabs-sfx",
    kind: "audio",
    modes: ["sfx"] as const,
    family: "ElevenLabs",
    label: "ElevenLabs Sound Effects",
    description: "Generate short sound effects from a text prompt.",
    useCases: ["sfx", "ambient"],
    pricing: [{ identifier: "elevenlabs-sfx", credits: 1, note: "~5s clip" }],
  },

  // ── Suno music ──
  "suno": {
    id: "suno",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    label: "Suno v4",
    description: "Suno v4 music generation — full songs with vocals, multiple genres.",
    useCases: ["music", "song", "vocals"],
    pricing: [{ identifier: "suno", credits: 4, note: "per generation" }],
  },
  "suno-v5": {
    id: "suno-v5",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    label: "Suno v5",
    description: "Newer Suno v5 — better vocal quality, more genres. Same price as v4.",
    useCases: ["music", "song", "vocals", "premium"],
    pricing: [{ identifier: "suno-v5", credits: 4, note: "per generation" }],
    featured: true,
  },
}

// =============================================================================
// COMBINED CATALOG
// =============================================================================
export const MODEL_CATALOG: Record<string, ModelCatalogEntry> = {
  ...IMAGE_MODELS,
  ...VIDEO_MODELS,
  ...AUDIO_MODELS,
}

/**
 * Lookup helpers for MCP and the future frontend migration.
 */
export function listModels(filter?: {
  kind?: ModelKind
  mode?: ModelMode
  family?: string
}): ModelCatalogEntry[] {
  const all = Object.values(MODEL_CATALOG)
  if (!filter) return all
  return all.filter((m) => {
    if (filter.kind && m.kind !== filter.kind) return false
    if (filter.mode && !m.modes.includes(filter.mode)) return false
    if (filter.family && m.family.toLowerCase() !== filter.family.toLowerCase()) return false
    return true
  })
}

/**
 * Group entries by family, returning a stable order.
 * Returns Array<{ family: string; models: ModelCatalogEntry[] }>.
 */
export function groupByFamily(
  entries: ModelCatalogEntry[],
): Array<{ family: string; models: ModelCatalogEntry[] }> {
  const groups = new Map<string, ModelCatalogEntry[]>()
  for (const m of entries) {
    const list = groups.get(m.family)
    if (list) list.push(m)
    else groups.set(m.family, [m])
  }
  return Array.from(groups.entries()).map(([family, models]) => ({ family, models }))
}

export function getModel(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG[id]
}

// =============================================================================
// Per-model input validation
// =============================================================================
export type ValidationField =
  | "aspectRatio"
  | "resolution"
  | "quality"
  | "duration"

export interface ModelValidationIssue {
  field: ValidationField
  message: string
  allowed: readonly (string | number)[] | null
}

/**
 * Validate that the user's lever values are supported by the chosen model.
 *
 * Returns null on success or the FIRST issue found. We surface a single issue
 * rather than collecting all so the agent doesn't get a wall of complaints —
 * fix one thing, retry. Order: aspectRatio → resolution → quality → duration.
 *
 * Semantics:
 * - If the field is undefined, it's never an issue.
 * - If the catalog entry doesn't list a corresponding lever (e.g. base
 *   nano-banana has no `resolutions`), passing that field IS an issue —
 *   silently dropping it has caused two bugs already.
 * - If the value is in the allow list, it's valid.
 *
 * Unknown model ids are NOT flagged here — the route handler / Zod model
 * enum is the right gate for that. We just skip validation.
 */
export function validateModelInput(
  modelId: string,
  input: {
    aspectRatio?: string
    resolution?: string
    quality?: string
    duration?: number
  },
): ModelValidationIssue | null {
  const m = MODEL_CATALOG[modelId]
  if (!m) return null

  if (input.aspectRatio !== undefined) {
    if (!m.aspectRatios) {
      return {
        field: "aspectRatio",
        message: `Model "${modelId}" does not have an aspect_ratio lever — omit it.`,
        allowed: null,
      }
    }
    if (!m.aspectRatios.includes(input.aspectRatio)) {
      return {
        field: "aspectRatio",
        message: `Model "${modelId}" does not support aspect_ratio "${input.aspectRatio}". Supported: ${m.aspectRatios.join(", ")}.`,
        allowed: m.aspectRatios,
      }
    }
  }

  if (input.resolution !== undefined) {
    if (!m.resolutions) {
      return {
        field: "resolution",
        message: `Model "${modelId}" does not have a resolution lever — omit it.`,
        allowed: null,
      }
    }
    if (!m.resolutions.includes(input.resolution)) {
      return {
        field: "resolution",
        message: `Model "${modelId}" does not support resolution "${input.resolution}". Supported: ${m.resolutions.join(", ")}.`,
        allowed: m.resolutions,
      }
    }
  }

  if (input.quality !== undefined) {
    if (!m.qualities) {
      return {
        field: "quality",
        message: `Model "${modelId}" does not have a quality lever — omit it.`,
        allowed: null,
      }
    }
    if (!m.qualities.includes(input.quality)) {
      return {
        field: "quality",
        message: `Model "${modelId}" does not support quality "${input.quality}". Supported: ${m.qualities.join(", ")}.`,
        allowed: m.qualities,
      }
    }
  }

  if (input.duration !== undefined) {
    if (!m.durations) {
      return {
        field: "duration",
        message: `Model "${modelId}" does not have a duration lever — omit it.`,
        allowed: null,
      }
    }
    if (!m.durations.includes(input.duration)) {
      return {
        field: "duration",
        message: `Model "${modelId}" does not support duration ${input.duration}s. Supported: ${m.durations.join(", ")}s.`,
        allowed: m.durations,
      }
    }
  }

  return null
}

// =============================================================================
// Frontend picker helpers — return `{value, label}[]` shapes that the
// existing config-panel components expect, derived from the catalog so we
// don't duplicate registries between backend and frontend.
// =============================================================================

/**
 * Global value-label decorations. Per-model overrides live on
 * `ModelCatalogEntry.valueLabels` (e.g. Hailuo's "1080P (6s max)").
 *
 * Add entries here when a value should render with a richer human label.
 * Plain values (3:2, 4:3, 720p, etc.) can stay undecorated — the value
 * itself is the label and we fall back to `value` automatically.
 */
const MODEL_VALUE_LABELS: Record<string, string> = {
  // aspect ratios
  "1:1": "1:1 (Square)",
  "16:9": "16:9 (Landscape)",
  "9:16": "9:16 (Portrait)",
  "21:9": "21:9 (Ultra-wide)",
  "9:21": "9:21 (Tall ultra-wide)",
  "auto": "Auto",
  "adaptive": "Adaptive",
  // image resolutions
  "1K": "1K (Standard)",
  "2K": "2K (High)",
  "4K": "4K (Ultra)",
  "8K": "8K (Ultra)",
  // qualities
  "medium": "Medium (Balanced)",
  "high": "High (Detailed)",
  "basic": "Basic (2K)",
  "TURBO": "Turbo (fast)",
  "BALANCED": "Balanced",
  "QUALITY": "Quality (best)",
}

function decorateLabel(model: ModelCatalogEntry, value: string): string {
  return model.valueLabels?.[value] ?? MODEL_VALUE_LABELS[value] ?? value
}

export interface LabeledOption {
  value: string
  label: string
}

/** Return `{value, label}[]` for the model's aspect ratios, or `null` if none. */
export function getAspectRatioOptions(modelId: string): LabeledOption[] | null {
  const m = MODEL_CATALOG[modelId]
  if (!m?.aspectRatios) return null
  return m.aspectRatios.map((v) => ({ value: v, label: decorateLabel(m, v) }))
}

/** Return `{value, label}[]` for the model's resolution lever, or `null` if none. */
export function getResolutionOptions(modelId: string): LabeledOption[] | null {
  const m = MODEL_CATALOG[modelId]
  if (!m?.resolutions) return null
  return m.resolutions.map((v) => ({ value: v, label: decorateLabel(m, v) }))
}

/** Return `{value, label}[]` for the model's quality lever, or `null` if none. */
export function getQualityOptions(modelId: string): LabeledOption[] | null {
  const m = MODEL_CATALOG[modelId]
  if (!m?.qualities) return null
  return m.qualities.map((v) => ({ value: v, label: decorateLabel(m, v) }))
}

/** Return the model's allowed durations (in seconds), or `null` if none. */
export function getDurationsForModel(modelId: string): number[] | null {
  const m = MODEL_CATALOG[modelId]
  if (!m?.durations) return null
  return [...m.durations]
}

/**
 * Min/max credits across all pricing variants — used by the frontend's
 * "5–8 cr" range badge in the model dropdown. `null` for models with a
 * single price point.
 */
export function getCreditRange(modelId: string): { min: number; max: number } | null {
  const m = MODEL_CATALOG[modelId]
  if (!m || m.pricing.length < 2) return null
  let min = Infinity
  let max = -Infinity
  for (const p of m.pricing) {
    if (p.credits < min) min = p.credits
    if (p.credits > max) max = p.credits
  }
  return { min, max }
}

/** Whether the model declares a given capability flag in its `features` array. */
export function hasFeature(modelId: string, feature: string): boolean {
  return MODEL_CATALOG[modelId]?.features?.includes(feature) ?? false
}

/**
 * All ids in the catalog whose `features` includes the given flag. Used by
 * frontend to build PROVIDERS_WITH_END_FRAME / PROVIDERS_WITH_REFERENCES
 * lists derived from the catalog.
 */
export function modelsWithFeature(feature: string): string[] {
  return Object.values(MODEL_CATALOG)
    .filter((m) => m.features?.includes(feature))
    .map((m) => m.id)
}

/**
 * Map of `{modelId: durations[]}` for every catalog entry whose `modes`
 * includes the given mode. Used to derive KIE_VIDEO_DURATIONS (mode i2v)
 * and KIE_T2V_DURATIONS (mode t2v) on the frontend.
 */
export function durationsByMode(mode: ModelMode): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (!m.modes.includes(mode)) continue
    if (!m.durations) continue
    out[m.id] = [...m.durations]
  }
  return out
}

/**
 * Map of `{modelId: LabeledOption[]}` for every catalog entry of the given
 * kind that exposes a resolution lever. Used to derive
 * IMAGE_RESOLUTION_OPTIONS / VIDEO_RESOLUTION_OPTIONS on the frontend.
 */
export function resolutionOptionsByKind(kind: ModelKind): Record<string, LabeledOption[]> {
  const out: Record<string, LabeledOption[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.kind !== kind) continue
    if (!m.resolutions) continue
    out[m.id] = m.resolutions.map((v) => ({ value: v, label: decorateLabel(m, v) }))
  }
  return out
}

/**
 * Map of `{modelId: LabeledOption[]}` for every catalog entry of the given
 * kind that exposes an aspect_ratio lever.
 */
export function aspectRatioOptionsByKind(kind: ModelKind): Record<string, LabeledOption[]> {
  const out: Record<string, LabeledOption[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.kind !== kind) continue
    if (!m.aspectRatios) continue
    out[m.id] = m.aspectRatios.map((v) => ({ value: v, label: decorateLabel(m, v) }))
  }
  return out
}

/** Same shape as `aspectRatioOptionsByKind` but for `qualities`. */
export function qualityOptionsByKind(kind: ModelKind): Record<string, LabeledOption[]> {
  const out: Record<string, LabeledOption[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.kind !== kind) continue
    if (!m.qualities) continue
    out[m.id] = m.qualities.map((v) => ({ value: v, label: decorateLabel(m, v) }))
  }
  return out
}

/** All `{modelId: {min, max}}` entries that have variable pricing (>1 variant). */
export function creditRangesAll(): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    const range = getCreditRange(m.id)
    if (range) out[m.id] = range
  }
  return out
}

/**
 * Tuple of model ids for a given kind + one or more modes. Built for use as
 * a Zod `z.enum()` argument so MCP tool input schemas stay in sync with the
 * catalog without manual maintenance.
 *
 * Filters out `mcpHidden: true` entries by default — pass `includeHidden`
 * to surface legacy versions (used internally by validators that still need
 * to recognize older ids forwarded by direct API callers).
 *
 * Pass `kind: null` to skip the kind filter — useful for cross-kind ids
 * like "grok" (catalog kind=image, modes include both t2i and t2v).
 */
export function modelIdsByKindMode(
  kind: ModelKind | null,
  modes: readonly ModelMode[],
  opts: { includeHidden?: boolean } = {},
): [string, ...string[]] {
  const includeHidden = opts.includeHidden === true
  const ids = Object.values(MODEL_CATALOG)
    .filter((m) => (kind === null ? true : m.kind === kind))
    .filter((m) => m.modes.some((md) => modes.includes(md)))
    .filter((m) => includeHidden || !m.mcpHidden)
    .map((m) => m.id)
    .sort()
  if (ids.length === 0) {
    throw new Error(
      `modelIdsByKindMode: no models match kind=${kind ?? "*"} modes=[${modes.join(",")}]`,
    )
  }
  return ids as [string, ...string[]]
}
