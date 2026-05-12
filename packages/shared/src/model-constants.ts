/**
 * Model constants shared between frontend and backend.
 * Single source of truth for model capability sets and variable pricing rules.
 */

/** Base USD cost per 1 Nodaro credit (before markup). Used for cost→credit conversion. */
export const CREDIT_BASE_USD = 0.02

// Models that accept negative_prompt as a native API parameter.
// All other models get negative prompt appended to the prompt text as "Avoid: ...".
export const NATIVE_NEGATIVE_PROMPT_MODELS = new Set([
  "imagen4", "imagen4-fast", "imagen4-ultra",
  "ideogram-remix", "ideogram-v3",
  "qwen", "qwen-edit",
])

// Image providers that natively use reference images in their API.
// Used by `buildImagePrompt` to filter referenceImageUrls before sending,
// and by the frontend to warn when the user has `{image:N:label}` tokens
// in a prompt for a provider that would silently ignore them.
//
// Verified against backend/src/providers/kie/models.ts (inputType +
// imageParam) and the i2i flow in backend/src/providers/kie/image.ts.
//
// Image providers that natively use reference images in their API.
//
// Two categories included:
//  1. Direct ref support: nano-banana family (multi-ref T2I) + flux-kontext
//     (single image edit) + all i2i/edit variants.
//  2. Auto-switched: T2I models that have an i2i sibling — when the user
//     attaches refs to one of these in a generate-image node, the backend
//     route silently routes to the i2i sibling. See `T2I_TO_I2I_VARIANT`.
//     User-facing benefit: pick GPT Image / Grok / Qwen / Seedream / Flux at
//     the dropdown, attach refs, and they "just work".
//
// Excluded (no ref support and no i2i sibling — refs would be useless):
//   imagen4, imagen4-fast, imagen4-ultra, ideogram-v3, z-image
export const MODELS_WITH_REFERENCE_IMAGE_SUPPORT = new Set([
  // Multi-reference text-to-image
  "nano-banana",
  "nano-banana-pro",
  "nano-banana-2",
  // T2I providers that auto-route to their i2i sibling when refs are attached
  "gpt-image",
  "gpt-image-2",
  "grok",
  "qwen",
  "seedream",
  "seedream-5-lite",
  "flux",
  "flux-flex",
  // Image editing / image-to-image (reference = source image)
  "nano-banana-edit",
  "gpt-image-i2i",
  "gpt-image-2-i2i",
  "flux-i2i",
  "flux-pro-i2i",
  "flux-kontext",
  "flux-kontext-max",
  "ideogram-edit",
  "ideogram-remix",
  "ideogram-reframe",
  "qwen-i2i",
  "qwen-edit",
  "seedream-edit",
  "seedream-5-lite-i2i",
  "grok-i2i",
  // Upscale / background ops (source acts as the reference)
  "recraft-remove-bg",
  "recraft-upscale",
  "topaz-image-upscale",
  // Wan 2.7 — accepts up to 9 optional ref images via input_urls (pure T2I when omitted)
  "wan-2.7",
])

/**
 * T2I provider → i2i sibling. When a generate-image node carries reference
 * images and the chosen provider is in this map, the backend route
 * transparently routes to the i2i variant so the refs are actually used.
 *
 * The user keeps seeing the T2I name in the UI; the warning component shows
 * an info hint that the i2i variant is being used under the hood.
 */
export const T2I_TO_I2I_VARIANT: Record<string, string> = {
  "gpt-image": "gpt-image-i2i",
  "gpt-image-2": "gpt-image-2-i2i",
  "grok": "grok-i2i",
  "qwen": "qwen-i2i",
  "seedream": "seedream-edit",
  "seedream-5-lite": "seedream-5-lite-i2i",
  "flux": "flux-pro-i2i",
  "flux-flex": "flux-i2i",
}

/**
 * Maximum number of reference images each provider accepts.
 * Sourced from the corresponding KIE.ai endpoint's documented input array
 * size, or from the model's natural input shape (single-source i2i = 1).
 *
 * Providers absent from this map default to `DEFAULT_REF_IMAGE_MAX` (4).
 * Providers absent from `MODELS_WITH_REFERENCE_IMAGE_SUPPORT` ignore
 * reference images entirely regardless of this value.
 */
