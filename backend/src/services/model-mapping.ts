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
    model: "flux-2/pro-image-to-image",
    credits: 10,
    cost: 0.05,
    inputType: "image-to-image",
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
    extraParams: { aspect_ratio: "16:9" },
  },

  // GPT Image family
  "gpt-image": {
    model: "gpt-image/1.5-text-to-image",
    credits: 12,
    cost: 0.06,
    extraParams: { aspect_ratio: "16:9" },
  },
  "gpt-image-i2i": {
    model: "gpt-image/1.5-image-to-image",
    credits: 12,
    cost: 0.06,
    inputType: "image-to-image",
    extraParams: { aspect_ratio: "16:9" },
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
  "minimax": {
    model: "hailuo/i2v-01",
    credits: 80,
    cost: 0.40,  // 80 credits × $0.005
  },
  "veo": {
    model: "veo2/image-to-video",
    credits: 200,
    cost: 1.00,  // 200 credits × $0.005
  },
  "veo3": {
    model: "veo3/image-to-video",
    credits: 400,
    cost: 2.00,  // 400 credits × $0.005
  },
  "veo3.1": {
    model: "veo3.1/image-to-video",
    credits: 250,
    cost: 1.25,  // 250 credits × $0.005
  },
  "kling": {
    model: "kling/v2.0-pro-i2v",
    credits: 70,
    cost: 0.35,  // 70 credits × $0.005
  },
  "runway": {
    model: "runway-aleph/image-to-video",
    credits: 100,
    cost: 0.50,  // 100 credits × $0.005
  },
  "sora": {
    model: "sora2/image-to-video",
    credits: 150,
    cost: 0.75,  // 150 credits × $0.005
  },
  "wan": {
    model: "wan/image-to-video",
    credits: 60,
    cost: 0.30,  // 60 credits × $0.005
  },
}

// =============================================================================
// TEXT-TO-VIDEO MODELS
// =============================================================================
export const KIE_TEXT_TO_VIDEO_MODELS: Record<string, KieModelConfig> = {
  "minimax": {
    model: "hailuo/t2v-01",
    credits: 80,
    cost: 0.40,
  },
  "veo3": {
    model: "veo3/text-to-video",
    credits: 400,
    cost: 2.00,
  },
  "kling": {
    model: "kling/v2.0-pro-t2v",
    credits: 70,
    cost: 0.35,
  },
  "sora": {
    model: "sora2/text-to-video",
    credits: 150,
    cost: 0.75,
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

/**
 * Get KIE.ai model config for a given category and provider
 */
export function getKieModelConfig(
  category: "image" | "video" | "text-to-video" | "music" | "tts" | "special",
  provider: string
): KieModelConfig | null {
  switch (category) {
    case "image":
      return KIE_IMAGE_MODELS[provider] ?? null
    case "video":
      return KIE_VIDEO_MODELS[provider] ?? null
    case "text-to-video":
      return KIE_TEXT_TO_VIDEO_MODELS[provider] ?? null
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
  category: "image" | "video" | "text-to-video" | "music" | "tts" | "special",
  provider: string
): boolean {
  return getKieModelConfig(category, provider) !== null
}

/**
 * Get cost for a KIE.ai model
 */
export function getKieCost(
  category: "image" | "video" | "text-to-video" | "music" | "tts" | "special",
  provider: string
): number {
  const config = getKieModelConfig(category, provider)
  return config?.cost ?? 0
}
