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
 */

export interface KieModelConfig {
  model: string           // KIE.ai model identifier
  cost: number            // Cost in USD per generation
  credits: number         // Credits consumed per generation
  inputType?: string      // Some models have different input types
  imageParam?: string     // Parameter name for input image (default: "image", some use "input_urls")
  extraParams?: Record<string, unknown>  // Default extra parameters
}

// =============================================================================
// IMAGE GENERATION MODELS
// =============================================================================
export const KIE_IMAGE_MODELS: Record<string, KieModelConfig> = {
  // Google Nano Banana family
  "nano-banana": {
    model: "google/nano-banana",
    credits: 4,
    cost: 0.02,  // 4 credits × $0.005
    extraParams: { image_size: "16:9" },
  },
  "nano-banana-pro": {
    model: "nano-banana-pro",
    credits: 6,
    cost: 0.03,
    extraParams: { image_size: "16:9" },
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
// =============================================================================
export const KIE_VIDEO_MODELS: Record<string, KieModelConfig> = {
  // Hailuo/MiniMax
  "minimax": {
    model: "hailuo/image-to-video",
    credits: 80,
    cost: 0.40,
    imageParam: "image_urls",  // array format
    extraParams: { sound: false, duration: "5" },
  },

  // VEO family
  "veo3": {
    model: "veo3/image-to-video",
    credits: 400,
    cost: 2.00,
    imageParam: "image_url",  // single URL
  },
  "veo3.1": {
    model: "veo3.1/image-to-video",
    credits: 250,
    cost: 1.25,
    imageParam: "image_url",  // supports start_frame_url + end_frame_url
    extraParams: { generate_audio: true },
  },

  // Kling family
  "kling": {
    model: "kling-2.6/image-to-video",
    credits: 70,
    cost: 0.35,
    imageParam: "image_urls",  // array format
    extraParams: { sound: false, duration: "5" },
  },
  "kling-turbo": {
    model: "kling/v2-5-turbo-image-to-video-pro",
    credits: 50,
    cost: 0.25,
    imageParam: "image_url",  // supports tail_image_url for end frame
    extraParams: { duration: "5", cfg_scale: 0.5 },
  },

  // Grok
  "grok-i2v": {
    model: "grok-imagine/image-to-video",
    credits: 60,
    cost: 0.30,
    imageParam: "image_urls",  // array format
    extraParams: { mode: "normal", duration: "6", index: 0 },
  },

  // Sora 2 family
  "sora2": {
    model: "sora-2-image-to-video",
    credits: 150,
    cost: 0.75,
    imageParam: "image_urls",  // array format
    extraParams: { aspect_ratio: "landscape", n_frames: "10", remove_watermark: true },
  },
  "sora2-pro": {
    model: "sora-2-pro-image-to-video",
    credits: 200,
    cost: 1.00,
    imageParam: "image_urls",  // array format
    extraParams: { aspect_ratio: "landscape", n_frames: "10", remove_watermark: true },
  },

  // Runway
  "runway": {
    model: "runway-aleph/image-to-video",
    credits: 100,
    cost: 0.50,
    imageParam: "image_url",
  },

  // Wan
  "wan": {
    model: "wan/image-to-video",
    credits: 60,
    cost: 0.30,
    imageParam: "image_url",
  },
}

// =============================================================================
// TEXT-TO-VIDEO MODELS
// =============================================================================
export const KIE_TEXT_TO_VIDEO_MODELS: Record<string, KieModelConfig> = {
  // Hailuo/MiniMax
  "minimax": {
    model: "hailuo/t2v-01",
    credits: 80,
    cost: 0.40,
    extraParams: { sound: false, duration: "5" },
  },

  // VEO
  "veo3": {
    model: "veo3/text-to-video",
    credits: 400,
    cost: 2.00,
  },

  // Kling family
  "kling": {
    model: "kling-2.6/text-to-video",
    credits: 70,
    cost: 0.35,
    extraParams: { sound: false, aspect_ratio: "1:1", duration: "5" },
  },
  "kling-turbo": {
    model: "kling/v2-5-turbo-text-to-video-pro",
    credits: 50,
    cost: 0.25,
    extraParams: { duration: "5", cfg_scale: 0.5 },
  },

  // Grok
  "grok": {
    model: "grok-imagine/text-to-video",
    credits: 60,
    cost: 0.30,
    extraParams: { aspect_ratio: "2:3", mode: "normal", duration: "6" },
  },

  // Sora 2 family
  "sora2": {
    model: "sora-2-text-to-video",
    credits: 150,
    cost: 0.75,
    extraParams: { aspect_ratio: "landscape", n_frames: "10", remove_watermark: true },
  },
  "sora2-pro": {
    model: "sora-2-pro-text-to-video",
    credits: 200,
    cost: 1.00,
    extraParams: { aspect_ratio: "landscape", n_frames: "10", remove_watermark: true },
  },
}

// =============================================================================
// LIP SYNC / AI AVATAR MODELS (Image + Audio → Talking Video)
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
    cost: 0.10,  // 20 credits × $0.005
  },
  "suno-v5": {
    model: "suno/v5",
    credits: 40,
    cost: 0.20,  // 40 credits × $0.005
  },
}

// =============================================================================
// TEXT-TO-SPEECH MODELS
// =============================================================================
export const KIE_TTS_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs": {
    model: "elevenlabs/text-to-speech",
    credits: 10,
    cost: 0.05,  // 10 credits × $0.005
  },
}

// =============================================================================
// SPECIAL MODELS
// =============================================================================
export const KIE_SPECIAL_MODELS: Record<string, KieModelConfig> = {
  // Image + Audio → Talking Video
  "infinitalk": {
    model: "infinitalk/image-to-video",
    credits: 60,
    cost: 0.30,
  },
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export type KieCategory = "image" | "video" | "text-to-video" | "lip-sync" | "music" | "tts" | "special"

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
    case "text-to-video":
      return KIE_TEXT_TO_VIDEO_MODELS[provider] ?? null
    case "lip-sync":
      return KIE_LIP_SYNC_MODELS[provider] ?? null
    case "music":
      return KIE_MUSIC_MODELS[provider] ?? null
    case "tts":
      return KIE_TTS_MODELS[provider] ?? null
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
  const config = getKieModelConfig(category, provider)
  return config?.cost ?? 0
}