export const REF_IMAGE_MAX_LIMITS: Record<string, number> = {
  // Multi-reference T2I (Nano Banana family is the only T2I family that
  // actually accepts ref URLs via the KIE wrapper's `image_input` param).
  "nano-banana": 8,
  "nano-banana-pro": 8,
  "nano-banana-2": 4,
  "wan-2.7": 9,
  // Image-to-image (multi-source array)
  "nano-banana-edit": 8,
  "gpt-image-i2i": 16,
  "gpt-image-2-i2i": 16,
  "flux-i2i": 4,
  "flux-pro-i2i": 4,
  "seedream-edit": 16,
  "seedream-5-lite-i2i": 16,
  // Single-source i2i (one input image)
  "flux-kontext": 1,
  "flux-kontext-max": 1,
  "ideogram-edit": 1,
  "ideogram-remix": 1,
  "ideogram-reframe": 1,
  "qwen-i2i": 1,
  "qwen-edit": 1,
  "grok-i2i": 1,
  "recraft-remove-bg": 1,
  "recraft-upscale": 1,
  "topaz-image-upscale": 1,
}

export const DEFAULT_REF_IMAGE_MAX = 4

// Variable pricing: which setting type affects cost per provider
export const VARIABLE_PRICING_MODELS: Record<string, "quality" | "resolution" | "rendering-speed"> = {
  "gpt-image": "quality",
  "gpt-image-i2i": "quality",
  "gpt-image-2": "resolution",
  "gpt-image-2-i2i": "resolution",
  "nano-banana-pro": "resolution",
  "nano-banana-2": "resolution",
  "flux": "resolution",
  "flux-flex": "resolution",
  "flux-i2i": "resolution",
  "flux-pro-i2i": "resolution",
  "seedream": "quality",
  "seedream-edit": "quality",
  "seedream-5-lite": "quality",
  "seedream-5-lite-i2i": "quality",
  "topaz-image-upscale": "resolution",
  "ideogram-edit": "rendering-speed",
  "ideogram-remix": "rendering-speed",
  "ideogram-reframe": "rendering-speed",
  "ideogram-v3": "rendering-speed",
  "wan-2.7": "resolution",
  "wan-2.7-pro": "resolution",
}


// Models where quality=high triggers composite credit identifier
export const HIGH_QUALITY_PROVIDERS = new Set(["gpt-image", "gpt-image-i2i", "seedream", "seedream-edit", "seedream-5-lite", "seedream-5-lite-i2i"])

// Models where resolution=2K triggers composite credit identifier
export const TWO_K_RESOLUTION_PROVIDERS = new Set(["flux", "flux-pro-i2i", "flux-flex", "flux-i2i"])

// Models where both 2K and 4K resolutions trigger composite credit identifiers (1K is base)
export const RESOLUTION_2K_4K_TIERED_PROVIDERS = new Set([
  "nano-banana-2",
  "gpt-image-2",
  "gpt-image-2-i2i",
  "wan-2.7",
  "wan-2.7-pro",
])

// Ideogram family models with TURBO/QUALITY pricing variants
export const IDEOGRAM_PROVIDERS = new Set(["ideogram-edit", "ideogram-remix", "ideogram-reframe", "ideogram-v3"])

// =====================================================================
// Provider arrays (single source of truth for route Zod validation)
// =====================================================================

/** Text-to-image providers (no input image required) */
export const IMAGE_GEN_PROVIDERS = [
  "nano-banana",
  "flux",
  "nano-banana-pro",
  "nano-banana-2",
  "grok",
  "gpt-image",
  "gpt-image-2",
  "imagen4",
  "imagen4-fast",
  "imagen4-ultra",
  "ideogram-v3",
  "qwen",
  "seedream",
  "seedream-5-lite",
  "flux-flex",
  "flux-kontext",
  "flux-kontext-max",
  "z-image",
  "wan-2.7",
  "wan-2.7-pro",
] as const

/** Image-to-image providers (require input image) */
export const IMAGE_I2I_PROVIDERS = [
  "nano-banana",
  "nano-banana-2",
  "nano-banana-pro",
  "grok-i2i",
  "flux-i2i",
  "flux-pro-i2i",
  "gpt-image-i2i",
  "gpt-image-2-i2i",
  "ideogram-edit",
  "ideogram-remix",
  "ideogram-reframe",
  "qwen-i2i",
  "qwen-edit",
  "seedream-edit",
  "seedream-5-lite-i2i",
  "flux-kontext",
  "flux-kontext-max",
] as const

