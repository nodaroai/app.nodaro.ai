/**
 * Model constants shared between frontend and backend.
 * Single source of truth for model capability sets and variable pricing rules.
 */
import { z } from "zod"

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
  // Replicate "Open" (uncensored) image models
  "flux-2-klein",
  "kontext-multi",
  "flux-2-pro",
  "flux-2-max",
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
  // Replicate Open models — Klein takes an optional single ref; Kontext Multi
  // accepts up to 4 numbered input images; Flux 2 Pro up to 4; Max up to 8.
  "flux-2-klein": 1,
  "kontext-multi": 4,
  "flux-2-pro": 4,
  "flux-2-max": 8,
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
  // Replicate Open (uncensored) — runs through Replicate, not KIE
  "flux-2-klein",
  "flux-2-pro",
  "flux-2-max",
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
  // Replicate Open (uncensored) — multi-image Kontext via Replicate
  "kontext-multi",
  // BFL Flux 2 Pro — runs through Replicate with safety_tolerance=5 (max for Pro)
  "flux-2-pro",
  // BFL Flux 2 Max — runs through Replicate with safety_tolerance=5, up to 8 refs
  "flux-2-max",
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

/** Suno models that support add-instrumental / add-vocals operations */
export const SUNO_ADD_TRACK_MODELS = ["V4_5PLUS", "V5", "V5_5"] as const
export type SunoAddTrackModel = typeof SUNO_ADD_TRACK_MODELS[number]

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
  "flux-2-klein", "kontext-multi",
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

/**
 * Google VEO family (Quality / Fast / Lite). VEO goes through its own KIE
 * endpoint and image-handling path, so callers branch on this in several places.
 */
export const VEO_PROVIDERS = new Set<string>([
  "veo3",
  "veo3.1",
  "veo3_lite",
])

