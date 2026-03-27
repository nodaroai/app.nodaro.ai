/**
 * KIE.ai Model Mapping
 *
 * Maps Nodaro provider names to KIE.ai model identifiers and costs.
 * Used only in cloud edition when ai_provider=kie.
 *
 * Cost source: KIE.ai pricing page (https://kie.ai/pricing)
 * KIE.ai uses credits: 1 credit = $0.005 (KIE_CREDIT_USD)
 *
 * Model catalog: https://kie.ai/market
 *
 * NOTE: This is a copy of services/model-mapping.ts for the new provider
 * structure. The original file is kept for backward compatibility until
 * the migration is complete.
 */

/** 1 KIE credit = $0.005 USD */
export const KIE_CREDIT_USD = 0.005

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
  // Nano Banana uses `image_size` param (NOT `aspect_ratio`) and does NOT support `resolution`
  // See: docs.kie.ai/market/google/nano-banana.md
  "nano-banana": {
    model: "nano-banana-pro",   // Pro version supports image_input for reference images
    credits: 4,
    ***REDACTED-OSS-SCRUB***
    extraParams: { image_size: "16:9" },
  },
  "nano-banana-pro": {
    model: "nano-banana-pro",
    credits: 18,
    ***REDACTED-OSS-SCRUB***
    // Pro uses `aspect_ratio` (NOT `image_size`) and supports `resolution` (1K/2K/4K)
    // See: docs.kie.ai/market/google/pro-image-to-image.md
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  // Nano Banana 2 (latest version, uses native aspect_ratio, supports resolution + google_search)
  // See: docs.kie.ai/market/google/nano-banana-2.md
  "nano-banana-2": {
    model: "nano-banana-2",
    credits: 8,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    // Uses native aspect_ratio (NOT image_size like v1), supports resolution (1K/2K/4K)
    extraParams: { aspect_ratio: "16:9", resolution: "1K", output_format: "jpg" },
  },

  "nano-banana-edit": {
    model: "google/nano-banana-edit",
    credits: 4,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "image_urls",  // Nano Banana Edit uses image_urls array
    extraParams: { image_size: "16:9" },
  },

  // Flux family
  "flux": {
    model: "flux-2/pro-text-to-image",
    credits: 5,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  "flux-i2i": {
    model: "flux-2/flex-image-to-image",
    credits: 14,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "input_urls",  // Flux uses input_urls array, not "image"
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  "flux-pro-i2i": {
    model: "flux-2/pro-image-to-image",
    credits: 5,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "input_urls",  // Flux uses input_urls array, not "image"
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },

  // Grok family
  "grok": {
    model: "grok-imagine/text-to-image",
    credits: 4,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9" },
  },
  "grok-i2i": {
    model: "grok-imagine/image-to-image",
    credits: 4,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "image_urls",  // Grok uses image_urls array, not "image"
    extraParams: {},
  },

  // GPT Image family
  // Supported aspect_ratio values: "1:1", "3:2", "2:3" ONLY (NOT "16:9", "9:16", or "4:3")
  // Quality parameter: "medium", "high"
  "gpt-image": {
    model: "gpt-image/1.5-text-to-image",
    credits: 4,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "3:2", quality: "medium" },
  },
  "gpt-image-i2i": {
    model: "gpt-image/1.5-image-to-image",
    credits: 4,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "input_urls",  // GPT Image uses input_urls array, not "image"
    extraParams: { aspect_ratio: "3:2", quality: "medium" },
  },

  // Google Imagen4 family
  // See: docs.kie.ai/market/google/imagen4.md
  "imagen4": {
    model: "google/imagen4",
    credits: 8,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9" },
  },
  "imagen4-fast": {
    model: "google/imagen4-fast",
    credits: 4,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9" },
  },
  "imagen4-ultra": {
    model: "google/imagen4-ultra",
    credits: 12,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9" },
  },

  // Ideogram family
  // NOTE: ideogram/character (v2) removed — unreliable, requires reference_image_urls.
  // Use ideogram-v3 for text-to-image instead.
  // NOTE: Ideogram uses `image_size` with named values (square, square_hd, portrait_4_3, etc.)
  "ideogram-edit": {
    model: "ideogram/character-edit",
    credits: 18,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string + mask_url required
    extraParams: { style: "AUTO", rendering_speed: "BALANCED" },
  },
  "ideogram-remix": {
    model: "ideogram/character-remix",
    credits: 18,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string
    extraParams: { image_size: "landscape_16_9", style: "AUTO", rendering_speed: "BALANCED", strength: 0.8 },
  },
  "ideogram-reframe": {
    model: "ideogram/v3-reframe",
    credits: 7,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    // Handled via composite identifiers "ideogram-reframe:TURBO", "ideogram-reframe:QUALITY"
    // V3 Reframe is cheaper than character models (character=18, v3=7 BALANCED)
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string
    extraParams: { image_size: "landscape_16_9", rendering_speed: "BALANCED" },
  },
  // Ideogram V3 Base (text-to-image, no character consistency)
  // See: docs.kie.ai/market/ideogram/v3-text-to-image.md
  "ideogram-v3": {
    model: "ideogram/v3-text-to-image",
    credits: 7,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    // Handled via composite identifiers "ideogram-v3:TURBO", "ideogram-v3:QUALITY"
    extraParams: { image_size: "landscape_16_9", style_type: "AUTO", rendering_speed: "BALANCED" },
  },

  // Qwen family
  // See: docs.kie.ai/market/qwen/text-to-image.md
  // NOTE: Qwen uses `image_size` with named values (square, square_hd, portrait_4_3, etc.)
  "qwen": {
    model: "qwen/text-to-image",
    credits: 4,
    ***REDACTED-OSS-SCRUB***
    extraParams: { image_size: "landscape_16_9", output_format: "png" },
  },
  "qwen-i2i": {
    model: "qwen/image-to-image",
    credits: 4,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string
    extraParams: { output_format: "png", strength: 0.8 },
  },
  "qwen-edit": {
    model: "qwen/image-edit",
    credits: 5,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string
    extraParams: { image_size: "landscape_4_3", output_format: "png" },
  },

  // Seedream family (Bytedance)
  // See: docs.kie.ai/market/seedream/4.5-text-to-image.md
  "seedream": {
    model: "seedream/4.5-text-to-image",
    credits: 6.5,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9", quality: "basic" },
  },
  "seedream-edit": {
    model: "seedream/4.5-edit",
    credits: 6.5,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "image_urls",  // Array of URLs
    extraParams: { aspect_ratio: "16:9", quality: "basic" },
  },
  // Seedream 5 Lite (latest Bytedance model)
  // See: docs.kie.ai/market/seedream/5-lite-text-to-image.md
  "seedream-5-lite": {
    model: "seedream/5-lite-text-to-image",
    credits: 5.5,
    ***REDACTED-OSS-SCRUB***
    // NOTE: High quality (4K) may cost more — handled via composite identifier "seedream-5-lite:high"
    extraParams: { aspect_ratio: "16:9", quality: "basic" },
  },
  "seedream-5-lite-i2i": {
    model: "seedream/5-lite-image-to-image",
    credits: 5.5,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "image_urls",  // Array of URLs (like seedream-edit)
    extraParams: { aspect_ratio: "16:9", quality: "basic" },
  },

  // Flux-2 Flex text-to-image (we already have Flex I2I but were missing T2I)
  // See: docs.kie.ai/market/flux2/flex-text-to-image.md
  "flux-flex": {
    model: "flux-2/flex-text-to-image",
    credits: 14,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },

  // Z-Image
  // See: docs.kie.ai/market/z-image/z-image.md
  "z-image": {
    model: "z-image",
    credits: 0.8,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9" },
  },

  // Recraft utilities
  "recraft-remove-bg": {
    model: "recraft/remove-background",
    credits: 1,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
  },
  "recraft-upscale": {
    model: "recraft/crisp-upscale",
    credits: 0.5,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
  },

  // Topaz image upscale (image enhancement utility)
  // See: docs.kie.ai/market/topaz/image-upscale.md
  "topaz-image-upscale": {
    model: "topaz/image-upscale",
    credits: 10,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string
    extraParams: { upscale_factor: "2" },
  },

  // Grok image upscale (requires task_id from previous grok generation)
  // See: docs.kie.ai/market/grok-imagine/upscale.md
  // NOTE: This uses task_id, not image_url — requires special handling
  "grok-upscale": {
    model: "grok-imagine/upscale",
    credits: 10,
    ***REDACTED-OSS-SCRUB***
    inputType: "image-to-image",
    extraParams: {},
  },

  // Flux Kontext (special endpoint: /api/v1/flux/kontext/generate)
  // See: docs.kie.ai/flux-kontext-api/generate-or-edit-image.md
  // Uses inputImage param for I2I editing mode, pure T2I without it
  "flux-kontext": {
    model: "flux-kontext-pro",
    credits: 5,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspectRatio: "16:9", outputFormat: "jpeg" },
  },
  "flux-kontext-max": {
    model: "flux-kontext-max",
    credits: 10,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspectRatio: "16:9", outputFormat: "jpeg" },
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
    credits: 57,
    ***REDACTED-OSS-SCRUB***
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
    credits: 250,
    ***REDACTED-OSS-SCRUB***
    imageParam: "imageUrls",  // Array format for VEO API
    extraParams: { generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO" },
    allowedDurations: [8],  // FIXED: VEO3 always produces 8 second videos (not configurable)
    supportsEndFrame: true,  // Pass 2 images in imageUrls array for start+end frame
    // Note: VEO uses imageUrls array - [startFrame, endFrame] - no separate endFrameParam
  },
  "veo3.1": {
    model: "veo3_fast",  // Fast model - quicker generation, lower quality
    credits: 60,
    cost: 0.30,  // 60 KIE credits * $0.005 (VEO 3.1 Fast)
    imageParam: "imageUrls",
    extraParams: { generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO" },
    allowedDurations: [8],  // FIXED: VEO3 Fast always produces 8 second videos (not configurable)
    supportsEndFrame: true,  // Pass 2 images in imageUrls array for start+end frame
    // Note: VEO uses imageUrls array - [startFrame, endFrame] - no separate endFrameParam
  },

  // Kling family - VERIFIED: docs.kie.ai/market/kling/image-to-video
  "kling": {
    model: "kling-2.6/image-to-video",
    credits: 55,
    ***REDACTED-OSS-SCRUB***
    // NOTE: 5s+audio=110, 10s=110, 10s+audio=220 — variable pricing by duration/audio
    imageParam: "image_urls",  // array format (maxItems: 1, no end frame support)
    extraParams: { sound: false, duration: "5" },
    allowedDurations: [5, 10],  // Kling supports 5 or 10 second videos
    supportsEndFrame: false,  // Kling 2.6 only accepts 1 image (no end frame)
  },
  // VERIFIED: docs.kie.ai/market/kling/v2-5-turbo-image-to-video-pro
  "kling-turbo": {
    model: "kling/v2-5-turbo-image-to-video-pro",
    credits: 42,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",  // single URL for start frame
    extraParams: { duration: "5", cfg_scale: 0.5 },
    allowedDurations: [5, 10],  // Kling Turbo supports 5 or 10 second videos
    supportsEndFrame: true,
    endFrameParam: "tail_image_url",  // End frame parameter
  },

  // Kling 3.0 - uses unified createTask/getTaskDetail (NOT recordInfo)
  // Per-second pricing: 20-40 cr/sec depending on audio + resolution
  // 720P no audio: 20/sec, 720P+audio: 30/sec, 1080P no audio: 27/sec, 1080P+audio: 40/sec
  "kling-3.0": {
    model: "kling-3.0/video",
    credits: 200,
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_urls",
    extraParams: { sound: true, duration: "5", mode: "pro", multi_shots: false },
    allowedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsEndFrame: true,
  },

  // Grok - VERIFIED: docs.kie.ai/market/grok-imagine/image-to-video
  "grok-i2v": {
    model: "grok-imagine/image-to-video",
    credits: 20,
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_urls",  // array format (maxItems: 1, no end frame support)
    extraParams: { mode: "normal", duration: "6" },
    allowedDurations: [6, 10],  // Grok supports 6 or 10 second videos
    supportsEndFrame: false,  // Grok only accepts 1 image
  },

  // Sora 2 Pro - VERIFIED: docs.kie.ai/market/sora2/sora-2-pro-image-to-video
  // size: "standard" (720p) or "high" (1080p)
  // NOTE: remove_watermark causes KIE 500 — use sora-2-watermark-remove post-processing instead
  "sora2-pro": {
    model: "sora-2-pro-image-to-video",
    credits: 150,
    cost: 0.75,  // 150 KIE credits * $0.005 (Pro Standard 10s)
    imageParam: "image_urls",  // array format (maxItems: 1, no end frame support)
    extraParams: { aspect_ratio: "landscape", n_frames: "10", size: "standard" },
    allowedDurations: [5, 10],  // Sora Pro n_frames: 10 (~5s), 15 (~10s)
    usesNFrames: true,  // Uses n_frames parameter instead of duration
    supportsEndFrame: false,  // Sora2 Pro only accepts 1 image
  },

  // Seedance 1.5 Pro - docs.kie.ai/market/bytedance/seedance-1.5-pro
  // Uses input_urls array (0-2 images for start/end frame)
  "seedance": {
    model: "bytedance/seedance-1.5-pro",
    credits: 33,
    ***REDACTED-OSS-SCRUB***
    imageParam: "input_urls",  // Array format: [startFrame] or [startFrame, endFrame]
    extraParams: { resolution: "720p", fixed_lens: false, generate_audio: false },
    allowedDurations: [4, 8, 12],
    supportsEndFrame: false,  // End frame via input_urls array (handled in video.ts)
  },

  // Wan 2.6 I2V - docs.kie.ai/market/wan/2-6-image-to-video
  "wan-i2v": {
    model: "wan/2-6-image-to-video",
    credits: 70,
    ***REDACTED-OSS-SCRUB***
    // NOTE: 1080p=104.5, 10s-720p=140, 10s-1080p=209.5, 15s-720p=210, 15s-1080p=315
    imageParam: "image_urls",  // Array format (max 1)
    extraParams: { resolution: "720p" },
    allowedDurations: [5, 10, 15],
    supportsEndFrame: false,
  },

  // Wan 2.2 Turbo I2V - docs.kie.ai/market/wan/2-2-a14b-image-to-video-turbo
  "wan-turbo": {
    model: "wan/2-2-a14b-image-to-video-turbo",
    credits: 40,
    cost: 0.20,
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "480p" },
    allowedDurations: [5],
    supportsEndFrame: false,
  },

  // Hailuo 2.3 Pro I2V - docs.kie.ai/market/hailuo/2-3-image-to-video-pro
  "hailuo-2.3-pro": {
    model: "hailuo/2-3-image-to-video-pro",
    credits: 80,
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "768P" },
    allowedDurations: [6, 10],
    supportsEndFrame: false,
  },

  // Hailuo 2.3 Standard I2V - docs.kie.ai/market/hailuo/2-3-image-to-video-standard
  "hailuo-2.3": {
    model: "hailuo/2-3-image-to-video-standard",
    credits: 30,
    ***REDACTED-OSS-SCRUB***
    // NOTE: 6s-1080p=50, 10s-768p=50
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "768P" },
    allowedDurations: [6, 10],
    supportsEndFrame: false,
  },

  // Hailuo Standard (02) I2V - docs.kie.ai/market/hailuo/02-image-to-video-standard
  "hailuo-standard": {
    model: "hailuo/02-image-to-video-standard",
    credits: 30,
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",  // Single URL string
    extraParams: { prompt_optimizer: false, resolution: "768P" },
    allowedDurations: [6, 10],
    supportsEndFrame: true,
    endFrameParam: "end_image_url",
  },

  // Sora 2 (non-Pro) I2V - docs.kie.ai/market/sora2/sora-2-image-to-video
  // NOTE: remove_watermark causes KIE 500 — use sora-2-watermark-remove post-processing instead
  "sora2": {
    model: "sora-2-image-to-video",
    credits: 30,
    cost: 0.15,  // 30 KIE credits * $0.005 (Standard 10s)
    // NOTE: Standard 15s=35, stable 10s=35, stable 15s=40
    imageParam: "image_urls",  // Array format
    extraParams: { aspect_ratio: "landscape", n_frames: "10" },
    allowedDurations: [5, 10],
    usesNFrames: true,
    supportsEndFrame: false,
  },

  // Bytedance V1 Lite I2V - docs.kie.ai/market/bytedance/v1-lite-image-to-video
  "bytedance-lite": {
    model: "bytedance/v1-lite-image-to-video",
    credits: 22.5,
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "480p" },
    allowedDurations: [5, 10],
    supportsEndFrame: true,
    endFrameParam: "end_image_url",
  },

  // Bytedance V1 Pro I2V - docs.kie.ai/market/bytedance/v1-pro-image-to-video
  "bytedance-pro": {
    model: "bytedance/v1-pro-image-to-video",
    credits: 70,
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "480p" },
    allowedDurations: [5, 10],
    supportsEndFrame: false,
  },

  // Bytedance V1 Pro Fast I2V - docs.kie.ai/market/bytedance/v1-pro-fast-image-to-video
  "bytedance-pro-fast": {
    model: "bytedance/v1-pro-fast-image-to-video",
    credits: 36,
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "720p" },
    allowedDurations: [5, 10],
    supportsEndFrame: false,
  },

  // Kling V2.1 Master I2V - docs.kie.ai/market/kling/v2-1-master-image-to-video
  "kling-master": {
    model: "kling/v2-1-master-image-to-video",
    credits: 160,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",  // Single URL string
    extraParams: { duration: "5", cfg_scale: 0.5 },
    allowedDurations: [5, 10],
    supportsEndFrame: false,
  },

  // Runway (KIE) - special endpoint: /api/v1/runway/generate
  // See: docs.kie.ai/runway-api/generate-ai-video.md
  "runway-kie": {
    model: "runway",
    credits: 12,
    ***REDACTED-OSS-SCRUB***
    // NOTE: 10s-720p=30, 5s-1080p=30
    imageParam: "imageUrl",  // Single URL string (top-level body param)
    extraParams: { duration: 5, quality: "720p" },
    allowedDurations: [5, 10],
    supportsEndFrame: false,
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
    credits: 57,
    ***REDACTED-OSS-SCRUB***
    extraParams: { prompt_optimizer: false },
    allowedDurations: [5],  // Hailuo produces ~5 second videos
  },

  // VEO - Uses SPECIAL API endpoint: /api/v1/veo/generate
  // IMPORTANT: VEO3 has NO duration parameter - always produces 8 second clips
  "veo3": {
    model: "veo3",  // Quality model - higher quality, slower
    credits: 250,
    ***REDACTED-OSS-SCRUB***
    extraParams: { generationType: "TEXT_2_VIDEO" },
    allowedDurations: [8],  // FIXED: VEO3 always produces 8 second videos (not configurable)
  },

  // VEO 3.1 Fast - Uses SPECIAL API endpoint: /api/v1/veo/generate
  "veo3.1": {
    model: "veo3_fast",  // Fast model - lower cost, faster
    credits: 60,
    cost: 0.30,  // 60 KIE credits * $0.005 (VEO 3.1 Fast)
    extraParams: { generationType: "TEXT_2_VIDEO" },
    allowedDurations: [8],  // FIXED: VEO3 always produces 8 second videos (not configurable)
  },

  // Kling family - VERIFIED: docs.kie.ai/market/kling/text-to-video
  "kling": {
    model: "kling-2.6/text-to-video",
    credits: 55,
    ***REDACTED-OSS-SCRUB***
    // NOTE: 5s+audio=110, 10s=110, 10s+audio=220
    extraParams: { sound: false, aspect_ratio: "16:9", duration: "5" },
    allowedDurations: [5, 10],  // Kling supports 5 or 10 second videos
  },
  "kling-turbo": {
    model: "kling/v2-5-turbo-text-to-video-pro",
    credits: 42,
    ***REDACTED-OSS-SCRUB***
    extraParams: { duration: "5", cfg_scale: 0.5 },
    allowedDurations: [5, 10],  // Kling Turbo supports 5 or 10 second videos
  },

  // Grok
  "grok": {
    model: "grok-imagine/text-to-video",
    credits: 20,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9", mode: "normal", duration: "6", resolution: "720p" },
    allowedDurations: [6, 10],  // Grok supports 6 or 10 second videos
  },

  // Sora 2 Pro
  // NOTE: remove_watermark causes KIE 500 — use sora-2-watermark-remove post-processing instead
  "sora2-pro": {
    model: "sora-2-pro-text-to-video",
    credits: 150,
    cost: 0.75,  // 150 KIE credits * $0.005 (Pro Standard 10s)
    extraParams: { aspect_ratio: "landscape", n_frames: "10", size: "standard" },
    allowedDurations: [5, 10],  // Sora Pro n_frames: 10 (~5s), 15 (~10s)
    usesNFrames: true,  // Uses n_frames parameter instead of duration
  },

  // Kling 3.0 - uses kling3-client.ts (unified createTask endpoint)
  // Per-second pricing: 20-40 cr/sec depending on audio + resolution
  "kling-3.0": {
    model: "kling-3.0/video",
    credits: 200,
    ***REDACTED-OSS-SCRUB***
    extraParams: { sound: true, duration: "5", mode: "pro", multi_shots: false },
    allowedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },

  // Seedance 1.5 Pro T2V - docs.kie.ai/market/bytedance/seedance-1.5-pro
  "seedance": {
    model: "bytedance/seedance-1.5-pro",
    credits: 33,
    ***REDACTED-OSS-SCRUB***
    extraParams: { resolution: "720p", fixed_lens: false, generate_audio: false },
    allowedDurations: [4, 8, 12],
  },

  // Wan 2.6 T2V - docs.kie.ai/market/wan/2-6-text-to-video
  "wan": {
    model: "wan/2-6-text-to-video",
    credits: 104.5,
    ***REDACTED-OSS-SCRUB***
    // NOTE: 720p=70, 10s-720p=140, 10s-1080p=209.5, 15s-720p=210, 15s-1080p=315
    extraParams: { resolution: "1080p" },
    allowedDurations: [5, 10, 15],
  },

  // Sora 2 (non-Pro) T2V - docs.kie.ai/market/sora2/sora-2-text-to-video
  // NOTE: remove_watermark causes KIE 500 — use sora-2-watermark-remove post-processing instead
  "sora2": {
    model: "sora-2-text-to-video",
    credits: 30,
    cost: 0.15,  // 30 KIE credits * $0.005 (Standard 10s)
    extraParams: { aspect_ratio: "landscape", n_frames: "10" },
    allowedDurations: [5, 10],
    usesNFrames: true,
  },

  // Hailuo Standard (02) T2V - docs.kie.ai/market/hailuo/02-text-to-video-standard
  "hailuo-standard": {
    model: "hailuo/02-text-to-video-standard",
    credits: 30,
    ***REDACTED-OSS-SCRUB***
    extraParams: { prompt_optimizer: false },
    allowedDurations: [6, 10],
  },

  // Bytedance V1 Lite T2V - docs.kie.ai/market/bytedance/v1-lite-text-to-video
  "bytedance-lite": {
    model: "bytedance/v1-lite-text-to-video",
    credits: 22.5,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9", resolution: "720p" },
    allowedDurations: [5, 10],
  },

  // Bytedance V1 Pro T2V - docs.kie.ai/market/bytedance/v1-pro-text-to-video
  "bytedance-pro": {
    model: "bytedance/v1-pro-text-to-video",
    credits: 70,
    ***REDACTED-OSS-SCRUB***
    extraParams: { aspect_ratio: "16:9", resolution: "720p" },
    allowedDurations: [5, 10],
  },

  // Wan 2.2 Turbo T2V - docs.kie.ai/market/wan/2-2-a14b-text-to-video-turbo
  "wan-turbo": {
    model: "wan/2-2-a14b-text-to-video-turbo",
    credits: 80,
    ***REDACTED-OSS-SCRUB***
    // NOTE: 480p=40, 580p=60
    extraParams: { aspect_ratio: "16:9", resolution: "720p" },
    allowedDurations: [5],
  },

  // Runway (KIE) T2V - special endpoint: /api/v1/runway/generate
  "runway-kie": {
    model: "runway",
    credits: 12,
    ***REDACTED-OSS-SCRUB***
    extraParams: { duration: 5, quality: "720p", aspectRatio: "16:9" },
    allowedDurations: [5, 10],
  },
}