/** Image editing providers (upscale, remove bg, etc.) */
export const IMAGE_EDIT_PROVIDERS = [
  "recraft-upscale",
  "recraft-remove-bg",
  "nano-banana-edit",
  "topaz-image-upscale",
  // grok-upscale takes a prior Grok generation's task_id (NOT an image URL) —
  // see edit-image route for the taskId-vs-imageUrl branching.
  "grok-upscale",
] as const

/** Modify image providers (I2I + edit-with-prompt) */
export const MODIFY_IMAGE_PROVIDERS = [
  ...IMAGE_I2I_PROVIDERS,
  "nano-banana-edit",
] as const
export type ModifyImageProvider = typeof MODIFY_IMAGE_PROVIDERS[number]

/** Image upscale providers */
export const UPSCALE_IMAGE_PROVIDERS = [
  "recraft-upscale",
  "topaz-image-upscale",
] as const
export type UpscaleImageProvider = typeof UPSCALE_IMAGE_PROVIDERS[number]

// Derived types from provider arrays
export type ImageGenProvider = typeof IMAGE_GEN_PROVIDERS[number]
export type ImageI2IProvider = typeof IMAGE_I2I_PROVIDERS[number]
export type ImageEditProvider = typeof IMAGE_EDIT_PROVIDERS[number]

/** Image-to-video providers */
export const IMAGE_TO_VIDEO_PROVIDERS = [
  "minimax",
  "veo3",
  "veo3.1",
  "veo3_lite",
  "kling",
  "kling-turbo",
  "kling-3.0",
  "kling-master",
  "seedance",
  "seedance-2",
  "seedance-2-fast",
  "hailuo-2.3-pro",
  "hailuo-2.3",
  "hailuo-standard",
  "wan-i2v",
  "wan-turbo",
  "bytedance-lite",
  "bytedance-pro",
  "bytedance-pro-fast",
  "grok-i2v",
  "wan-2.7-i2v",
  "happyhorse-i2v",
  "happyhorse-ref2v",
  "runway-kie",
  "kling-3-omni",
  // Replicate disabled
  // "runway",
  // "pika",
  // "sora",
] as const
export type ImageToVideoProvider = typeof IMAGE_TO_VIDEO_PROVIDERS[number]

/** Text-to-video providers */
export const TEXT_TO_VIDEO_PROVIDERS = [
  "minimax",
  "veo3",
  "veo3.1",
  "veo3_lite",
  "kling",
  "kling-turbo",
  "kling-3.0",
  "grok",
  "seedance",
  "seedance-2",
  "seedance-2-fast",
  "wan",
  "hailuo-standard",
  "bytedance-lite",
  "bytedance-pro",
  "wan-turbo",
  "wan-2.7-t2v",
  "happyhorse",
  "runway-kie",
  // Replicate disabled
  // "runway",
  // "pika",
  // "sora",
] as const
export type TextToVideoProvider = typeof TEXT_TO_VIDEO_PROVIDERS[number]

/** Video-to-video providers */
export const VIDEO_TO_VIDEO_PROVIDERS = [
  "wan",
  "wan-flash",
  "wan-videoedit",
  "luma-modify",
  "runway-aleph",
  "happyhorse-edit",
] as const
export type VideoToVideoProvider = typeof VIDEO_TO_VIDEO_PROVIDERS[number]

/** Face swap providers */
export const FACE_SWAP_PROVIDERS = [
  "roop",
] as const
export type FaceSwapProvider = typeof FACE_SWAP_PROVIDERS[number]

/** Video upscale providers */
export const VIDEO_UPSCALE_PROVIDERS = [
  "topaz",
  "veo-1080p",
  "veo-4k",
] as const
export type VideoUpscaleProvider = typeof VIDEO_UPSCALE_PROVIDERS[number]

/** Extend video providers */
export const EXTEND_VIDEO_PROVIDERS = [
  "veo-extend",
  "runway-extend",
] as const
export type ExtendVideoProvider = typeof EXTEND_VIDEO_PROVIDERS[number]

/** Lip sync providers */
export const LIP_SYNC_PROVIDERS = [
  "kling-avatar",
  "kling-avatar-pro",
  "infinitalk",
  "latentsync",
  "wav2lip",
  "video-retalking",
  "sadtalker",
  // Seedance 2 / 2 Fast — not "lip-sync models" per se, but ByteDance's
  // multimodal video models do native phoneme-level lip sync in 8+
  // languages when fed `reference_audio_urls` alongside a `first_frame_url`.
  // Routed through the i2v provider with the audio passed as a reference,
  // not the dedicated lip-sync flow.
  "seedance-2",
  "seedance-2-fast",
] as const
export type LipSyncProvider = typeof LIP_SYNC_PROVIDERS[number]