export function isVeoProvider(provider: string | undefined): boolean {
  return !!provider && VEO_PROVIDERS.has(provider)
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

/** Curated i2v providers compatible with character portrait reference input.
 *  Subset of IMAGE_TO_VIDEO_PROVIDERS — excludes text-to-video-only models. */
export const CHARACTER_MOTION_PROVIDERS = [
  "kling",
  "kling-turbo",
  "kling-3.0",
  "wan-i2v",
  "wan-2.7-i2v",
] as const
export type CharacterMotionProvider = typeof CHARACTER_MOTION_PROVIDERS[number]

/**
 * Atmospheric video providers available to the Location Studio's motion tab.
 *
 * Tuned for ambient camera moves (dolly, pan, drift, parallax) rather than
 * character-driven motion. Subset of registered i2v providers; `seedance-2`
 * added as the cinematic option for establishing shots.
 *
 * Mirrors `CHARACTER_MOTION_PROVIDERS` shape — see entity-prompts.ts for the
 * naming convention.
 */
export const LOCATION_ATMOSPHERE_PROVIDERS = [
  "kling",
  "kling-turbo",
  "kling-3.0",
  "wan-i2v",
  "wan-2.7-i2v",
  "seedance-2",
] as const
export type LocationAtmosphereProvider =
  (typeof LOCATION_ATMOSPHERE_PROVIDERS)[number]

// =====================================================================
// Scene Input Modes + Video Model Capability Registry (v4.0 + v4.1 spec §6.10)
// =====================================================================

/**
 * SceneInputMode — the input-shape contract a video model exposes to the
 * Scene Director. Gates which `video_model` values are valid for a given
 * scene's `shot_input_mode`. Consumed by Scene Director LLM prompting,
 * route Zod validation, and the frontend SceneNode config panel.
 *
 * See architecture spec §6.10 + v4.1 Methods 2/3/8/10 for per-mode semantics.
 */
export const SceneInputModeSchema = z.enum([
  "text", // text-to-video
  "first_frame", // i2v with start image only
  "first_last_frame", // i2v with paired start+end (v4.1 Method 2)
  "ref_images", // multi-ref consistency models
  "multi_shot", // native multi-shot models (Kling Omni, Seedance multi)
  "video_continuation", // v4.1 Method 3 — extend prior clip (VEO extend, Seedance video-ref)
  "frame_interpolation", // v4.1 Method 8 — N sparse keyframes → interpolated video
  "camera_path", // v4.1 Method 10 — parametric 3D camera path
])
export type SceneInputMode = z.infer<typeof SceneInputModeSchema>

/**
 * Prompting style each model expects from the Scene Director.
 * Veo-family wants comma-separated cinematic tags; Kling-family wants
 * natural-language prose; Hailuo-family wants compact single-sentence prompts.
 */
export type ModelPromptingStyle =
  | "cinematic_tag_heavy" // Veo-family — comma-separated tags
  | "natural_language" // Kling-family — prose descriptions
  | "compact" // Hailuo-family — single-sentence

export interface VideoModelCapabilities {
  inputModes: SceneInputMode[]
  maxShotsPerCall?: number // for multi_shot models
  supportsLipSyncIntegrated?: boolean // Kling Avatar / VEO-3 etc
  supportsVideoExtension?: boolean // v4.1 Method 3
  supportsCameraPath?: boolean // v4.1 Method 10
  maxInterpolationKeyframes?: number // v4.1 Method 8
  maxDurationSeconds: number
  prompting_style: ModelPromptingStyle
  /**
   * Maximum number of reference IMAGES the model accepts in one call,
   * including the start frame. Drives `allocateReferenceSlots` in
   * `backend/src/ee/pipelines/continuity.ts` (Phase 1C.1 §5.13.3) — when
   * the budget is 1, multi-shot/character/object refs are silently
   * dropped and the slot allocator emits a `pipeline:warning` event.
   * Defaults to 1 when omitted.
   */
  maxReferenceImages?: number
}

/**
 * VIDEO_MODEL_CAPS — single source of truth for what each video model supports.
 * Consumed by: Scene Director LLM (filters eligible models), route Zod validation
 * (rejects invalid video_model for the chosen shot_input_mode), frontend SceneNode
 * config panel (filters dropdown options).
 *
 * Adding a new video model: add an entry here, run audit-providers skill to verify
 * downstream wiring.
 */
export const VIDEO_MODEL_CAPS: Record<string, VideoModelCapabilities> = {
  "kling": {
    inputModes: ["first_frame", "first_last_frame", "text"],
    maxDurationSeconds: 10,
    prompting_style: "natural_language",
    maxReferenceImages: 1,
  },
  "kling-3-omni": {
    inputModes: ["ref_images", "multi_shot"],
    maxShotsPerCall: 5,
    maxDurationSeconds: 15,
    prompting_style: "natural_language",
    // Kling Omni accepts a strong multi-ref budget (start frame + up to
    // ~6 character/scene refs). Drives `allocateReferenceSlots` in
    // continuity.ts to surface all of them.
    maxReferenceImages: 7,
  },
  "veo3.1": {
    inputModes: ["first_frame", "text", "video_continuation"],
    supportsVideoExtension: true,
    maxDurationSeconds: 8,
    prompting_style: "cinematic_tag_heavy",
    maxReferenceImages: 1,
  },
  "seedance-2": {
    inputModes: ["first_frame", "first_last_frame", "ref_images", "video_continuation"],
    supportsVideoExtension: true,
    maxDurationSeconds: 10,
    prompting_style: "natural_language",
    // SEEDANCE_2_REF_LIMITS.images is the hard upper bound (9). 1C.1
    // caps to a more conservative 5 to leave headroom for primary
    // character + location + 3 secondary refs.
    maxReferenceImages: 5,
  },
  "hailuo-2.3-pro": {
    inputModes: ["first_frame", "text"],
    maxDurationSeconds: 10,
    prompting_style: "compact",
    maxReferenceImages: 1,
  },
  "hailuo-standard": {
    inputModes: ["first_frame", "first_last_frame"],
    maxDurationSeconds: 6,
    prompting_style: "compact",
    maxReferenceImages: 1,
  },
  "minimax": {
    inputModes: ["first_frame", "first_last_frame"],
    maxDurationSeconds: 6,
    prompting_style: "compact",
    maxReferenceImages: 1,
  },
  "kling-turbo": {
    inputModes: ["first_frame", "first_last_frame"],
    maxDurationSeconds: 10,
    prompting_style: "natural_language",
    maxReferenceImages: 1,
  },
  "bytedance-lite": {
    inputModes: ["first_frame", "first_last_frame"],
    maxDurationSeconds: 10,
    prompting_style: "compact",
    maxReferenceImages: 1,
  },
}

/**
 * modelsForInputMode — filter VIDEO_MODEL_CAPS to models that support the given mode.
 * Used at three call sites: Scene Director prompt construction, route Zod validation,
 * frontend config panel dropdown options.
 */
export const modelsForInputMode = (mode: SceneInputMode): string[] =>
  Object.entries(VIDEO_MODEL_CAPS)
    .filter(([, caps]) => caps.inputModes.includes(mode))
    .map(([model]) => model)