// =============================================================================
// VIDEO-TO-VIDEO MODELS (Video input -> Video output)
// =============================================================================
export const KIE_VIDEO_TO_VIDEO_MODELS: Record<string, KieModelConfig> = {
  // Wan 2.6 - Standard createTask endpoint, input: video_urls array
  "wan": {
    model: "wan/2-6-video-to-video",
    credits: 70,
    ***REDACTED-OSS-SCRUB***
    imageParam: "video_urls",  // Array format: ["video_url"]
    extraParams: {},
  },

  // Wan 2.6 Flash - faster V2V variant with audio + multi-shot support
  // See: docs.kie.ai/market/wan/2-6-flash-video-to-video.md
  // Supports: duration (5/10s), resolution (720p/1080p), audio (bool), multi_shots (bool)
  // Prompt max 1500 chars (vs 5000 for standard)
  "wan-flash": {
    model: "wan/2-6-flash-video-to-video",
    credits: 40,
    cost: 0.20,  // Estimated — flash variant ~57% of standard
    imageParam: "video_urls",
    extraParams: {},
  },

  // Luma Modify - special endpoint: /api/v1/modify/generate
  // See: docs.kie.ai/luma-api/generate-luma-modify-video.md
  // English prompts only, input video max 500MB/10s
  // NOTE: Not in KIE pricing data — keeping estimated cost
  "luma-modify": {
    model: "luma-modify",
    credits: 100,
    cost: 0.50,
    extraParams: {},
  },

  // Runway Aleph - special endpoint: /api/v1/aleph/generate
  // See: docs.kie.ai/runway-api/generate-aleph-video.md
  // V2V conversion — takes reference video + prompt → AI-generated video
  "runway-aleph": {
    model: "runway-aleph",
    credits: 110,
    ***REDACTED-OSS-SCRUB***
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
  ***REDACTED-OSS-SCRUB***
  "kling": {
    model: "kling-2.6/motion-control",
    credits: 60,
    ***REDACTED-OSS-SCRUB***
    imageParam: "input_urls",  // Array format for input images
    extraParams: { character_orientation: "image", resolution: "720p" },
  },

  // Kling 3.0 Motion Control - uses createTask endpoint
  // character_orientation: "image" or "video"
  // mode: "std" (720p) or "pro" (1080p)
  // background_source: "input_video" or "input_image" (default: input_video)
  ***REDACTED-OSS-SCRUB***
  "kling-3.0": {
    model: "kling-3.0/motion-control",
    credits: 120,
    ***REDACTED-OSS-SCRUB***
    imageParam: "input_urls",
    extraParams: { character_orientation: "video", mode: "720p" },
  },

  // Wan 2.2 Animate Move - standard createTask endpoint
  // See: docs.kie.ai/market/wan/2-2-animate-move.md
  // Moves character from image within the video scene (~1s output)
  "wan-animate-move": {
    model: "wan/2-2-animate-move",
    credits: 102,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "480p" },
  },

  // Wan 2.2 Animate Replace - standard createTask endpoint
  // See: docs.kie.ai/market/wan/2-2-animate-replace.md
  // Replaces character in video with character from image (~1s output)
  "wan-animate-replace": {
    model: "wan/2-2-animate-replace",
    credits: 102,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "480p" },
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
    credits: 112,
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",
    extraParams: {},
  },
  "kling-avatar-pro": {
    model: "kling/ai-avatar-pro",
    credits: 224,
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",
    extraParams: {},
  },

  ***REDACTED-OSS-SCRUB***
  "infinitalk": {
    model: "infinitalk/from-audio",
    credits: 168,
    ***REDACTED-OSS-SCRUB***
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
    credits: 12,
    ***REDACTED-OSS-SCRUB***
  },
  "suno-v5": {
    model: "suno/v5",
    credits: 12,
    ***REDACTED-OSS-SCRUB***
  },
}