/** Seedance variants exposed via the lip-sync surface. They go through
 *  the i2v provider with the audio plumbed as `reference_audio_urls`. */
export const SEEDANCE_LIP_SYNC_PROVIDERS = new Set([
  "seedance-2",
  "seedance-2-fast",
] as const)

/** Replicate-based lip-sync providers (video or image+audio via Replicate SDK) */
export const REPLICATE_LIP_SYNC_PROVIDERS = new Set([
  "latentsync",
  "wav2lip",
  "video-retalking",
  "sadtalker",
] as const)

/** Lip-sync providers that require video input (not image) */
export const VIDEO_INPUT_LIP_SYNC_PROVIDERS = new Set([
  "latentsync",
  "video-retalking",
] as const)

/** Lip-sync providers that accept either video or image input */
export const FLEXIBLE_INPUT_LIP_SYNC_PROVIDERS = new Set([
  "wav2lip",
] as const)

/** Standard aspect ratio → pixel dimensions for composition nodes */
export const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
}

/** Motion transfer providers */
export const MOTION_TRANSFER_PROVIDERS = [
  "kling",
  "kling-3.0",
  "wan-animate-move",
  "wan-animate-replace",
] as const
export type MotionTransferProviderType = typeof MOTION_TRANSFER_PROVIDERS[number]

/** Text-to-speech providers */
export const TTS_PROVIDERS = [
  "elevenlabs-v3",
  "elevenlabs-turbo",
  "elevenlabs-multilingual",
  "elevenlabs",
] as const
export type TtsProvider = typeof TTS_PROVIDERS[number]

/** Text-to-audio providers */
export const TEXT_TO_AUDIO_PROVIDERS = [
  // Replicate disabled
  // "tangoflux",
  "elevenlabs-sfx",
] as const
export type TextToAudioProvider = typeof TEXT_TO_AUDIO_PROVIDERS[number]

/** Music generation providers */
export const MUSIC_PROVIDERS = [
  // Replicate disabled
  // "musicgen",
  "minimax",
  // TODO: surface Suno V5 here for discoverability — needs backend wiring
  // through suno-client.ts (Suno uses /api/v1/generate, NOT the standard
  // /api/v1/jobs/createTask path runKieTask uses). Tracked as a separate
  // follow-up PR. Until then, Suno is reachable via the standalone
  // `suno-generate` node.
  // Replicate disabled
  // "lyria",
  // "bark",
] as const
export type MusicProvider = typeof MUSIC_PROVIDERS[number]

/** Transcription providers */
export const TRANSCRIBE_PROVIDERS = [
  // Replicate disabled
  // "whisper",
  // "incredibly-fast-whisper",
  "elevenlabs-stt",
] as const
export type TranscribeProvider = typeof TRANSCRIBE_PROVIDERS[number]

/** Script generation providers */
export const SCRIPT_PROVIDERS = [
  "gemini",
  "claude",
  "gpt",
] as const
export type ScriptProvider = typeof SCRIPT_PROVIDERS[number]

/** AI writer providers */
export const AI_WRITER_PROVIDERS = [
  "claude",
] as const
export type AiWriterProvider = typeof AI_WRITER_PROVIDERS[number]

/** QA check providers */
export const QA_CHECK_PROVIDERS = [
  "claude",
  "gpt",
] as const
export type QaCheckProvider = typeof QA_CHECK_PROVIDERS[number]

/** Suno model versions */
export const SUNO_MODELS = [
  "V4",
  "V4_5",
  "V4_5PLUS",
  "V4_5ALL",
  "V5",
  "V5_5",
] as const
export type SunoModel = typeof SUNO_MODELS[number]

/** Voice design models */
export const VOICE_DESIGN_MODELS = [
  "eleven_ttv_v3",
  "eleven_multilingual_ttv_v2",
] as const
export type VoiceDesignModel = typeof VOICE_DESIGN_MODELS[number]

/** I2I providers that support mask-based inpainting */
export const I2I_MASK_SUPPORT = new Set(["ideogram-edit"])

/** I2I providers that support a strength/denoising parameter */
export const I2I_STRENGTH_SUPPORT: Record<string, { min: number; max: number; step: number; default: number }> = {
  "ideogram-remix": { min: 0.01, max: 1, step: 0.01, default: 0.8 },
  "qwen-i2i": { min: 0, max: 1, step: 0.01, default: 0.8 },
}

