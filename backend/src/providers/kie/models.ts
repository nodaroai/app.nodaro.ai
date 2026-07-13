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
  inputKind?: "image" | "video"  // Lip-sync input shape: "image" (image+audio, default) vs "video" (video+audio dubbing, e.g. volcengine). Drives the KIE lipSync vs lipSyncVideo dispatch.
  imageParam?: string     // Parameter name for input image (default: "image", some use "input_urls")
  aspectRatioParam?: string    // Non-standard aspect ratio param name (default: "aspect_ratio"; e.g., "ratio")
  maxRefImages?: number        // If set, merges primary + referenceImageUrls into imageParam array up to this cap
  extraParams?: Record<string, unknown>  // Default extra parameters
  allowedDurations?: number[]  // Video models: allowed duration values in seconds
  supportsEndFrame?: boolean   // Video models: supports start + end frame (2 images -> video)
  endFrameParam?: string       // Parameter name for end frame (e.g., "tail_image_url", "end_image_url")
  // Lip-sync param mapping (per-model overrides for the generic lipSync dispatch):
  resolutionParam?: string                 // KIE input key for resolution (default "resolution")
  resolutionMap?: Record<string, string>   // our enum (480p/720p/1080p) → KIE value
  defaultResolution?: string               // KIE resolution value when none supplied
  supportsFastMode?: boolean               // emit pe_fast_mode from options
  supportsSeed?: boolean                   // emit seed from options
  omitSeed?: boolean                       // NEVER send seed — model schema rejects it (additionalProperties: false)
}

