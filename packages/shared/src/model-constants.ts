/**
 * Model constants shared between frontend and backend.
 * Single source of truth for model capability sets and variable pricing rules.
 */

// Models that accept negative_prompt as a native API parameter.
// All other models get negative prompt appended to the prompt text as "Avoid: ...".
export const NATIVE_NEGATIVE_PROMPT_MODELS = new Set([
  "imagen4", "imagen4-fast", "imagen4-ultra",
  "ideogram", "ideogram-remix",
  "qwen", "qwen-edit",
])

// Text-to-image models that accept reference images via their API.
// All other T2I models silently ignore reference images.
export const MODELS_WITH_REFERENCE_IMAGE_SUPPORT = new Set([
  "nano-banana",
  "nano-banana-pro",
  "nano-banana-2",
  "ideogram",
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
  "seedream-5-lite": "quality",
  "seedream-5-lite-i2i": "quality",
}


// Models where quality=high triggers composite credit identifier
export const HIGH_QUALITY_PROVIDERS = new Set(["gpt-image", "gpt-image-i2i", "seedream", "seedream-5-lite", "seedream-5-lite-i2i"])

// Models where resolution=2K triggers composite credit identifier
export const TWO_K_RESOLUTION_PROVIDERS = new Set(["flux", "flux-pro-i2i", "flux-flex", "flux-i2i"])

// Ideogram family models with TURBO/QUALITY pricing variants
export const IDEOGRAM_PROVIDERS = new Set(["ideogram", "ideogram-edit", "ideogram-remix", "ideogram-reframe"])

// ─── Provider arrays (single source of truth for Zod enums + TS types) ───

/** Image-to-image providers accepted by POST /v1/image-to-image */
export const IMAGE_I2I_PROVIDERS = [
  "nano-banana", "nano-banana-pro",
  "grok-i2i", "flux-i2i", "flux-pro-i2i", "gpt-image-i2i",
  "ideogram-edit", "ideogram-remix", "ideogram-reframe",
  "qwen-i2i", "qwen-edit",
  "seedream-edit", "seedream-5-lite-i2i",
  "flux-kontext", "flux-kontext-max",
] as const

export type ImageI2IProvider = typeof IMAGE_I2I_PROVIDERS[number]

/** Text-to-image providers (generate-image route, T2I mode) */
export const IMAGE_GEN_PROVIDERS = [
  "nano-banana", "nano-banana-pro", "nano-banana-2",
  "grok", "flux", "flux-flex",
  "gpt-image",
  "imagen4", "imagen4-fast", "imagen4-ultra",
  "ideogram", "qwen",
  "seedream", "seedream-5-lite",
  "flux-kontext", "flux-kontext-max",
  "z-image",
] as const

export type ImageGenProvider = typeof IMAGE_GEN_PROVIDERS[number]

/** Edit-image providers (upscale, remove-bg, edit) */
export const IMAGE_EDIT_PROVIDERS = [
  "recraft-upscale", "recraft-remove-bg", "nano-banana-edit",
  "topaz-image-upscale", "grok-upscale",
] as const

export type ImageEditProvider = typeof IMAGE_EDIT_PROVIDERS[number]

/** Image-to-video providers (generate-video route) */
export const IMAGE_TO_VIDEO_PROVIDERS = [
  "minimax", "veo3", "veo3.1",
  "kling", "kling-turbo", "kling-3.0", "kling-master",
  "seedance",
  "hailuo-2.3-pro", "hailuo-2.3", "hailuo-standard",
  "sora2-pro", "sora2",
  "wan-i2v", "wan-turbo",
  "bytedance-lite", "bytedance-pro", "bytedance-pro-fast",
  "grok-i2v",
  "veo", "runway-kie", "runway", "pika", "sora",
] as const

export type ImageToVideoProvider = typeof IMAGE_TO_VIDEO_PROVIDERS[number]

/** Text-to-video providers (text-to-video route — NO veo3.1) */
export const TEXT_TO_VIDEO_PROVIDERS = [
  "minimax", "veo3",
  "kling", "kling-turbo", "kling-3.0",
  "veo", "grok",
  "sora2-pro", "sora2",
  "seedance", "wan", "wan-turbo",
  "hailuo-standard",
  "bytedance-lite", "bytedance-pro",
  "runway-kie", "runway", "pika", "sora",
] as const

export type TextToVideoProvider = typeof TEXT_TO_VIDEO_PROVIDERS[number]

/** Video-to-video providers */
export const VIDEO_TO_VIDEO_PROVIDERS = [
  "wan", "luma-modify",
] as const

export type VideoToVideoProvider = typeof VIDEO_TO_VIDEO_PROVIDERS[number]

/** Video upscale providers */
export const VIDEO_UPSCALE_PROVIDERS = [
  "topaz", "veo-1080p", "veo-4k",
] as const

export type VideoUpscaleProvider = typeof VIDEO_UPSCALE_PROVIDERS[number]

/** Extend video providers */
export const EXTEND_VIDEO_PROVIDERS = [
  "veo-extend", "runway-extend",
] as const

export type ExtendVideoProvider = typeof EXTEND_VIDEO_PROVIDERS[number]

/** TTS providers (text-to-speech route) */
export const TTS_PROVIDERS = [
  "elevenlabs-v3", "elevenlabs-turbo", "elevenlabs-multilingual", "elevenlabs",
] as const

export type TtsProvider = typeof TTS_PROVIDERS[number]

/** Text-to-audio (SFX) providers */
export const TEXT_TO_AUDIO_PROVIDERS = [
  "tangoflux", "elevenlabs-sfx",
] as const

export type TextToAudioProvider = typeof TEXT_TO_AUDIO_PROVIDERS[number]

/** Music generation providers */
export const MUSIC_PROVIDERS = [
  "musicgen", "minimax", "lyria", "bark",
] as const

export type MusicProvider = typeof MUSIC_PROVIDERS[number]

/** Transcription providers */
export const TRANSCRIBE_PROVIDERS = [
  "whisper", "incredibly-fast-whisper", "elevenlabs-stt",
] as const

export type TranscribeProvider = typeof TRANSCRIBE_PROVIDERS[number]

/** Lip-sync providers */
export const LIP_SYNC_PROVIDERS = [
  "kling-avatar", "kling-avatar-pro", "infinitalk",
] as const

export type LipSyncProvider = typeof LIP_SYNC_PROVIDERS[number]

/** Script generation providers */
export const SCRIPT_PROVIDERS = [
  "gemini", "claude", "gpt",
] as const

export type ScriptProvider = typeof SCRIPT_PROVIDERS[number]

/** AI Writer providers (Claude only) */
export const AI_WRITER_PROVIDERS = [
  "claude",
] as const

export type AiWriterProvider = typeof AI_WRITER_PROVIDERS[number]

/** QA Check providers */
export const QA_CHECK_PROVIDERS = [
  "claude", "gpt",
] as const

export type QaCheckProvider = typeof QA_CHECK_PROVIDERS[number]

/** Suno music generation models */
export const SUNO_MODELS = [
  "V4", "V4_5", "V4_5PLUS", "V4_5ALL", "V5",
] as const

export type SunoModel = typeof SUNO_MODELS[number]

/** Voice design model variants */
export const VOICE_DESIGN_MODELS = [
  "eleven_ttv_v3", "eleven_multilingual_ttv_v2",
] as const

export type VoiceDesignModel = typeof VOICE_DESIGN_MODELS[number]