/** Models that accept a seed parameter for reproducible generation */
export const SEED_SUPPORT = new Set([
  "ideogram-remix", "ideogram-reframe", "ideogram-v3",
  "qwen", "qwen-i2i", "qwen-edit",
  "flux", "flux-flex", "flux-i2i", "flux-pro-i2i", "flux-kontext", "flux-kontext-max",
])

/** Ideogram models that support rendering_speed selection (TURBO/BALANCED/QUALITY) */
export const RENDERING_SPEED_SUPPORT = new Set([
  "ideogram-remix", "ideogram-reframe", "ideogram-v3",
])

/** Models that accept guidance_scale for controlling prompt adherence */
export const GUIDANCE_SCALE_SUPPORT: Record<string, { min: number; max: number; step: number; default: number }> = {
  "qwen-i2i": { min: 1, max: 20, step: 0.5, default: 7 },
  "qwen-edit": { min: 1, max: 20, step: 0.5, default: 7 },
}

// =====================================================================
// Video variable pricing — duration-based and audio-addon pricing
// =====================================================================

/**
 * Video models where credit cost varies by duration.
 * Maps provider key → duration tier breakpoints.
 * Values are verified by the pricing verification script (backend/scripts/verify-kie-pricing.ts).
 * TODO: Run verification script and update costs after confirming actual KIE pricing.
 */
export const DURATION_PRICED_PROVIDERS = new Set([
  "kling-3.0",
  "kling-3-omni",
  "kling",
  "kling-turbo",
  "kling-master",
  "grok-i2v",
  "wan-i2v",
  "hailuo-2.3-pro",
  "hailuo-2.3",
  "hailuo-standard",
  "seedance",
  "seedance-2",
  "seedance-2-fast",
])

/**
 * Seedance 2.0 family — shared across UI gating, payload building, and pricing.
 * Expanded whenever a new Seedance 2.x variant ships.
 */
export const SEEDANCE_2_PROVIDERS = new Set<string>([
  "seedance-2",
  "seedance-2-fast",
])

export function isSeedance2Provider(provider: string | undefined): boolean {
  return !!provider && SEEDANCE_2_PROVIDERS.has(provider)
}

/** KIE.ai limits for Seedance 2.0 multimodal reference arrays. */
export const SEEDANCE_2_REF_LIMITS = {
  images: 9,
  videos: 3,
  audio: 3,
} as const

/**
 * Video models where credit cost depends on resolution AND whether a video
 * reference is connected. Identifier suffix: `:{resolution}[-ref]`.
 * Seedance 2.0 family uses per-second billing split 480p/720p × with-ref/no-ref.
 */
export const RESOLUTION_VIDEO_REF_PRICING = SEEDANCE_2_PROVIDERS

/**
 * Video models where enabling audio/sound incurs an additional cost.
 * The audio addon is expressed as a separate composite identifier suffix.
 */
export const AUDIO_ADDON_PROVIDERS = new Set([
  "kling-3.0",
  "kling",
])

/**
 * Video models where a quality/mode parameter (e.g., videoSize "high") incurs higher cost.
 * When provider is in this set and mode is "high", ":high" is appended to the identifier.
 */
export const MODE_ADDON_PROVIDERS = new Set<string>([
])

/**
 * VEO 3.x providers where credit cost depends on the requested output
 * resolution (720p default vs 1080p inline; 4K is via the separate
 * upgrade endpoint and isn't part of this set). When provider is in
 * this set and resolution !== "720p", `:1080p` is appended to the
 * identifier so the credit lookup hits the per-resolution rate.
 *
 * Per KIE pricing (verified 2026-05-06):
 *   veo3.1 (Fast): 720p=60 KIE cr, 1080p=65 KIE cr
 *   veo3_lite:    720p=30 KIE cr, 1080p=35 KIE cr
 *   veo3 (Quality) is not in this set yet — pricing not in our reference data.
 */
export const VEO_RESOLUTION_TIERED_PROVIDERS = new Set<string>([
  "veo3.1",
  "veo3_lite",
])

/**
 * Video variable pricing config — which params affect credit cost per model.
 * "duration" = cost varies by video length
 * "duration+audio" = cost varies by length AND audio on/off
 */