// =============================================================================
// IMAGE GENERATION MODELS
// =============================================================================
export const KIE_IMAGE_MODELS: Record<string, KieModelConfig> = {
  // Google Nano Banana family
  // Routed to KIE's `nano-banana-pro` model id (NOT base nano-banana) so we get
  // `image_input` reference-image support. The Pro endpoint uses `aspect_ratio`
  // (NOT `image_size`) — see docs.kie.ai/market/google/pro-image-to-image.md.
  // We strip `resolution` in image.ts so KIE defaults to 1K and the cheaper
  // 4-KIE-credit price stays accurate (2K/4K live under `nano-banana-pro`).
  "nano-banana": {
    model: "nano-banana-pro",
    credits: 4,
    cost: 0.02,
    // Accepts multiple reference images via `image_input` (sent by image.ts).
    // Cap the identity reference set so multi-ref character-asset generations
    // stay within the sweet-spot (portrait + up to 5 supporting refs).
    maxRefImages: 6,
    extraParams: { aspect_ratio: "16:9" },
  },
  "nano-banana-pro": {
    model: "nano-banana-pro",
    credits: 18,
    cost: 0.09,  // (1K/2K default)
    // Pro uses `aspect_ratio` (NOT `image_size`) and supports `resolution` (1K/2K/4K)
    // See: docs.kie.ai/market/google/pro-image-to-image.md
    // NOTE: 4K resolution costs — handled via composite identifier "nano-banana-pro:4K"
    maxRefImages: 6,
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  // Nano Banana 2 (latest version, uses native aspect_ratio, supports resolution + google_search)
  // See: docs.kie.ai/market/google/nano-banana-2.md
  "nano-banana-2": {
    model: "nano-banana-2",
    credits: 8,
    cost: 0.04,  // (1K default)
    // NOTE: 2K, 4K = — handled via composite identifiers
    // Uses native aspect_ratio (NOT image_size like v1), supports resolution (1K/2K/4K)
    extraParams: { aspect_ratio: "16:9", resolution: "1K", output_format: "jpg" },
  },

  "nano-banana-edit": {
    model: "google/nano-banana-edit",
    credits: 4,
    cost: 0.02,
    inputType: "image-to-image",
    imageParam: "image_urls",  // Nano Banana Edit uses image_urls array
    extraParams: { image_size: "16:9" },
  },

  // Wan 2.7 Image — T2I with optional ref images (up to 9 via input_urls)
  // See: docs.kie.ai/market/wan/2-7-image.md
  // Resolution 1K/2K/4K; ref images are optional (acts as pure T2I when omitted)
  "wan-2.7": {
    model: "wan/2-7-image",
    credits: 8,
    cost: 0.040,  // (1K default)
    imageParam: "input_urls",  // optional array of ref image URLs
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },

  // Wan 2.7 Image Pro — higher quality T2I, no image input
  // See: docs.kie.ai/market/wan/2-7-image-pro.md
  "wan-2.7-pro": {
    model: "wan/2-7-image-pro",
    credits: 12,
    cost: 0.060,  // (1K default)
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },

  // Flux family
  "flux": {
    model: "flux-2/pro-text-to-image",
    credits: 5,
    cost: 0.025,  // (1K default)
    // NOTE: 2K resolution costs — handled via composite identifier "flux:2K"
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  "flux-i2i": {
    model: "flux-2/flex-image-to-image",
    credits: 14,
    cost: 0.07,  // (1K default, same as flex T2I)
    // NOTE: 2K resolution costs — handled via composite identifier "flux-i2i:2K"
    inputType: "image-to-image",
    imageParam: "input_urls",  // Flux uses input_urls array, not "image"
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  "flux-pro-i2i": {
    model: "flux-2/pro-image-to-image",
    credits: 5,
    cost: 0.025,  // (1K default, same as pro T2I)
    // NOTE: 2K resolution costs — handled via composite identifier "flux-pro-i2i:2K"
    inputType: "image-to-image",
    imageParam: "input_urls",  // Flux uses input_urls array, not "image"
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },

  // Grok family
  "grok": {
    model: "grok-imagine/text-to-image",
    credits: 4,
    cost: 0.02,
    extraParams: { aspect_ratio: "16:9" },
  },
  "grok-i2i": {
    model: "grok-imagine/image-to-image",
    credits: 4,
    cost: 0.02,
    inputType: "image-to-image",
    imageParam: "image_urls",  // Grok uses image_urls array, not "image"
    extraParams: {},
  },

  // GPT Image family
  // GPT Image 1.5 — Supported aspect_ratio: "1:1", "3:2", "2:3" ONLY. Quality: "medium", "high"
  "gpt-image": {
    model: "gpt-image/1.5-text-to-image",
    credits: 4,
    cost: 0.02,  // (medium quality default)
    // NOTE: High quality costs — handled via composite identifier "gpt-image:high"
    extraParams: { aspect_ratio: "3:2", quality: "medium" },
  },
  "gpt-image-i2i": {
    model: "gpt-image/1.5-image-to-image",
    credits: 4,
    cost: 0.02,  // (medium quality default)
    // NOTE: High quality costs — handled via composite identifier "gpt-image-i2i:high"
    inputType: "image-to-image",
    imageParam: "input_urls",  // GPT Image uses input_urls array, not "image"
    extraParams: { aspect_ratio: "3:2", quality: "medium" },
  },
  // GPT Image 2 — newer family. Resolution-based pricing (NOT quality), aspect_ratio includes 16:9/9:16/4:3/3:4
  // See: docs.kie.ai/market/gpt/gpt-image-2-text-to-image.md, gpt-image-2-image-to-image.md
  // Constraints: 1:1 cannot be 4K; "auto" aspect_ratio limited to 1K
  "gpt-image-2": {
    model: "gpt-image-2-text-to-image",
    credits: 4,
    cost: 0.02,  // 1K default; pricing calibrated from credit-anomalies once usage data exists
    // NOTE: 2K, 4K = — handled via composite identifiers "gpt-image-2:2K" and "gpt-image-2:4K"
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },
  "gpt-image-2-i2i": {
    model: "gpt-image-2-image-to-image",
    credits: 4,
    cost: 0.02,  // 1K default
    // NOTE: 2K, 4K = — handled via composite identifiers "gpt-image-2-i2i:2K" and "gpt-image-2-i2i:4K"
    inputType: "image-to-image",
    imageParam: "input_urls",  // Array, max 16
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },

  // Google Imagen4 family
  // See: docs.kie.ai/market/google/imagen4.md
  "imagen4": {
    model: "google/imagen4",
    credits: 8,
    cost: 0.04,
    extraParams: { aspect_ratio: "16:9" },
  },
  "imagen4-fast": {
    model: "google/imagen4-fast",
    credits: 4,
    cost: 0.02,
    extraParams: { aspect_ratio: "16:9" },
  },
  "imagen4-ultra": {
    model: "google/imagen4-ultra",
    credits: 12,
    cost: 0.06,
    extraParams: { aspect_ratio: "16:9" },
  },

  // Ideogram family
  // NOTE: ideogram/character (v2) removed — unreliable, requires reference_image_urls.
  // Use ideogram-v3 for text-to-image instead.
  // NOTE: Ideogram uses `image_size` with named values (square, square_hd, portrait_4_3, etc.)
  "ideogram-edit": {
    model: "ideogram/character-edit",
    credits: 18,
    cost: 0.09,  // (BALANCED default)
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string + mask_url required
    extraParams: { style: "AUTO", rendering_speed: "BALANCED" },
  },
  "ideogram-remix": {
    model: "ideogram/character-remix",
    credits: 18,
    cost: 0.09,  // (BALANCED default)
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string
    extraParams: { image_size: "landscape_16_9", style: "AUTO", rendering_speed: "BALANCED", strength: 0.8 },
  },
  "ideogram-reframe": {
    model: "ideogram/v3-reframe",
    credits: 7,
    cost: 0.035,  // (BALANCED default)
    // NOTE: TURBO = 3.5 credits, QUALITY = 10 credits
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
    cost: 0.035,  // (BALANCED default)
    // NOTE: TURBO = 3.5 credits, QUALITY = 10 credits
    // Handled via composite identifiers "ideogram-v3:TURBO", "ideogram-v3:QUALITY"
    extraParams: { image_size: "landscape_16_9", style_type: "AUTO", rendering_speed: "BALANCED" },
  },

  // Qwen family
  // See: docs.kie.ai/market/qwen/text-to-image.md
  // NOTE: Qwen uses `image_size` with named values (square, square_hd, portrait_4_3, etc.)
  "qwen": {
    model: "qwen/text-to-image",
    credits: 4,
    cost: 0.02,
    extraParams: { image_size: "landscape_16_9", output_format: "png" },
  },
  "qwen-i2i": {
    model: "qwen/image-to-image",
    credits: 4,
    cost: 0.02,
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string
    extraParams: { output_format: "png", strength: 0.8 },
  },
  "qwen-edit": {
    model: "qwen/image-edit",
    credits: 5,
    cost: 0.025,
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string
    extraParams: { image_size: "landscape_4_3", output_format: "png" },
  },

  // Seedream family (Bytedance)
  // See: docs.kie.ai/market/seedream/4.5-text-to-image.md
  "seedream": {
    model: "seedream/4.5-text-to-image",
    credits: 6.5,
    cost: 0.032,
    extraParams: { aspect_ratio: "16:9", quality: "basic" },
  },
  "seedream-edit": {
    model: "seedream/4.5-edit",
    credits: 6.5,
    cost: 0.032,
    inputType: "image-to-image",
    imageParam: "image_urls",  // Array of URLs
    extraParams: { aspect_ratio: "16:9", quality: "basic" },
  },
  // Seedream 5 Lite (latest Bytedance model)
  // See: docs.kie.ai/market/seedream/5-lite-text-to-image.md
  "seedream-5-lite": {
    model: "seedream/5-lite-text-to-image",
    credits: 5.5,
    cost: 0.0275,
    // NOTE: High quality (4K) may cost more — handled via composite identifier "seedream-5-lite:high"
    extraParams: { aspect_ratio: "16:9", quality: "basic" },
  },
  "seedream-5-lite-i2i": {
    model: "seedream/5-lite-image-to-image",
    credits: 5.5,
    cost: 0.0275,
    inputType: "image-to-image",
    imageParam: "image_urls",  // Array of URLs (like seedream-edit)
    extraParams: { aspect_ratio: "16:9", quality: "basic" },
  },
  // Seedream 5 Pro (flagship Bytedance model). Quality basic = 1K, high = 2K
  // (list price doubles at high — 14 KIE credits — handled via composite
  // identifier "seedream-5-pro:high"). I2I adds 0.5 KIE credits per input
  // image (absorbed in the flat tier price, same as the rest of the family).
  // See: docs.kie.ai/market/seedream/5-pro-text-to-image.md
  "seedream-5-pro": {
    model: "seedream/5-pro-text-to-image",
    credits: 7,
    cost: 0.035,
    extraParams: { aspect_ratio: "16:9", quality: "basic" },
  },
  "seedream-5-pro-i2i": {
    model: "seedream/5-pro-image-to-image",
    credits: 7,
    cost: 0.035,
    inputType: "image-to-image",
    imageParam: "image_urls",  // Array of URLs (like seedream-edit)
    extraParams: { aspect_ratio: "16:9", quality: "basic" },
  },

  // Flux-2 Flex text-to-image (we already have Flex I2I but were missing T2I)
  // See: docs.kie.ai/market/flux2/flex-text-to-image.md
  "flux-flex": {
    model: "flux-2/flex-text-to-image",
    credits: 14,
    cost: 0.07,  // (1K default)
    // NOTE: 2K resolution costs — handled via composite identifier "flux-flex:2K"
    extraParams: { aspect_ratio: "16:9", resolution: "1K" },
  },

  // Z-Image
  // See: docs.kie.ai/market/z-image/z-image.md
  "z-image": {
    model: "z-image",
    credits: 0.8,
    cost: 0.004,
    extraParams: { aspect_ratio: "16:9" },
  },

  // Recraft utilities
  "recraft-remove-bg": {
    model: "recraft/remove-background",
    credits: 1,
    cost: 0.005,
    inputType: "image-to-image",
  },
  "recraft-upscale": {
    model: "recraft/crisp-upscale",
    credits: 0.5,
    cost: 0.0025,
    inputType: "image-to-image",
  },

  // Topaz image upscale (image enhancement utility)
  // See: docs.kie.ai/market/topaz/image-upscale.md
  "topaz-image-upscale": {
    model: "topaz/image-upscale",
    credits: 10,
    cost: 0.05,  // (2K default)
    // NOTE: 4K, 8K = — handled via composite identifiers
    inputType: "image-to-image",
    imageParam: "image_url",  // Single URL string
    extraParams: { upscale_factor: "2" },
  },

  // Grok image upscale (requires task_id from previous grok generation)
  // See: docs.kie.ai/market/grok-imagine/upscale.md
  // The route accepts a `taskId` field (not imageUrl) for this provider; the
  // worker passes the taskId in via the `imageUrl` arg of editImage, and the
  // KIE provider writes it to `input[imageParamName]` — so setting
  // imageParam: "task_id" makes the KIE request body { task_id: <taskId> }.
  "grok-upscale": {
    model: "grok-imagine/upscale",
    credits: 10,
    cost: 0.05,
    inputType: "image-to-image",
    imageParam: "task_id",
    extraParams: {},
  },

  // Flux Kontext (special endpoint: /api/v1/flux/kontext/generate)
  // See: docs.kie.ai/flux-kontext-api/generate-or-edit-image.md
  // Uses inputImage param for I2I editing mode, pure T2I without it
  "flux-kontext": {
    model: "flux-kontext-pro",
    credits: 5,
    cost: 0.025,
    extraParams: { aspectRatio: "16:9", outputFormat: "jpeg" },
  },
  "flux-kontext-max": {
    model: "flux-kontext-max",
    credits: 10,
    cost: 0.05,
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
    cost: 0.285,  // (6s, 1080p)
    imageParam: "image_url",  // single URL (NOT array!)
    extraParams: { prompt_optimizer: false },
    allowedDurations: [5],  // Hailuo produces ~5 second videos
    supportsEndFrame: true,
    endFrameParam: "end_image_url",  // Optional end frame parameter
  },

  // VEO 3.1 family - Uses SPECIAL API endpoint: /api/v1/veo/generate
  // Model param values: "veo3" (Quality), "veo3_fast" (Fast), "veo3_lite" (Lite) — ALL VEO 3.1.
  // The bare "veo3" model id is legacy naming; per docs.kie.ai/veo3-api/generate-veo-3-video
  // it maps to VEO 3.1 Quality. Special handling in client.ts::runVeoTask.
  // Duration: 4 / 6 / 8 seconds (KIE 2026-05-26 — pricing flat per generation across durations).
  "veo3": {
    model: "veo3",  // VEO 3.1 Quality — highest quality tier
    credits: 250,
    cost: 1.25,  // (VEO 3.1 Quality)
    imageParam: "imageUrls",  // Array format for VEO API
    extraParams: { generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO" },
    allowedDurations: [4, 6, 8],
    supportsEndFrame: true,  // Pass 2 images in imageUrls array for start+end frame
    // Note: VEO uses imageUrls array - [startFrame, endFrame] - no separate endFrameParam
  },
  "veo3.1": {
    model: "veo3_fast",  // VEO 3.1 Fast — quicker generation, lower cost
    credits: 60,
    cost: 0.30,  // (VEO 3.1 Fast @ 720p; 1080p costs 65 cr / — handled via composite identifier "veo3.1:1080p")
    imageParam: "imageUrls",
    extraParams: { generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO" },
    allowedDurations: [4, 6, 8],
    supportsEndFrame: true,  // Pass 2 images in imageUrls array for start+end frame
    // Note: VEO uses imageUrls array - [startFrame, endFrame] - no separate endFrameParam
  },
  "veo3_lite": {
    model: "veo3_lite",  // VEO 3.1 Lite — cheapest tier; KIE pricing @ 720p, 35 cr / @ 1080p
    credits: 30,
    cost: 0.15,  // VEO 3.1 Lite @ 720p (1080p costs 35 cr / — composite identifier "veo3_lite:1080p")
    imageParam: "imageUrls",
    extraParams: { generationType: "FIRST_AND_LAST_FRAMES_2_VIDEO" },
    allowedDurations: [4, 6, 8],
    supportsEndFrame: true,  // Same imageUrls[start, end] pattern as veo3 / veo3.1
  },

  // Kling family - VERIFIED: docs.kie.ai/market/kling/image-to-video
  "kling": {
    model: "kling-2.6/image-to-video",
    credits: 55,
    cost: 0.275,  // (5s, no audio default)
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
    cost: 0.21,  // (5s default)
    // NOTE: 10s = — variable pricing by duration
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
    cost: 1.00,  // 40 cr/sec * 5s default (1080P, audio on)
    imageParam: "image_urls",
    extraParams: { sound: true, duration: "5", mode: "pro", multi_shots: false },
    allowedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsEndFrame: true,
  },

  // Grok - VERIFIED: docs.kie.ai/market/grok-imagine/image-to-video
  "grok-i2v": {
    model: "grok-imagine/image-to-video",
    credits: 20,
    cost: 0.10,  // (6s, 720p default)
    imageParam: "image_urls",  // array format
    maxRefImages: 7,           // up to 7 images total (primary + refs)
    extraParams: { mode: "normal", duration: "6" },
    allowedDurations: [6, 10],  // Grok supports 6 or 10 second videos
    supportsEndFrame: false,
  },

  // Grok Imagine Video 1.5 — VERIFIED: docs.kie.ai/market/grok-imagine/1-5-preview
  // Image-to-video only (image_urls required, max 1, ≤20MB). True per-second
  // billing: KIE 14.5 cr/s @480p, 25 cr/s @720p, +2 cr/image. The Nodaro charge is
  // seeded per (duration × resolution) in STATIC_CREDIT_COSTS + model_pricing;
  // `credits`/`cost` below are the KIE-side default tier (8s @480p) for audit logging.
  "grok-imagine-video-1.5": {
    model: "grok-imagine-video-1-5-preview",
    credits: 118,           // KIE: 14.5×8 + 2 (8s @480p default tier)
    cost: 0.59,
    imageParam: "image_urls",   // array format, single image (max 1)
    extraParams: { resolution: "480p", duration: 8, aspect_ratio: "auto", nsfw_checker: false },
    allowedDurations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsEndFrame: false,
  },

  // Seedance 1.5 Pro - docs.kie.ai/market/bytedance/seedance-1.5-pro
  // Uses input_urls array (0-2 images for start/end frame)
  "seedance": {
    model: "bytedance/seedance-1.5-pro",
    credits: 33,
    cost: 0.165,  // avg (4s=14, 8s=28, 12s=60; actual from audit)
    imageParam: "input_urls",  // Array format: [startFrame] or [startFrame, endFrame]
    extraParams: { resolution: "720p", fixed_lens: false, generate_audio: false },
    allowedDurations: [4, 8, 12],
    supportsEndFrame: true,  // End frame via input_urls array (handled in video.ts)
  },

  // Seedance 2.0 — docs.kie.ai/market/bytedance/seedance-2
  // Per-second pricing: 480p no-ref 19 cr/s, 480p ref 11.5 cr/s, 720p no-ref 41 cr/s, 720p ref 25 cr/s
  "seedance-2": {
    model: "bytedance/seedance-2",
    credits: 82,
    cost: 0.41,  // (8s, 720p, no ref default)
    imageParam: "first_frame_url",
    extraParams: {
      resolution: "720p",
      aspect_ratio: "adaptive",
      duration: 8,
      generate_audio: true,
      web_search: false,
      nsfw_checker: false,
    },
    allowedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsEndFrame: true,
    endFrameParam: "last_frame_url",
  },

  // Seedance 2.0 Fast — docs.kie.ai/market/bytedance/seedance-2-fast
  // Per-second pricing: 480p no-ref 15.5 cr/s, 480p ref 8 cr/s, 720p no-ref 33 cr/s, 720p ref 20 cr/s
  "seedance-2-fast": {
    model: "bytedance/seedance-2-fast",
    credits: 66,
    cost: 0.33,  // (8s, 720p, no ref default)
    imageParam: "first_frame_url",
    extraParams: {
      resolution: "720p",
      aspect_ratio: "adaptive",
      duration: 8,
      generate_audio: true,
      web_search: false,
      nsfw_checker: false,
    },
    allowedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsEndFrame: true,
    endFrameParam: "last_frame_url",
  },

  // Seedance 2.0 Mini — docs.kie.ai/market/bytedance/seedance-2-mini
  // Budget tier, 480p/720p only. Per-second pricing: 480p no-ref 9.5 cr/s, 480p ref 6 cr/s,
  // 720p no-ref 20.5 cr/s, 720p ref 12.5 cr/s. Per-second composites in credits.ts are authoritative.
  "seedance-2-mini": {
    model: "bytedance/seedance-2-mini",
    credits: 41,
    cost: 0.205,  // nominal 8s/720p/no-ref fallback (41 cr × ); composites override
    imageParam: "first_frame_url",
    extraParams: {
      resolution: "720p",
      aspect_ratio: "adaptive",
      duration: 8,
      generate_audio: true,
      web_search: false,
      nsfw_checker: false,
    },
    allowedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsEndFrame: true,
    endFrameParam: "last_frame_url",
  },

  // Wan 2.6 I2V - docs.kie.ai/market/wan/2-6-image-to-video
  "wan-i2v": {
    model: "wan/2-6-image-to-video",
    credits: 70,
    cost: 0.35,  // (5s, 720p default)
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

  // Wan 2.7 I2V — 2–15s, 720p/1080p, supports start+end frame
  // See: docs.kie.ai/market/wan/2-7-image-to-video.md
  // KIE params: first_frame_url (string) + last_frame_url (string) for end frame
  "wan-2.7-i2v": {
    model: "wan/2-7-image-to-video",
    credits: 75,
    cost: 0.375,  // (5s 720p)
    imageParam: "first_frame_url",  // single string; end frame goes to last_frame_url
    supportsEndFrame: true,
    allowedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },

  // HappyHorse 1.1 I2V — image_urls array (single-element), 3–15s, AR inferred from image.
  // Per-second billing: KIE 22.5 cr/s @720p, 29 cr/s @1080p (published). The Nodaro
  // charge is seeded per (duration × resolution) in STATIC_CREDIT_COSTS + model_pricing;
  // `credits`/`cost` below are the KIE-side default tier (5s @720p) for audit logging.
  // resolution is pinned so the render default matches the billing default (KIE would
  // otherwise default to 1080p). 1.1 removed `seed` (additionalProperties: false).
  // See: docs.kie.ai/market/happyhorse-1-1/image-to-video.md
  "happyhorse-i2v": {
    model: "happyhorse-1-1/image-to-video",
    credits: 112.5,          // KIE: 22.5 × 5 (5s @720p default tier)
    cost: 0.5625,
    imageParam: "image_urls",  // array format (single-element)
    extraParams: { resolution: "720p" },
    omitSeed: true,
    supportsEndFrame: false,
    allowedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },

  // HappyHorse 1.1 Ref2V — reference_image array (1–9 ref images), 3–15s.
  // Billing identical to happyhorse-i2v (see above). Prompt can address refs as
  // "[Image 1]"…"[Image 9]" in media-array order.
  // See: docs.kie.ai/market/happyhorse-1-1/reference-to-video.md
  "happyhorse-ref2v": {
    model: "happyhorse-1-1/reference-to-video",
    credits: 112.5,          // KIE: 22.5 × 5 (5s @720p default tier)
    cost: 0.5625,
    imageParam: "reference_image",  // array of up to 9 ref image URLs
    maxRefImages: 9,
    extraParams: { resolution: "720p" },
    omitSeed: true,
    supportsEndFrame: false,
    allowedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },

  // Hailuo 2.3 Pro I2V - docs.kie.ai/market/hailuo/2-3-image-to-video-pro
  "hailuo-2.3-pro": {
    model: "hailuo/2-3-image-to-video-pro",
    credits: 80,
    cost: 0.40,  // (10s actual from audit)
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "768P" },
    allowedDurations: [6, 10],
    supportsEndFrame: false,
  },

  // Hailuo 2.3 Standard I2V - docs.kie.ai/market/hailuo/2-3-image-to-video-standard
  "hailuo-2.3": {
    model: "hailuo/2-3-image-to-video-standard",
    credits: 30,
    cost: 0.15,  // (6s, 768p default)
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
    cost: 0.15,  // (6s, 768p default)
    imageParam: "image_url",  // Single URL string
    extraParams: { prompt_optimizer: false, resolution: "768P" },
    allowedDurations: [6, 10],
    supportsEndFrame: true,
    endFrameParam: "end_image_url",
  },

  // Bytedance V1 Lite I2V - docs.kie.ai/market/bytedance/v1-lite-image-to-video
  "bytedance-lite": {
    model: "bytedance/v1-lite-image-to-video",
    credits: 22.5,
    cost: 0.1125,  // (actual from audit)
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
    cost: 0.35,  // (actual from audit)
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "480p" },
    allowedDurations: [5, 10],
    supportsEndFrame: false,
  },

  // Bytedance V1 Pro Fast I2V - docs.kie.ai/market/bytedance/v1-pro-fast-image-to-video
  "bytedance-pro-fast": {
    model: "bytedance/v1-pro-fast-image-to-video",
    credits: 36,
    cost: 0.18,  // (actual from audit)
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "720p" },
    allowedDurations: [5, 10],
    supportsEndFrame: false,
  },

  // Kling V2.1 Master I2V - docs.kie.ai/market/kling/v2-1-master-image-to-video
  "kling-master": {
    model: "kling/v2-1-master-image-to-video",
    credits: 160,
    cost: 0.80,  // (Master 5s)
    // NOTE: 10s
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
    cost: 0.06,  // (5s, 720p default)
    // NOTE: 10s-720p=30, 5s-1080p=30
    imageParam: "imageUrl",  // Single URL string (top-level body param)
    extraParams: { duration: 5, quality: "720p" },
    allowedDurations: [5, 10],
    supportsEndFrame: false,
  },

  // Gemini Omni Video — multimodal I2V/V2V/T2V via standard market endpoint.
  // See: docs.kie.ai (gemini-omni-video)
  "gemini-omni-video": {
    model: "gemini-omni-video",
    credits: 90,               // KIE credits for the cheapest tier (audit display)
    cost: 0.45,                // USD display fallback only — real cost via STATIC composites
    allowedDurations: [4, 6, 8, 10],
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
    cost: 0.285,  // (6s, 1080p)
    extraParams: { prompt_optimizer: false },
    allowedDurations: [5],  // Hailuo produces ~5 second videos
  },

  // VEO 3.1 - Uses SPECIAL API endpoint: /api/v1/veo/generate
  // Duration: 4 / 6 / 8 seconds (KIE 2026-05-26 — pricing flat per generation across durations).
  "veo3": {
    model: "veo3",  // VEO 3.1 Quality
    credits: 250,
    cost: 1.25,  // (VEO 3.1 Quality)
    extraParams: { generationType: "TEXT_2_VIDEO" },
    allowedDurations: [4, 6, 8],
  },

  // VEO 3.1 Fast - Uses SPECIAL API endpoint: /api/v1/veo/generate
  "veo3.1": {
    model: "veo3_fast",  // VEO 3.1 Fast
    credits: 60,
    cost: 0.30,  // @ 720p (1080p costs 65 cr / — composite "veo3.1:1080p")
    extraParams: { generationType: "TEXT_2_VIDEO" },
    allowedDurations: [4, 6, 8],
  },
  "veo3_lite": {
    model: "veo3_lite",  // VEO 3.1 Lite
    credits: 30,
    cost: 0.15,  // @ 720p (1080p costs 35 cr / — composite "veo3_lite:1080p")
    extraParams: { generationType: "TEXT_2_VIDEO" },
    allowedDurations: [4, 6, 8],
  },

  // Kling family - VERIFIED: docs.kie.ai/market/kling/text-to-video
  "kling": {
    model: "kling-2.6/text-to-video",
    credits: 55,
    cost: 0.275,  // (5s, no audio default)
    // NOTE: 5s+audio=110, 10s=110, 10s+audio=220
    extraParams: { sound: false, aspect_ratio: "16:9", duration: "5" },
    allowedDurations: [5, 10],  // Kling supports 5 or 10 second videos
  },
  "kling-turbo": {
    model: "kling/v2-5-turbo-text-to-video-pro",
    credits: 42,
    cost: 0.21,  // (5s default)
    extraParams: { duration: "5", cfg_scale: 0.5 },
    allowedDurations: [5, 10],  // Kling Turbo supports 5 or 10 second videos
  },

  // Grok
  "grok": {
    model: "grok-imagine/text-to-video",
    credits: 20,
    cost: 0.10,  // (6s, 720p default)
    extraParams: { aspect_ratio: "16:9", mode: "normal", duration: "6", resolution: "720p" },
    allowedDurations: [6, 10],  // Grok supports 6 or 10 second videos
  },

  // Kling 3.0 - uses kling3-client.ts (unified createTask endpoint)
  // Per-second pricing: 20-40 cr/sec depending on audio + resolution
  "kling-3.0": {
    model: "kling-3.0/video",
    credits: 200,
    cost: 1.00,  // 40 cr/sec * 5s default (1080P, audio on)
    extraParams: { sound: true, duration: "5", mode: "pro", multi_shots: false },
    allowedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },

  // Seedance 1.5 Pro T2V - docs.kie.ai/market/bytedance/seedance-1.5-pro
  "seedance": {
    model: "bytedance/seedance-1.5-pro",
    credits: 33,
    cost: 0.165,  // avg (4s=14, 8s=28, 12s=60; actual from audit)
    extraParams: { resolution: "720p", fixed_lens: false, generate_audio: false },
    allowedDurations: [4, 8, 12],
  },

  // Seedance 2.0 T2V — docs.kie.ai/market/bytedance/seedance-2
  "seedance-2": {
    model: "bytedance/seedance-2",
    credits: 82,
    cost: 0.41,
    extraParams: {
      resolution: "720p",
      aspect_ratio: "adaptive",
      duration: 8,
      generate_audio: true,
      web_search: false,
      nsfw_checker: false,
    },
    allowedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },

  // Seedance 2.0 Fast T2V - docs.kie.ai/market/bytedance/seedance-2-fast
  "seedance-2-fast": {
    model: "bytedance/seedance-2-fast",
    credits: 66,
    cost: 0.33,
    extraParams: {
      resolution: "720p",
      aspect_ratio: "adaptive",
      duration: 8,
      generate_audio: true,
      web_search: false,
      nsfw_checker: false,
    },
    allowedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },

  // Seedance 2.0 Mini T2V — docs.kie.ai/market/bytedance/seedance-2-mini
  "seedance-2-mini": {
    model: "bytedance/seedance-2-mini",
    credits: 41,
    cost: 0.205,  // nominal 8s/720p/no-ref fallback; per-second composites authoritative
    extraParams: {
      resolution: "720p",
      aspect_ratio: "adaptive",
      duration: 8,
      generate_audio: true,
      web_search: false,
      nsfw_checker: false,
    },
    allowedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },

  // Wan 2.6 T2V - docs.kie.ai/market/wan/2-6-text-to-video
  "wan": {
    model: "wan/2-6-text-to-video",
    credits: 104.5,
    cost: 0.5225,  // (5s, 1080p default)
    // NOTE: 720p=70, 10s-720p=140, 10s-1080p=209.5, 15s-720p=210, 15s-1080p=315
    extraParams: { resolution: "1080p" },
    allowedDurations: [5, 10, 15],
  },

  // Hailuo Standard (02) T2V - docs.kie.ai/market/hailuo/02-text-to-video-standard
  "hailuo-standard": {
    model: "hailuo/02-text-to-video-standard",
    credits: 30,
    cost: 0.15,  // (6s, 768p default)
    extraParams: { prompt_optimizer: false },
    allowedDurations: [6, 10],
  },

  // Bytedance V1 Lite T2V - docs.kie.ai/market/bytedance/v1-lite-text-to-video
  "bytedance-lite": {
    model: "bytedance/v1-lite-text-to-video",
    credits: 22.5,
    cost: 0.1125,  // (actual from audit)
    extraParams: { aspect_ratio: "16:9", resolution: "720p" },
    allowedDurations: [5, 10],
  },

  // Bytedance V1 Pro T2V - docs.kie.ai/market/bytedance/v1-pro-text-to-video
  "bytedance-pro": {
    model: "bytedance/v1-pro-text-to-video",
    credits: 70,
    cost: 0.35,  // (actual from audit)
    extraParams: { aspect_ratio: "16:9", resolution: "720p" },
    allowedDurations: [5, 10],
  },

  // Wan 2.2 Turbo T2V - docs.kie.ai/market/wan/2-2-a14b-text-to-video-turbo
  "wan-turbo": {
    model: "wan/2-2-a14b-text-to-video-turbo",
    credits: 80,
    cost: 0.40,  // (5s, 720p default)
    // NOTE: 480p=40, 580p=60
    extraParams: { aspect_ratio: "16:9", resolution: "720p" },
    allowedDurations: [5],
  },

  // Runway (KIE) T2V - special endpoint: /api/v1/runway/generate
  "runway-kie": {
    model: "runway",
    credits: 12,
    cost: 0.06,  // (5s, 720p default)
    extraParams: { duration: 5, quality: "720p", aspectRatio: "16:9" },
    allowedDurations: [5, 10],
  },

  // Gemini Omni Video T2V — multimodal text-to-video via standard market endpoint.
  "gemini-omni-video": {
    model: "gemini-omni-video",
    credits: 90,               // KIE credits for the cheapest tier (audit display)
    cost: 0.45,                // USD display fallback only — real cost via STATIC composites
    allowedDurations: [4, 6, 8, 10],
  },

  // Wan 2.7 T2V — 2–15s, 720p/1080p
  // See: docs.kie.ai/market/wan/2-7-text-to-video.md
  "wan-2.7-t2v": {
    model: "wan/2-7-text-to-video",
    credits: 75,
    cost: 0.375,  // (5s 720p)
    aspectRatioParam: "ratio",  // KIE uses "ratio" not "aspect_ratio" for this model
    allowedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },

  // HappyHorse 1.1 T2V — 3–15s, 720p/1080p, 9 aspect ratios (incl. 4:5/5:4/21:9/9:21).
  // Per-second billing: KIE 22.5 cr/s @720p, 29 cr/s @1080p (published); Nodaro charge
  // seeded per (duration × resolution) — `credits`/`cost` are the 5s @720p default tier
  // for audit logging. resolution pinned to keep render = billed default; `seed` was
  // removed in 1.1 (additionalProperties: false), hence omitSeed.
  // See: docs.kie.ai/market/happyhorse-1-1/text-to-video.md
  "happyhorse": {
    model: "happyhorse-1-1/text-to-video",
    credits: 112.5,          // KIE: 22.5 × 5 (5s @720p default tier)
    cost: 0.5625,
    extraParams: { resolution: "720p" },
    omitSeed: true,
    allowedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
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
    cost: 0.35,  // (5s, 720p default)
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

  // Wan 2.7 VideoEdit — guided video editing with optional reference image
  // See: docs.kie.ai/market/wan/2-7-videoedit
  // Supports: video_url, prompt, negative_prompt, resolution (720p/1080p),
  //   aspect_ratio, duration (0=auto or 2-10s), audio_setting (auto/origin),
  //   prompt_extend (bool), seed, reference_image (optional single URL)
  // Cost: per generation
  "wan-videoedit": {
    model: "wan/2-7-videoedit",
    credits: 100,
    cost: 0.50,
    imageParam: "reference_image",
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
    cost: 0.55,
    extraParams: {},
  },

  // HappyHorse Video Edit — video-to-video, up to 60s input, 720p/1080p.
  // Stays on the 1.0 endpoint: the 1.1 release has NO video-edit mode. KIE bills
  // per second (published: 28 cr/s @720p, 48 cr/s @1080p); we charge a flat
  // 5s-@720p-equivalent because the input clip's duration isn't known at credit
  // reservation time (see STATIC_CREDIT_COSTS note). resolution pinned to 720p
  // so the render default matches the billed assumption.
  // See: docs.kie.ai/market/happyhorse/video-edit.md
  "happyhorse-edit": {
    model: "happyhorse/video-edit",
    credits: 140,            // KIE: 28 × 5 (5s @720p equivalent)
    cost: 0.700,
    imageParam: "video_url",  // input video URL (single string)
    extraParams: { resolution: "720p" },
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
  // Per-second pricing: /sec (720p), /sec (1080p)
  "kling": {
    model: "kling-2.6/motion-control",
    credits: 60,
    cost: 0.30,  // 6 cr/sec * 10s default = (720p)
    imageParam: "input_urls",  // Array format for input images
    extraParams: { character_orientation: "image", resolution: "720p" },
  },

  // Kling 3.0 Motion Control - uses createTask endpoint
  // character_orientation: "image" or "video"
  // mode: "720p" or "1080p" (same as kling-2.6/motion-control, NOT "std"/"pro")
  // background_source: "input_video" or "input_image" (default: input_video)
  // Per-second pricing: /sec (720p), /sec (1080p)
  "kling-3.0": {
    model: "kling-3.0/motion-control",
    credits: 120,
    cost: 0.60,  // 12 cr/sec * 10s default = (720p)
    imageParam: "input_urls",
    extraParams: { character_orientation: "video", mode: "720p" },
  },

  // Wan 2.2 Animate Move - standard createTask endpoint
  // See: docs.kie.ai/market/wan/2-2-animate-move.md
  // Moves character from image within the video scene (~1s output)
  "wan-animate-move": {
    model: "wan/2-2-animate-move",
    credits: 102,
    cost: 0.51,  // (480p actual from audit)
    // NOTE: 580p, 720p = (actual from audit)
    imageParam: "image_url",  // Single URL string
    extraParams: { resolution: "480p" },
  },

  // Wan 2.2 Animate Replace - standard createTask endpoint
  // See: docs.kie.ai/market/wan/2-2-animate-replace.md
  // Replaces character in video with character from image (~1s output)
  "wan-animate-replace": {
    model: "wan/2-2-animate-replace",
    credits: 102,
    cost: 0.51,  // (480p, same as move)
    // NOTE: 580p, 720p = (same as move)
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
    cost: 0.56,  // 8 cr/sec * ~14s = (720p)
    imageParam: "image_url",
    extraParams: {},
  },
  "kling-avatar-pro": {
    model: "kling/ai-avatar-pro",
    credits: 224,
    cost: 1.12,  // 16 cr/sec * ~14s = (1080p)
    imageParam: "image_url",
    extraParams: {},
  },

  // Infinitalk (up to 15 sec audio, 3–/sec by resolution)
  "infinitalk": {
    model: "infinitalk/from-audio",
    credits: 168,
    cost: 0.84,  // 12 cr/sec * ~14s = (720p max)
    imageParam: "image_url",
    extraParams: { resolution: "720p" },
  },

  // OmniHuman 1.5 (ByteDance) — image+audio → prompt-directed avatar.
  // Per-second (/sec); resolution is a quality lever, not a price lever.
  // Distinct param names vs other avatars: output_resolution ("720"|"1080"),
  // pe_fast_mode, seed — mapped by the generic lipSync() dispatch.
  "omnihuman-1-5": {
    model: "omnihuman-1-5",
    credits: 405,            // 15s display anchor (27 cr/sec × 15s); real charge is per-second bucket
    cost: 2.025,             // USD display anchor
    imageParam: "image_url",
    resolutionParam: "output_resolution",
    resolutionMap: { "480p": "720", "720p": "720", "1080p": "1080" },
    defaultResolution: "1080",
    supportsFastMode: true,
    supportsSeed: true,
    extraParams: {},
  },

  // Volcengine video-to-video lip sync (AI dubbing). VIDEO input (video_url +
  // audio_url) — routed through the KIE `lipSyncVideo` path, NOT the image+prompt
  // `lipSync` path. Billed per-second by the route via the volcengine-lipsync:Ns
  // buckets; cost/credits here are nominal (~14s @ /sec, identical to
  // kling-avatar) and are NOT the billing driver.
  "volcengine-lipsync": {
    model: "volcengine/video-to-video-lip-sync",
    inputKind: "video",
    credits: 112,
    cost: 0.56,
    extraParams: {},
  },
}

// =============================================================================
// MUSIC GENERATION MODELS
// =============================================================================
export const KIE_MUSIC_MODELS: Record<string, KieModelConfig> = {
  "suno": {
    model: "suno/v4",
    credits: 12,
    cost: 0.06,  // (per generation, same price for v4/v5)
  },
  "suno-v5": {
    model: "suno/v5",
    credits: 12,
    cost: 0.06,  // (per generation)
  },
  "suno-v5_5": {
    model: "suno/v5_5",
    credits: 12,
    cost: 0.06,  // (per generation)
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
    cost: 0.03,  // per 1K chars
  },
  "elevenlabs-multilingual": {
    model: "elevenlabs/text-to-speech-multilingual-v2",
    credits: 12,
    cost: 0.06,  // per 1K chars
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
    cost: 0.006,  // 0.24 cr/sec * ~5s
  },
}

// =============================================================================
// AUDIO ISOLATION MODELS
// =============================================================================
export const KIE_AUDIO_ISOLATION_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs-isolation": {
    model: "elevenlabs/audio-isolation",
    credits: 29.6,
    cost: 0.148,  // /sec, variable; ~148s avg = (actual from audit)
  },
}

// =============================================================================
// SPEECH-TO-TEXT MODELS
// =============================================================================
export const KIE_STT_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs-stt": {
    model: "elevenlabs/speech-to-text",
    credits: 8.58,
    cost: 0.0429,  // avg (actual from audit), variable by audio length
  },
}

// =============================================================================
// TEXT-TO-DIALOGUE MODELS (Multi-speaker TTS)
// =============================================================================
export const KIE_DIALOGUE_MODELS: Record<string, KieModelConfig> = {
  "elevenlabs-dialogue": {
    model: "elevenlabs/text-to-dialogue-v3",
    credits: 14,
    cost: 0.07,  // per 1K chars
  },
}

// =============================================================================
// SPEECH-TO-VIDEO MODELS
// =============================================================================
export const KIE_SPEECH_TO_VIDEO_MODELS: Record<string, KieModelConfig> = {
  "wan-s2v": {
    model: "wan/2-2-a14b-speech-to-video-turbo",
    credits: 12,
    cost: 0.06,  // (480p default)
    // NOTE: 580p, 720p
    imageParam: "image_url",
    extraParams: { resolution: "480p" },
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

}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export type KieCategory = "image" | "video" | "video-to-video" | "text-to-video" | "motion-transfer" | "video-upscale" | "lip-sync" | "speech-to-video" | "music" | "tts" | "sound-effect" | "audio-isolation" | "stt" | "dialogue" | "special"

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
