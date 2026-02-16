/**
 * KIE.ai Model Mapping
 *
 * Maps SceneNode provider names to KIE.ai model identifiers and costs.
 * Used only in cloud edition when ai_provider=kie.
 *
 * Cost source: KIE.ai pricing page (https://kie.ai/pricing)
 * KIE.ai uses credits: 1 credit = $0.005
 *
 * Model catalog: https://kie.ai/market
 *
 * NOTE: This is a copy of services/model-mapping.ts for the new provider
 * structure. The original file is kept for backward compatibility until
 * the migration is complete.
 */

export interface KieModelConfig {
  model: string           // KIE.ai model identifier
  cost: number            // Cost in USD per generation
  credits: number         // Credits consumed per generation
  inputType?: string      // Some models have different input types
  imageParam?: string     // Parameter name for input image (default: "image", some use "input_urls")
  extraParams?: Record<string, unknown>  // Default extra parameters
  allowedDurations?: number[]  // Video models: allowed duration values in seconds
  usesNFrames?: boolean        // Sora uses n_frames (10, 15) instead of duration
  supportsEndFrame?: boolean   // Video models: supports start + end frame (2 images -> video)
  endFrameParam?: string       // Parameter name for end frame (e.g., "tail_image_url", "end_image_url")
}

// =============================================================================
// IMAGE GENERATION MODELS
// =============================================================================
export const KIE_IMAGE_MODELS: Record<string, KieModelConfig> = {
  // Google Nano Banana family
  "nano-banana": {
    model: "nano-banana-pro",   // Pro version supports image_input for reference images
    credits: 4,
    cost: 0.02,  // 4 credits * $0.005
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  "nano-banana-pro": {
    model: "nano-banana-pro",
    credits: 6,
    cost: 0.03,
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  "nano-banana-edit": {
    model: "google/nano-banana-edit",
    credits: 6,
    cost: 0.03,
    inputType: "image-to-image",
    imageParam: "image_urls",  // Nano Banana Edit uses image_urls array
    extraParams: { image_size: "16:9" },
  },

  // Flux family
  "flux": {
    model: "flux-2/pro-text-to-image",
    credits: 10,
    cost: 0.05,
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  "flux-i2i": {
    model: "flux-2/flex-image-to-image",
    credits: 8,
    cost: 0.04,
    inputType: "image-to-image",
    imageParam: "input_urls",  // Flux uses input_urls array, not "image"
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  "flux-pro-i2i": {
    model: "flux-2/pro-image-to-image",
    credits: 10,
    cost: 0.05,
    inputType: "image-to-image",
    imageParam: "input_urls",  // Flux uses input_urls array, not "image"
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },

  // Grok family
  "grok": {
    model: "grok-imagine/text-to-image",
    credits: 8,
    cost: 0.04,
    extraParams: { aspect_ratio: "16:9" },
  },
  "grok-i2i": {
    model: "grok-imagine/image-to-image",
    credits: 8,
    cost: 0.04,
    inputType: "image-to-image",
    imageParam: "image_urls",  // Grok uses image_urls array, not "image"
    extraParams: {},
  },

  // GPT Image family
  // Supported aspect_ratio values: "1:1", "3:2", "2:3", "4:3" (NOT "16:9")
  // Quality parameter: "low", "medium", "high"
  "gpt-image": {
    model: "gpt-image/1.5-text-to-image",
    credits: 12,
    cost: 0.06,
    extraParams: { aspect_ratio: "3:2", quality: "medium" },
  },
  "gpt-image-i2i": {
    model: "gpt-image/1.5-image-to-image",
    credits: 12,
    cost: 0.06,
    inputType: "image-to-image",
    imageParam: "input_urls",  // GPT Image uses input_urls array, not "image"
    extraParams: { aspect_ratio: "3:2", quality: "medium" },
  },

  // Recraft utilities
  "recraft-remove-bg": {
    model: "recraft/remove-background",
    credits: 4,
    cost: 0.02,
    inputType: "image-to-image",
  },
  "recraft-upscale": {
    model: "recraft/crisp-upscale",
    credits: 6,
    cost: 0.03,
    inputType: "image-to-image",
  },
}

// =============================================================================
// VIDEO GENERATION MODELS (Image-to-Video)
// Verified against docs.kie.ai - 2024
// =============================================================================
export const KIE_VIDEO_MODELS: Record<string, KieModelConfig> = {
  // Hailuo/MiniMax - VERIFIED: docs.kie.ai/market/hailuo/02-image-to-video-pro
  // Uses single image_url, NOT array!
  "minimax": {
    model: "hailuo/02-image-to-video-pro",
    credits: 80,
    cost: 0.40,
    imageParam: "image_url",  // single URL (NOT array!)
    extraParams: { prompt_optimizer: false },
    allowedDurations: [5],  // Hailuo produces ~5 second videos
    supportsEndFrame: true,
    endFrameParam: "end_image_url",  // Optional end frame parameter
  },

  // VEO family - Uses SPECIAL API endpoint: /api/v1/veo/generate
  // Model param is just "veo3" or "veo3_fast", requires special handling in kie-ai.ts
  // IMPORTANT: VEO3 has NO duration parameter - always produces 8 second clips
  // Source: docs.kie.ai FAQ: "Clips made directly in VEO 3.1 are limited to 8 seconds"
  "veo3": {
    model: "veo3",  // Quality model - higher quality, slower
    credits: 400,
    cost: 2.00,
    imageParam: "imageUrls",  // Array format for VEO API
    extraParams: { generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO" },
    allowedDurations: [8],  // FIXED: VEO3 always produces 8 second videos (not configurable)
    supportsEndFrame: true,  // Pass 2 images in imageUrls array for start+end frame
    // Note: VEO uses imageUrls array - [startFrame, endFrame] - no separate endFrameParam
  },
  "veo3.1": {
    model: "veo3_fast",  // Fast model - quicker generation, lower quality
    credits: 250,
    cost: 1.25,
    imageParam: "imageUrls",
    extraParams: { generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO" },
    allowedDurations: [8],  // FIXED: VEO3 Fast always produces 8 second videos (not configurable)
    supportsEndFrame: true,  // Pass 2 images in imageUrls array for start+end frame
    // Note: VEO uses imageUrls array - [startFrame, endFrame] - no separate endFrameParam
  },

  // Kling family - VERIFIED: docs.kie.ai/market/kling/image-to-video
  "kling": {
    model: "kling-2.6/image-to-video",
    credits: 70,
    cost: 0.35,
    imageParam: "image_urls",  // array format (maxItems: 1, no end frame support)
    extraParams: { sound: false, duration: "5" },
    allowedDurations: [5, 10],  // Kling supports 5 or 10 second videos
    supportsEndFrame: false,  // Kling 2.6 only accepts 1 image (no end frame)
  },
  // VERIFIED: docs.kie.ai/market/kling/v2-5-turbo-image-to-video-pro
  "kling-turbo": {
    model: "kling/v2-5-turbo-image-to-video-pro",
    credits: 50,
    cost: 0.25,
    imageParam: "image_url",  // single URL for start frame
    extraParams: { duration: "5", cfg_scale: 0.5 },
    allowedDurations: [5, 10],  // Kling Turbo supports 5 or 10 second videos
    supportsEndFrame: true,
    endFrameParam: "tail_image_url",  // End frame parameter
  },

  // Kling 3.0 - uses unified createTask/getTaskDetail (NOT recordInfo)
  "kling-3.0": {
    model: "kling-3.0/video",
    credits: 10,
    cost: 0.50,
    imageParam: "image_urls",
    extraParams: { sound: true, duration: "5", mode: "pro", multi_shots: false },
    allowedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 15],
    supportsEndFrame: true,
  },

  // Grok - VERIFIED: docs.kie.ai/market/grok-imagine/image-to-video
  "grok-i2v": {
    model: "grok-imagine/image-to-video",
    credits: 60,
    cost: 0.30,
    imageParam: "image_urls",  // array format (maxItems: 1, no end frame support)
    extraParams: { mode: "normal", duration: "6" },
    allowedDurations: [6, 10],  // Grok supports 6 or 10 second videos
    supportsEndFrame: false,  // Grok only accepts 1 image
  },

  // Sora 2 Pro - VERIFIED: docs.kie.ai/market/sora2/sora-2-pro-image-to-video
  // size: "standard" (720p) or "high" (1080p)
  "sora2-pro": {
    model: "sora-2-pro-image-to-video",
    credits: 200,
    cost: 1.00,
    imageParam: "image_urls",  // array format (maxItems: 1, no end frame support)
    extraParams: { aspect_ratio: "landscape", n_frames: "10", size: "standard", remove_watermark: true },
    allowedDurations: [5, 10],  // Sora Pro n_frames: 10 (~5s), 15 (~10s)
    usesNFrames: true,  // Uses n_frames parameter instead of duration
    supportsEndFrame: false,  // Sora2 Pro only accepts 1 image
  },
}

// =============================================================================
// TEXT-TO-VIDEO MODELS
// Verified against docs.kie.ai - 2024
// =============================================================================
export const KIE_TEXT_TO_VIDEO_MODELS: Record<string, KieModelConfig> = {
  // Hailuo/MiniMax - VERIFIED: docs.kie.ai/market/hailuo/02-text-to-video-pro
  "minimax": {
    model: "hailuo/02-text-to-video-pro",
    credits: 80,
    cost: 0.40,
    extraParams: { prompt_optimizer: false },
    allowedDurations: [5],  // Hailuo produces ~5 second videos
  },

  // VEO - Uses SPECIAL API endpoint: /api/v1/veo/generate
  // IMPORTANT: VEO3 has NO duration parameter - always produces 8 second clips
  "veo3": {
    model: "veo3",  // Quality model - higher quality, slower
    credits: 400,
    cost: 2.00,
    extraParams: { generationType: "TEXT_2_VIDEO" },
    allowedDurations: [8],  // FIXED: VEO3 always produces 8 second videos (not configurable)
  },

  // Kling family - VERIFIED: docs.kie.ai/market/kling/text-to-video
  "kling": {
    model: "kling-2.6/text-to-video",
    credits: 70,
    cost: 0.35,
    extraParams: { sound: false, aspect_ratio: "16:9", duration: "5" },
    allowedDurations: [5, 10],  // Kling supports 5 or 10 second videos
  },
  "kling-turbo": {
    model: "kling/v2-5-turbo-text-to-video-pro",
    credits: 50,
    cost: 0.25,
    extraParams: { duration: "5", cfg_scale: 0.5 },
    allowedDurations: [5, 10],  // Kling Turbo supports 5 or 10 second videos
  },

  // Grok
  "grok": {
    model: "grok-imagine/text-to-video",
    credits: 60,
    cost: 0.30,
    extraParams: { aspect_ratio: "16:9", mode: "normal", duration: "6" },
    allowedDurations: [6, 10],  // Grok supports 6 or 10 second videos
  },

  // Sora 2 Pro
  "sora2-pro": {
    model: "sora-2-pro-text-to-video",
    credits: 200,
    cost: 1.00,
    extraParams: { aspect_ratio: "landscape", n_frames: "10", remove_watermark: true },
    allowedDurations: [5, 10],  // Sora Pro n_frames: 10 (~5s), 15 (~10s)
    usesNFrames: true,  // Uses n_frames parameter instead of duration
  },

  // Kling 3.0 - uses kling3-client.ts (unified createTask endpoint)
  "kling-3.0": {
    model: "kling-3.0/video",
    credits: 10,
    cost: 0.50,
    extraParams: { sound: true, duration: "5", mode: "pro", multi_shots: false },
    allowedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 15],
  },
}

// =============================================================================
// VIDEO-TO-VIDEO MODELS (Video input -> Video output)
// Only Wan 2.6 supports V2V - Replicate models don't support video input!
// =============================================================================
export const KIE_VIDEO_TO_VIDEO_MODELS: Record<string, KieModelConfig> = {
  // Wan 2.6 - Standard createTask endpoint, input: video_urls array
  "wan": {
    model: "wan/2-6-video-to-video",
    credits: 80,
    cost: 0.40,
    imageParam: "video_urls",  // Array format: ["video_url"]
    extraParams: {},
  },
}

// =============================================================================
// MOTION TRANSFER MODELS (Image + Video -> Motion-Applied Video)
// Uses character from image and applies motion from video
// =============================================================================
export const KIE_MOTION_TRANSFER_MODELS: Record<string, KieModelConfig> = {
  // Kling 2.6 Motion Control - VERIFIED: docs.kie.ai/market/kling/motion-control
  // input_urls: array of image URLs (character reference)
  // video_urls: array of video URLs (motion source)
  // character_orientation: "image" (max 10s) or "video" (max 30s)
  "kling": {
    model: "kling-2.6/motion-control",
    credits: 100,
    cost: 0.50,
    imageParam: "input_urls",  // Array format for input images
    extraParams: { character_orientation: "image", resolution: "720p" },
  },
}

// =============================================================================
// VIDEO UPSCALE MODELS (Video -> Upscaled Video)
// =============================================================================
export const KIE_VIDEO_UPSCALE_MODELS: Record<string, KieModelConfig> = {
  // Topaz Video Upscaler - VERIFIED: docs.kie.ai/market/topaz/video-upscale
  // video_url: STRING (NOT array!), max 50MB input
  // upscale_factor: "1", "2", or "4"
  "topaz": {
    model: "topaz/video-upscale",
    credits: 60,
    cost: 0.30,
    imageParam: "video_url",  // Single URL string (NOT array!)
    extraParams: { upscale_factor: "2" },
  },
}

// =============================================================================
// LIP SYNC / AI AVATAR MODELS (Image + Audio -> Talking Video)
// =============================================================================
export const KIE_LIP_SYNC_MODELS: Record<string, KieModelConfig> = {
  // Kling AI Avatar
  "kling-avatar": {
    model: "kling/ai-avatar-standard",
    credits: 40,
    cost: 0.20,
    imageParam: "image_url",
    extraParams: {},
  },
  "kling-avatar-pro": {
    model: "kling/ai-avatar-pro",
    credits: 60,
    cost: 0.30,
    imageParam: "image_url",
    extraParams: {},
  },

  // Infinitalk (up to 15 sec audio)
  "infinitalk": {
    model: "infinitalk/from-audio",
    credits: 60,
    cost: 0.30,
    imageParam: "image_url",
    extraParams: { resolution: "720p" },
  },
}

// =============================================================================
// MUSIC GENERATION MODELS
// =============================================================================
export const KIE_MUSIC_MODELS: Record<string, KieModelConfig> = {
  "suno": {
    model: "suno/v4",
    credits: 20,
    cost: 0.10,  // 20 credits * $0.005
  },
  "suno-v5": {
    model: "suno/v5",
    credits: 40,
    cost: 0.20,  // 40 credits * $0.005
  },
}

// =============================================================================
// TEXT-TO-SPEECH MODELS
// Verified against docs.kie.ai - 2024
// =============================================================================
export const KIE_TTS_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs-turbo": {
    model: "elevenlabs/text-to-speech-turbo-2-5",
    credits: 10,
    cost: 0.03,  // $0.03 per 1K chars
  },
  "elevenlabs-multilingual": {
    model: "elevenlabs/text-to-speech-multilingual-v2",
    credits: 10,
    cost: 0.06,  // $0.06 per 1K chars
  },
  // Legacy alias — maps to turbo at runtime in audio.ts
  "elevenlabs": {
    model: "elevenlabs/text-to-speech-turbo-2-5",
    credits: 10,
    cost: 0.03,
  },
}

// =============================================================================
// SOUND EFFECT MODELS
// =============================================================================
export const KIE_SOUND_EFFECT_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs-sfx": {
    model: "elevenlabs/sound-effect-v2",
    credits: 10,
    cost: 0.0012,  // $0.0012 per second of generated audio
  },
}