// =============================================================================
// TEXT-TO-SPEECH MODELS
// Verified against docs.kie.ai - 2024
// =============================================================================
export const KIE_TTS_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs-turbo": {
    model: "elevenlabs/text-to-speech-turbo-2-5",
    credits: 6,
    ***REDACTED-OSS-SCRUB***
  },
  "elevenlabs-multilingual": {
    model: "elevenlabs/text-to-speech-multilingual-v2",
    credits: 12,
    ***REDACTED-OSS-SCRUB***
  },
  // Legacy alias — maps to turbo at runtime in audio.ts
  "elevenlabs": {
    model: "elevenlabs/text-to-speech-turbo-2-5",
    credits: 6,
    cost: 0.03,
  },
}

// =============================================================================
// SOUND EFFECT MODELS
// =============================================================================
export const KIE_SOUND_EFFECT_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs-sfx": {
    model: "elevenlabs/sound-effect-v2",
    credits: 1.2,
    ***REDACTED-OSS-SCRUB***
  },
}

// =============================================================================
// AUDIO ISOLATION MODELS
// =============================================================================
export const KIE_AUDIO_ISOLATION_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs-isolation": {
    model: "elevenlabs/audio-isolation",
    credits: 29.6,
    ***REDACTED-OSS-SCRUB***
  },
}

