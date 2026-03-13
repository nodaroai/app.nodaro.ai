/**
 * Model constants shared between frontend and backend.
 * Single source of truth for model capability sets and variable pricing rules.
 */

// Models that accept negative_prompt as a native API parameter.
// All other models get negative prompt appended to the prompt text as "Avoid: ...".
export const NATIVE_NEGATIVE_PROMPT_MODELS = new Set([
  "imagen4", "imagen4-fast", "imagen4-ultra",
  "ideogram-remix", "ideogram-v3",
  "qwen", "qwen-edit",
])

// Text-to-image models that accept reference images via their API.
// All other T2I models silently ignore reference images.
export const MODELS_WITH_REFERENCE_IMAGE_SUPPORT = new Set([
  "nano-banana",
  "nano-banana-pro",
  "nano-banana-2",
])

// Variable pricing: which setting type affects cost per provider
export const VARIABLE_PRICING_MODELS: Record<string, "quality" | "resolution"> = {
  "gpt-image": "quality",
  "gpt-image-i2i": "quality",
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
}


// Models where quality=high triggers composite credit identifier
export const HIGH_QUALITY_PROVIDERS = new Set(["gpt-image", "gpt-image-i2i", "seedream", "seedream-edit", "seedream-5-lite", "seedream-5-lite-i2i"])

// Models where resolution=2K triggers composite credit identifier
export const TWO_K_RESOLUTION_PROVIDERS = new Set(["flux", "flux-pro-i2i", "flux-flex", "flux-i2i"])

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
] as const

/** Image-to-image providers (require input image) */
export const IMAGE_I2I_PROVIDERS = [
  "nano-banana",
  "nano-banana-pro",
  "grok-i2i",
  "flux-i2i",
  "flux-pro-i2i",
  "gpt-image-i2i",
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
] as const

// Derived types from provider arrays
export type ImageGenProvider = typeof IMAGE_GEN_PROVIDERS[number]
export type ImageI2IProvider = typeof IMAGE_I2I_PROVIDERS[number]
export type ImageEditProvider = typeof IMAGE_EDIT_PROVIDERS[number]

/** Image-to-video providers */
export const IMAGE_TO_VIDEO_PROVIDERS = [
  "minimax",
  "veo3",
  "veo3.1",
  "kling",
  "kling-turbo",
  "kling-3.0",
  "kling-master",
  "seedance",
  "hailuo-2.3-pro",
  "hailuo-2.3",
  "hailuo-standard",
  "sora2-pro",
  "sora2",
  "wan-i2v",
  "wan-turbo",
  "bytedance-lite",
  "bytedance-pro",
  "bytedance-pro-fast",
  "grok-i2v",
  "veo",
  "runway-kie",
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
  "kling",
  "kling-turbo",
  "kling-3.0",
  "veo",
  "grok",
  "sora2-pro",
  "seedance",
  "wan",
  "sora2",
  "hailuo-standard",
  "bytedance-lite",
  "bytedance-pro",
  "wan-turbo",
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
  "luma-modify",
  "runway-aleph",
] as const
export type VideoToVideoProvider = typeof VIDEO_TO_VIDEO_PROVIDERS[number]

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
] as const
export type LipSyncProvider = typeof LIP_SYNC_PROVIDERS[number]

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
  // Other models may be added after verification confirms variable pricing
])

/**
 * Video models where enabling audio/sound incurs an additional cost.
 * The audio addon is expressed as a separate composite identifier suffix.
 */
export const AUDIO_ADDON_PROVIDERS = new Set([
  "kling-3.0",
  // Other models may be added after verification
])

/**
 * Video variable pricing config — which params affect credit cost per model.
 * "duration" = cost varies by video length
 * "duration+audio" = cost varies by length AND audio on/off
 */
export const VIDEO_VARIABLE_PRICING: Record<string, "duration" | "duration+audio"> = {
  "kling-3.0": "duration+audio",
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