// =============================================================================
// SPECIAL MODELS
// =============================================================================
export const KIE_SPECIAL_MODELS: Record<string, KieModelConfig> = {
  // Image + Audio -> Talking Video
  "infinitalk": {
    model: "infinitalk/image-to-video",
    credits: 60,
    cost: 0.30,
  },
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export type KieCategory = "image" | "video" | "video-to-video" | "text-to-video" | "motion-transfer" | "video-upscale" | "lip-sync" | "music" | "tts" | "sound-effect" | "special"

/**
 * Get KIE.ai model config for a given category and provider
 */
export function getKieModelConfig(
  category: KieCategory,
  provider: string
): KieModelConfig | null {
  switch (category) {
    case "image":
      return KIE_IMAGE_MODELS[provider] ?? null
    case "video":
      return KIE_VIDEO_MODELS[provider] ?? null
    case "video-to-video":
      // Only Wan 2.6 supports V2V (Replicate models don't support video input!)
      return KIE_VIDEO_TO_VIDEO_MODELS[provider] ?? null
    case "text-to-video":
      return KIE_TEXT_TO_VIDEO_MODELS[provider] ?? null
    case "motion-transfer":
      return KIE_MOTION_TRANSFER_MODELS[provider] ?? null
    case "video-upscale":
      return KIE_VIDEO_UPSCALE_MODELS[provider] ?? null
    case "lip-sync":
      return KIE_LIP_SYNC_MODELS[provider] ?? null
    case "music":
      return KIE_MUSIC_MODELS[provider] ?? null
    case "tts":
      return KIE_TTS_MODELS[provider] ?? null
    case "sound-effect":
      return KIE_SOUND_EFFECT_MODELS[provider] ?? null
    case "special":
      return KIE_SPECIAL_MODELS[provider] ?? null
    default:
      return null
  }
}

/**
 * Check if a provider is supported on KIE.ai for a given category
 */
export function isKieSupported(
  category: KieCategory,
  provider: string
): boolean {
  return getKieModelConfig(category, provider) !== null
}

/**
 * Get cost for a KIE.ai model
 */
export function getKieCost(
  category: KieCategory,
  provider: string
): number {
  const cfg = getKieModelConfig(category, provider)
  return cfg?.cost ?? 0
}

/**
 * Get allowed durations for a video model
 * Returns array of allowed duration values in seconds
 */
export function getAllowedDurations(
  category: "video" | "text-to-video",
  provider: string
): number[] {
  const cfg = getKieModelConfig(category, provider)
  return cfg?.allowedDurations ?? [5]  // Default to 5 seconds if not specified
}

/**
 * Check if a video model uses n_frames instead of duration
 * (Sora models use n_frames: 10 or 15)
 */
export function usesNFrames(
  category: "video" | "text-to-video",
  provider: string
): boolean {
  const cfg = getKieModelConfig(category, provider)
  return cfg?.usesNFrames ?? false
}

/**
 * Convert duration in seconds to n_frames for Sora models
 */
export function durationToNFrames(durationSeconds: number): string {
  // Sora: n_frames 10 = ~5 seconds, n_frames 15 = ~10 seconds
  return durationSeconds <= 5 ? "10" : "15"
}

/**
 * Check if a video model supports start + end frame (2 images -> video)
 */
export function supportsEndFrame(
  category: "video" | "text-to-video",
  provider: string
): boolean {
  const cfg = getKieModelConfig(category, provider)
  return cfg?.supportsEndFrame ?? false
}

/**
 * Get the end frame parameter name for a video model
 * Returns undefined if model doesn't support end frame or uses array format (VEO)
 */
export function getEndFrameParam(
  category: "video" | "text-to-video",
  provider: string
): string | undefined {
  const cfg = getKieModelConfig(category, provider)
  return cfg?.endFrameParam
}