// =============================================================================
// SPEECH-TO-TEXT MODELS
// =============================================================================
export const KIE_STT_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs-stt": {
    model: "elevenlabs/speech-to-text",
    credits: 8.58,
    ***REDACTED-OSS-SCRUB***
  },
}

// =============================================================================
// TEXT-TO-DIALOGUE MODELS (Multi-speaker TTS)
// =============================================================================
export const KIE_DIALOGUE_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs-dialogue": {
    model: "elevenlabs/text-to-dialogue-v3",
    credits: 14,
    ***REDACTED-OSS-SCRUB***
  },
}

// =============================================================================
// SPEECH-TO-VIDEO MODELS
// =============================================================================
export const KIE_SPEECH_TO_VIDEO_MODELS: Record<string, KieModelConfig> = {
  "wan-s2v": {
    model: "wan/2-2-a14b-speech-to-video-turbo",
    credits: 12,
    ***REDACTED-OSS-SCRUB***
    ***REDACTED-OSS-SCRUB***
    imageParam: "image_url",
    extraParams: { resolution: "480p" },
  },
}

// =============================================================================
// SORA 2 PRO STORYBOARD MODELS (Multi-shot video from scene descriptions)
// =============================================================================
export const KIE_STORYBOARD_MODELS: Record<string, KieModelConfig> = {
  // Sora 2 Pro Storyboard — multi-shot video from scene descriptions
  // See: docs.kie.ai/market/sora-2-pro-storyboard/index.md
  "sora-storyboard": {
    model: "sora-2-pro-storyboard",
    credits: 150,
    cost: 0.75,  // 150 KIE credits * $0.005 (10 frames default)
    // NOTE: 15/25 frames = 270 KIE credits ($1.35)
    // NOTE: remove_watermark causes KIE 500 — use sora-2-watermark-remove post-processing instead
    extraParams: { aspect_ratio: "landscape", n_frames: "10" },
  },
}