export const VIDEO_VARIABLE_PRICING: Record<string, "duration" | "duration+audio" | "duration+mode" | "duration+resolution+ref"> = {
  "kling-3.0": "duration+audio",
  "kling-3-omni": "duration",
  "kling": "duration+audio",
  "kling-turbo": "duration",
  "kling-master": "duration",
  "grok-i2v": "duration",
  "wan-i2v": "duration",
  "hailuo-2.3-pro": "duration",
  "hailuo-2.3": "duration",
  "hailuo-standard": "duration",
  "seedance": "duration",
  "seedance-2": "duration+resolution+ref",
  "seedance-2-fast": "duration+resolution+ref",
}

/**
 * Duration tier breakpoints for variable-priced video models.
 * Maps provider → array of { maxSeconds, suffix } in ascending order.
 * The first tier whose maxSeconds >= requested duration is used.
 */
export const VIDEO_DURATION_TIERS: Record<string, Array<{ maxSeconds: number; suffix: string }>> = {
  "kling-3.0": [
    { maxSeconds: 5, suffix: "5s" },
    { maxSeconds: 10, suffix: "10s" },
    { maxSeconds: 15, suffix: "15s" },
  ],
  "kling-3-omni": [
    { maxSeconds: 5, suffix: "5s" },
    { maxSeconds: 10, suffix: "10s" },
    { maxSeconds: 15, suffix: "15s" },
  ],
  "kling": [
    { maxSeconds: 5, suffix: "5s" },
    { maxSeconds: 10, suffix: "10s" },
  ],
  "kling-turbo": [
    { maxSeconds: 5, suffix: "5s" },
    { maxSeconds: 10, suffix: "10s" },
  ],
  "kling-master": [
    { maxSeconds: 5, suffix: "5s" },
    { maxSeconds: 10, suffix: "10s" },
  ],
  "grok-i2v": [
    { maxSeconds: 6, suffix: "6s" },
    { maxSeconds: 10, suffix: "10s" },
    { maxSeconds: 15, suffix: "15s" },
  ],
  "wan-i2v": [
    { maxSeconds: 5, suffix: "5s" },
    { maxSeconds: 10, suffix: "10s" },
    { maxSeconds: 15, suffix: "15s" },
  ],
  "hailuo-2.3-pro": [
    { maxSeconds: 6, suffix: "6s" },
    { maxSeconds: 10, suffix: "10s" },
  ],
  "hailuo-2.3": [
    { maxSeconds: 6, suffix: "6s" },
    { maxSeconds: 10, suffix: "10s" },
  ],
  "hailuo-standard": [
    { maxSeconds: 6, suffix: "6s" },
    { maxSeconds: 10, suffix: "10s" },
  ],
  "seedance": [
    { maxSeconds: 4, suffix: "4s" },
    { maxSeconds: 8, suffix: "8s" },
    { maxSeconds: 12, suffix: "12s" },
  ],
  "seedance-2": [
    { maxSeconds: 4, suffix: "4s" },
    { maxSeconds: 8, suffix: "8s" },
    { maxSeconds: 12, suffix: "12s" },
    { maxSeconds: 15, suffix: "15s" },
  ],
  "seedance-2-fast": [
    { maxSeconds: 4, suffix: "4s" },
    { maxSeconds: 8, suffix: "8s" },
    { maxSeconds: 12, suffix: "12s" },
    { maxSeconds: 15, suffix: "15s" },
  ],
}

/**
 * Maps composer node types to their plan type identifier and the node data field
 * where the plan is stored. Used by render-video payload building, plan syncing,
 * and the frontend DAG executor.
 */
export const COMPOSER_PLAN_MAP: Readonly<Record<string, { planType: string; planField: string }>> = {
  "video-composer": { planType: "scene-graph", planField: "sceneGraph" },
  "after-effects": { planType: "after-effects", planField: "effectPlan" },
  "lottie-overlay": { planType: "lottie-overlay", planField: "overlayPlan" },
  "3d-title": { planType: "3d-title", planField: "titlePlan" },
  "motion-graphics": { planType: "motion-graphics", planField: "motionPlan" },
  "composite": { planType: "composite", planField: "compositePlan" },
}

/**
 * Duration tier breakpoints for motion control pricing (per-second billing).
 * Same shape as VIDEO_DURATION_TIERS entries but with 30s tier for long reference videos.
 */
export const MOTION_DURATION_TIERS: ReadonlyArray<{ maxSeconds: number; suffix: string }> = [
  { maxSeconds: 5, suffix: "5s" },
  { maxSeconds: 10, suffix: "10s" },
  { maxSeconds: 15, suffix: "15s" },
  { maxSeconds: 30, suffix: "30s" },
]