// =============================================================================
// SORA 2 CHARACTER MODELS (Extract reusable characters from video or Sora task)
// =============================================================================
export const KIE_CHARACTER_MODELS: Record<string, KieModelConfig> = {
  // Sora 2 Characters — extract character from video file
  // See: docs.kie.ai/market/sora2/sora-2-characters.md
  "sora-character": {
    model: "sora-2-characters",
    credits: 20,
    cost: 0.10,  // 20 KIE credits * $0.005
  },
  // Sora 2 Characters Pro — extract character from a prior Sora task (by task ID + timestamps)
  "sora-character-pro": {
    model: "sora-2-characters-pro",
    credits: 20,
    cost: 0.10,  // 20 KIE credits * $0.005
  },
}

// =============================================================================
// SPECIAL MODELS
// =============================================================================
export const KIE_SPECIAL_MODELS: Record<string, KieModelConfig> = {
  // Image + Audio -> Talking Video
  "infinitalk": {
    model: "infinitalk/image-to-video",
    credits: 168,
    cost: 0.84,  // 12 cr/sec * ~14s (720p)
  },

  // Sora 2 Watermark Removal
  // Uses the generated task's kieTaskId — NOT a standalone model
  "sora-watermark-remove": {
    model: "sora-2-watermark-remove",
    credits: 10,
    ***REDACTED-OSS-SCRUB***
    extraParams: {},
  },
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export type KieCategory = "image" | "video" | "video-to-video" | "text-to-video" | "motion-transfer" | "video-upscale" | "lip-sync" | "speech-to-video" | "storyboard" | "character" | "music" | "tts" | "sound-effect" | "audio-isolation" | "stt" | "dialogue" | "special"

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
    case "speech-to-video":
      return KIE_SPEECH_TO_VIDEO_MODELS[provider] ?? null
    case "storyboard":
      return KIE_STORYBOARD_MODELS[provider] ?? null
    case "character":
      return KIE_CHARACTER_MODELS[provider] ?? null
    case "music":
      return KIE_MUSIC_MODELS[provider] ?? null
    case "tts":
      return KIE_TTS_MODELS[provider] ?? null
    case "sound-effect":
      return KIE_SOUND_EFFECT_MODELS[provider] ?? null
    case "audio-isolation":
      return KIE_AUDIO_ISOLATION_MODELS[provider] ?? null
    case "stt":
      return KIE_STT_MODELS[provider] ?? null
    case "dialogue":
      return KIE_DIALOGUE_MODELS[provider] ?? null
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
