// Static pricing configuration for admin overview
// Subscription tiers, top-ups, FFmpeg, and LLM are hardcoded (don't change per-model).
// AI model pricing (image, video, audio) comes from the model_pricing DB table.

export interface SubscriptionTier {
  readonly name: string
  readonly priceMonthly: number
  readonly priceAnnual: number
  readonly credits: number
  readonly perCredit: number | null
  readonly llmRequests: string
  readonly estimatedCost: number
  readonly marginMonthly: number | null
  readonly marginAnnual: number | null
  readonly notes?: string
}

export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  [REMOVED — margin data]
  [REMOVED — margin data]
  [REMOVED — margin data]
  [REMOVED — margin data]
  [REMOVED — margin data]
] as const

export interface TopUpPackage {
  readonly name: string
  readonly price: number
  readonly credits: number
  readonly perCredit: number
}

export const TOPUP_PACKAGES: readonly TopUpPackage[] = [
  { name: "Small", price: 10, credits: 150, perCredit: 0.067 },
  { name: "Medium", price: 25, credits: 450, perCredit: 0.056 },
  { name: "Large", price: 50, credits: 1000, perCredit: 0.050 },
  { name: "XL", price: 100, credits: 2200, perCredit: 0.045 },
] as const

export interface LLMPricing {
  readonly model: string
  readonly inputCost: string
  readonly outputCost: string
  readonly perRequest: string
}

export const LLM_MODELS: readonly LLMPricing[] = [
  [REMOVED — rate data]
  [REMOVED — rate data]
] as const

export interface FFmpegNode {
  readonly name: string
  readonly description: string
}

export const FFMPEG_NODES: readonly FFmpegNode[] = [
  { name: "Merge Video & Audio", description: "Combine video + audio track" },
  { name: "Adjust Volume", description: "Change audio volume" },
  { name: "Mix Audio", description: "Blend multiple audio tracks" },
  { name: "Combine Videos", description: "Concatenate multiple videos" },
  { name: "Dialogue Timeline", description: "Place audio at specific timestamps (planned)" },
  { name: "Extract Audio", description: "Strip audio from video" },
  { name: "Download Video", description: "Download + re-encode to h264" },
] as const

// Category detection shared with /admin/models (same logic)
export type DBCategory = "image" | "video" | "audio" | "processing" | "other"

const CATEGORY_PATTERNS: ReadonlyArray<readonly [DBCategory, ReadonlyArray<string>]> = [
  ["image", ["nano", "flux", "grok", "gpt-image", "recraft", "ideogram", "midjourney", "imagen", "seedream", "qwen", "z-image", "topaz-image"]],
  ["video", ["veo", "kling", "minimax", "wan", "grok-i2v", "runway", "pika", "hailuo", "topaz-video", "motion-transfer", "speech-to-video", "bytedance", "seedance"]],
  ["audio", ["suno", "elevenlabs", "infinitalk", "tango", "musicgen", "audioldm", "bark"]],
  ["processing", ["ffmpeg", "topaz"]],
]

export function detectCategory(modelId: string): DBCategory {
  const lower = modelId.toLowerCase()
  for (const [category, patterns] of CATEGORY_PATTERNS) {
    if (patterns.some((p) => lower.includes(p))) return category
  }
  return "other"
}

export const CATEGORY_LABELS: Record<DBCategory, string> = {
  image: "Image Generation",
  video: "Video Generation",
  audio: "Audio / TTS / Music",
  processing: "Processing",
  other: "Other",
}

export const CATEGORY_COLORS: Record<DBCategory, string> = {
  image: "text-blue-500",
  video: "text-purple-500",
  audio: "text-amber-500",
  processing: "text-slate-500",
  other: "text-gray-500",
}

// ── Provider reference data (hardcoded costs from provider docs) ────

export interface ModelReferenceData {
  readonly provider: string
  readonly providerCostUsd: number | null  // null = variable (per-second billing or config-dependent)
  readonly markupPct: number
}

/** [comment removed] */
export const CREDIT_VALUE_USD = [REMOVED]

/** [comment removed] */
export const SELL_PRICE_PER_CREDIT_MAX = [REMOVED]  // Top-up ($10/150cr)
export const SELL_PRICE_PER_CREDIT_MIN = [REMOVED]  // Business tier ($129/5600cr)

/**
 * [comment removed]
 * [comment removed]
 * null = variable (per-second billing or config-dependent, calculated at runtime).
 * [formula removed]
 *
 * For per-second models (kling 3.0, motion-transfer, lip-sync), the cost shown
 * is for the DEFAULT configuration (typically 5-10s at default resolution).
 */
export const MODEL_REFERENCE: Readonly<Record<string, ModelReferenceData>> = {
  // ── Image Generation ──
  "nano-banana":       { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },  // 4 KIE cr
  "nano-banana-2":     { provider: "KIE.ai",    providerCostUsd: 0.040, markupPct: 25 },  // 8 KIE cr (1K default)
  "nano-banana-pro":   { provider: "KIE.ai",    providerCostUsd: 0.090, markupPct: 25 },  // 18 KIE cr (1K/2K)
  "flux":              { provider: "KIE.ai",    providerCostUsd: 0.025, markupPct: 25 },  // 5 KIE cr (flux-2 pro 1K)
  "flux-flex":         { provider: "KIE.ai",    providerCostUsd: 0.070, markupPct: 25 },  // 14 KIE cr (Flex 1K)
  "flux-kontext":      { provider: "KIE.ai",    providerCostUsd: 0.025, markupPct: 25 },  // 5 KIE cr (Pro)
  "flux-kontext-max":  { provider: "KIE.ai",    providerCostUsd: 0.050, markupPct: 25 },  // 10 KIE cr (Max)
  "grok":              { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },  // 4 KIE cr
  "gpt-image":         { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },  // 4 KIE cr (gpt image 1.5 medium)
  "gpt-image-2":       { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },  // 4 KIE cr (1K default; estimated until calibrated)
  "imagen4":           { provider: "KIE.ai",    providerCostUsd: 0.040, markupPct: 25 },  // 8 KIE cr (default)
  "imagen4-fast":      { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },  // 4 KIE cr
  "imagen4-ultra":     { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },  // 12 KIE cr
  "ideogram-v3":       { provider: "KIE.ai",    providerCostUsd: 0.035, markupPct: 25 },  // 7 KIE cr (BALANCED)
  "ideogram-edit":     { provider: "KIE.ai",    providerCostUsd: 0.090, markupPct: 25 },  // 18 KIE cr (BALANCED)
  "ideogram-remix":    { provider: "KIE.ai",    providerCostUsd: 0.090, markupPct: 25 },  // 18 KIE cr (BALANCED)
  "ideogram-reframe":  { provider: "KIE.ai",    providerCostUsd: 0.035, markupPct: 25 },  // 7 KIE cr (BALANCED)
  "qwen":              { provider: "KIE.ai",    providerCostUsd: 0.010, markupPct: 25 },  // 2 KIE cr
  "qwen-i2i":          { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },  // 4 KIE cr
  "qwen-edit":         { provider: "KIE.ai",    providerCostUsd: 0.025, markupPct: 25 },  // 5 KIE cr
  "z-image":           { provider: "KIE.ai",    providerCostUsd: 0.004, markupPct: 25 },  // 0.8 KIE cr
  "seedream":          { provider: "KIE.ai",    providerCostUsd: 0.0275, markupPct: 25 }, // 5.5 KIE cr
  "seedream-edit":     { provider: "KIE.ai",    providerCostUsd: 0.032, markupPct: 25 },  // 6.5 KIE cr
  "seedream-5-lite":   { provider: "KIE.ai",    providerCostUsd: 0.0275, markupPct: 25 }, // 5.5 KIE cr
  "seedream-5-lite-i2i": { provider: "KIE.ai",  providerCostUsd: 0.0275, markupPct: 25 }, // 5.5 KIE cr
  // ── Image Editing ──
  "recraft-upscale":   { provider: "KIE.ai",    providerCostUsd: 0.0025, markupPct: 25 }, // 0.5 KIE cr
  "recraft-remove-bg": { provider: "KIE.ai",    providerCostUsd: 0,      markupPct: 25 }, // 1 KIE cr (free)
  "nano-banana-edit":  { provider: "KIE.ai",    providerCostUsd: 0.020,  markupPct: 25 }, // 4 KIE cr
  "topaz-image-upscale": { provider: "KIE.ai",  providerCostUsd: 0.050,  markupPct: 25 }, // 10 KIE cr (2K default)
  "grok-upscale":      { provider: "KIE.ai",    providerCostUsd: 0.050,  markupPct: 25 }, // 10 KIE cr (360p→720p)
  "generate-mask":     { provider: "Replicate", providerCostUsd: 0.032,  markupPct: 25 }, // 2 cr — adirik/grounded-sam (Grounding DINO + SAM)
  // ── Image-to-Image ──
  "flux-i2i":          { provider: "KIE.ai",    providerCostUsd: 0.070, markupPct: 25 },  // 14 KIE cr (Flux 2 Flex i2i 1K)
  "flux-pro-i2i":      { provider: "KIE.ai",    providerCostUsd: 0.025, markupPct: 25 },  // 5 KIE cr (flux-2 pro i2i 1K)
  "grok-i2i":          { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },  // 4 KIE cr
  "gpt-image-i2i":     { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },  // 4 KIE cr (gpt image 1.5 medium)
  "gpt-image-2-i2i":   { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },  // 4 KIE cr (1K default; estimated)
  // ── Video Generation (I2V / T2V) — costs for default config ──
  "minimax":           { provider: "KIE.ai",    providerCostUsd: 0.285, markupPct: 25 },  // 57 KIE cr (hailuo 02 Pro 6s 1080p)
  "veo3":              { provider: "KIE.ai",    providerCostUsd: 1.250, markupPct: 25 },  // 250 KIE cr (VEO 3.1 Quality)
  "veo3.1":            { provider: "KIE.ai",    providerCostUsd: 0.300, markupPct: 25 },  // 60 KIE cr (VEO 3.1 Fast @ 720p)
  "veo3.1:1080p":      { provider: "KIE.ai",    providerCostUsd: 0.325, markupPct: 25 },  // 65 KIE cr (VEO 3.1 Fast @ 1080p)
  "veo3_lite":         { provider: "KIE.ai",    providerCostUsd: 0.150, markupPct: 25 },  // 30 KIE cr (VEO 3.1 Lite @ 720p)
  "veo3_lite:1080p":   { provider: "KIE.ai",    providerCostUsd: 0.175, markupPct: 25 },  // 35 KIE cr (VEO 3.1 Lite @ 1080p)
  "kling":             { provider: "KIE.ai",    providerCostUsd: 0.550, markupPct: 25 },  // 110 KIE cr (2.6, 10s avg)
  "kling-turbo":       { provider: "KIE.ai",    providerCostUsd: 0.210, markupPct: 25 },  // 42 KIE cr (2.5 turbo 5s)
  "kling-3.0":         { provider: "KIE.ai",    providerCostUsd: 1.000, markupPct: 25 },  // 40 cr/sec × 5s = 200 KIE cr (audio, 1080P)
  "kling-master":      { provider: "KIE.ai",    providerCostUsd: 0.800, markupPct: 25 },  // 160 KIE cr (Master 5s)
  "seedance":          { provider: "KIE.ai",    providerCostUsd: 0.165, markupPct: 25 },  // avg 33 KIE cr (4s=14, 8s=28, 12s=60)
  "seedance-2":        { provider: "KIE.ai",    providerCostUsd: 0.410, markupPct: 25 },  // 82 KIE cr avg (8s, 720p, no ref; per-sec)
  "seedance-2-fast":   { provider: "KIE.ai",    providerCostUsd: 0.330, markupPct: 25 },  // 66 KIE cr avg (8s, 720p, no ref; per-sec)
  "grok-i2v":          { provider: "KIE.ai",    providerCostUsd: 0.100, markupPct: 25 },  // 20 KIE cr (6s 720p)
  "wan-i2v":           { provider: "KIE.ai",    providerCostUsd: 0.350, markupPct: 25 },  // 70 KIE cr (wan 2.6, 5s, 720p)
  "wan-turbo":         { provider: "KIE.ai",    providerCostUsd: 0.200, markupPct: 25 },  // 40 KIE cr (wan 2.2, 5s, 480p)
  "hailuo-2.3-pro":    { provider: "KIE.ai",    providerCostUsd: 0.400, markupPct: 25 },  // 80 KIE cr (10s actual from audit)
  "hailuo-2.3":        { provider: "KIE.ai",    providerCostUsd: 0.150, markupPct: 25 },  // 30 KIE cr (Std 6s, 768p)
  "hailuo-standard":   { provider: "KIE.ai",    providerCostUsd: 0.150, markupPct: 25 },  // 30 KIE cr (Std 6s, 768p)
  "bytedance-lite":    { provider: "KIE.ai",    providerCostUsd: 0.250, markupPct: 25 },  // ~50 KIE cr (estimated)
  "bytedance-pro":     { provider: "KIE.ai",    providerCostUsd: 0.350, markupPct: 25 },  // 70 KIE cr (actual from audit)
  "bytedance-pro-fast": { provider: "KIE.ai",   providerCostUsd: 0.180, markupPct: 25 },  // 36 KIE cr (actual from audit)
  "runway-kie":        { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },  // 12 KIE cr (5s, 720p)
  "runway-aleph":      { provider: "KIE.ai",    providerCostUsd: 0.550, markupPct: 25 },  // 110 KIE cr
  // ── Video Extend / Upscale ──
  "veo-extend":        { provider: "KIE.ai",    providerCostUsd: 0.300, markupPct: 25 },  // 60 KIE cr (VEO 3.1 Fast)
  "runway-extend":     { provider: "KIE.ai",    providerCostUsd: 0.500, markupPct: 25 },  // ~100 KIE cr (Runway extend)
  "veo-1080p":         { provider: "KIE.ai",    providerCostUsd: 0.025, markupPct: 25 },  // 5 KIE cr
  "veo-4k":            { provider: "KIE.ai",    providerCostUsd: 0.600, markupPct: 25 },  // 120 KIE cr
  // ── Video-to-Video / Motion ──
  "wan":               { provider: "KIE.ai",    providerCostUsd: 0.350, markupPct: 25 },  // 70 KIE cr (V2V 5s 720p)
  "wan-flash":         { provider: "KIE.ai",    providerCostUsd: 0.200, markupPct: 25 },  // ~40 KIE cr (Flash V2V, faster)
  "wan-videoedit":     { provider: "KIE.ai",    providerCostUsd: 0.500, markupPct: 25 },  // 100 KIE cr (2.7 VideoEdit, guided edit)
  "wan-t2v":           { provider: "KIE.ai",    providerCostUsd: 0.5225, markupPct: 25 }, // 104.5 KIE cr (T2V 5s 1080p)
  "wan-turbo-t2v":     { provider: "KIE.ai",    providerCostUsd: 0.400, markupPct: 25 },  // 80 KIE cr (T2V 5s 720p)
  "wan-animate-move":  { provider: "KIE.ai",    providerCostUsd: 0.510, markupPct: 25 },  // 102 KIE cr (480p default)
  "wan-animate-replace": { provider: "KIE.ai",  providerCostUsd: 0.510, markupPct: 25 },  // 102 KIE cr (480p default)
  // Wan 2.7
  "wan-2.7":        { provider: "KIE.ai", providerCostUsd: 0.040, markupPct: 25 },  // 8 KIE cr, 1K default
  "wan-2.7-pro":    { provider: "KIE.ai", providerCostUsd: 0.060, markupPct: 25 },  // 12 KIE cr, 1K default
  "wan-2.7-i2v":    { provider: "KIE.ai", providerCostUsd: 0.375, markupPct: 25 },  // 75 KIE cr, 5s 720p
  "wan-2.7-t2v":    { provider: "KIE.ai", providerCostUsd: 0.375, markupPct: 25 },  // 75 KIE cr, 5s 720p

  // HappyHorse
  "happyhorse":       { provider: "KIE.ai", providerCostUsd: 0.250, markupPct: 25 },  // 50 KIE cr, 5s 720p
  "happyhorse-i2v":   { provider: "KIE.ai", providerCostUsd: 0.250, markupPct: 25 },  // 50 KIE cr, 5s 720p
  "happyhorse-ref2v": { provider: "KIE.ai", providerCostUsd: 0.300, markupPct: 25 },  // 60 KIE cr, 5s 720p
  "happyhorse-edit":  { provider: "KIE.ai", providerCostUsd: 0.400, markupPct: 25 },  // 80 KIE cr
  "luma-modify":       { provider: "KIE.ai",    providerCostUsd: 0.500, markupPct: 25 },  // ~100 KIE cr (estimated)
  "topaz-video":       { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },  // 12 KIE cr (upscale 1x/2x/4x)
  "motion-transfer":   { provider: "KIE.ai",    providerCostUsd: 0.300, markupPct: 25 },  // 6 cr/sec × 10s (kling 2.6 720p)
  "kling-motion":      { provider: "KIE.ai",    providerCostUsd: 0.300, markupPct: 25 },  // alias for motion-transfer
  "kling-3.0-motion":  { provider: "KIE.ai",    providerCostUsd: 0.600, markupPct: 25 },  // 12 cr/sec × 10s (kling 3.0 720p)
  // ── Lip Sync ──
  // Kling AI Avatar 2.0 (May 2026): max audio 5min, billed per-second
  // (8 KIE cr/sec Standard 720p, 16 KIE cr/sec Pro 1080p). Composite identifiers
  // `<provider>:<bucket>s` cover the 15/30/60/120/300s reservation buckets.
  "kling-avatar":          { provider: "KIE.ai",    providerCostUsd: 0.560, markupPct: 25 },  // legacy ~14s default
  "kling-avatar:15s":      { provider: "KIE.ai",    providerCostUsd: 0.600, markupPct: 25 },  // 15s × 8 KIE cr/sec
  "kling-avatar:30s":      { provider: "KIE.ai",    providerCostUsd: 1.200, markupPct: 25 },
  "kling-avatar:60s":      { provider: "KIE.ai",    providerCostUsd: 2.400, markupPct: 25 },
  "kling-avatar:120s":     { provider: "KIE.ai",    providerCostUsd: 4.800, markupPct: 25 },
  "kling-avatar:300s":     { provider: "KIE.ai",    providerCostUsd: 12.000, markupPct: 25 }, // 5-min ceiling
  "kling-avatar-pro":      { provider: "KIE.ai",    providerCostUsd: 1.120, markupPct: 25 },  // legacy ~14s default
  "kling-avatar-pro:15s":  { provider: "KIE.ai",    providerCostUsd: 1.200, markupPct: 25 },  // 15s × 16 KIE cr/sec
  "kling-avatar-pro:30s":  { provider: "KIE.ai",    providerCostUsd: 2.400, markupPct: 25 },
  "kling-avatar-pro:60s":  { provider: "KIE.ai",    providerCostUsd: 4.800, markupPct: 25 },
  "kling-avatar-pro:120s": { provider: "KIE.ai",    providerCostUsd: 9.600, markupPct: 25 },
  "kling-avatar-pro:300s": { provider: "KIE.ai",    providerCostUsd: 24.000, markupPct: 25 }, // 5-min ceiling
  "infinitalk":        { provider: "KIE.ai",    providerCostUsd: 0.525, markupPct: 25 },  // 3–12 KIE cr/sec × ~14s (avg 480p/720p)
  "hailuo-avatar":     { provider: "KIE.ai",    providerCostUsd: 0.350, markupPct: 25 },  // estimated
  // ── Audio / TTS / Music ──
  "elevenlabs-v3":     { provider: "ElevenLabs", providerCostUsd: 0.050, markupPct: 25 },  // direct ElevenLabs API
  "elevenlabs-turbo":       { provider: "KIE.ai",    providerCostUsd: 0.030, markupPct: 25 },  // 6 KIE cr
  "elevenlabs-multilingual": { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 }, // 12 KIE cr
  "elevenlabs":        { provider: "KIE.ai",    providerCostUsd: 0.030, markupPct: 25 },  // alias for turbo
  "elevenlabs-sfx":    { provider: "KIE.ai",    providerCostUsd: 0.0012, markupPct: 25 }, // 0.24 KIE cr
  "elevenlabs-dialogue": { provider: "KIE.ai",  providerCostUsd: 0.070, markupPct: 25 },  // 14 KIE cr
  "elevenlabs-stt":    { provider: "KIE.ai",    providerCostUsd: 0.0175, markupPct: 25 }, // 3.5 KIE cr
  "elevenlabs-isolation": { provider: "KIE.ai", providerCostUsd: 0.001, markupPct: 25 },  // 0.2 KIE cr
  "voice-clone":       { provider: "ElevenLabs", providerCostUsd: 0.060, markupPct: 25 },  // instant clone
  "elevenlabs-voice-changer":    { provider: "ElevenLabs", providerCostUsd: 0.050, markupPct: 25 },  // speech-to-speech
  "elevenlabs-dubbing":          { provider: "ElevenLabs", providerCostUsd: 0.100, markupPct: 25 },  // async dubbing
  "elevenlabs-voice-remix":      { provider: "ElevenLabs", providerCostUsd: 0.050, markupPct: 25 },  // voice preview
  "elevenlabs-voice-design":     { provider: "ElevenLabs", providerCostUsd: 0.060, markupPct: 25 },  // full voice design
  "elevenlabs-forced-alignment": { provider: "ElevenLabs", providerCostUsd: 0.035, markupPct: 25 },  // timestamps
  "suno":              { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },  // 12 KIE cr
  "suno-v5":           { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-generate":     { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-cover":        { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-extend":       { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-lyrics":       { provider: "KIE.ai",    providerCostUsd: 0.002, markupPct: 25 },  // 0.4 KIE cr
  "suno-separate":     { provider: "KIE.ai",    providerCostUsd: 0.050, markupPct: 25 },  // 10 KIE cr (vocal)
  "suno-separate-stem": { provider: "KIE.ai",   providerCostUsd: 0.250, markupPct: 25 },  // 50 KIE cr (multi-stem)
  "suno-music-video":  { provider: "KIE.ai",    providerCostUsd: 0.010, markupPct: 25 },  // 2 KIE cr
  "suno-mashup":       { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },  // 12 KIE cr
  "suno-replace-section": { provider: "KIE.ai", providerCostUsd: 0.025, markupPct: 25 },  // 5 KIE cr
  "suno-style-boost":  { provider: "KIE.ai",    providerCostUsd: 0.002, markupPct: 25 },  // 0.4 KIE cr
  "suno-add-instrumental": { provider: "KIE.ai", providerCostUsd: 0.060, markupPct: 25 },
  "suno-add-vocals":   { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-convert-wav":  { provider: "KIE.ai",    providerCostUsd: 0.002, markupPct: 25 },  // 0.4 KIE cr
  "suno-upload-extend": { provider: "KIE.ai",   providerCostUsd: 0.060, markupPct: 25 },
  // ── Processing ──
  "topaz":             { provider: "KIE.ai",    providerCostUsd: null,  markupPct: 25 },  // variable
  "speech-to-video":   { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },  // 12 KIE cr (480p)
  "ffmpeg":            { provider: "Self",      providerCostUsd: 0,     markupPct: 0  },
  "render-video":      { provider: "Self",      providerCostUsd: 0,     markupPct: 0  },
  "video-composer":    { provider: "Anthropic", providerCostUsd: 0.010, markupPct: 25 },
  "add-captions":         { provider: "FFmpeg",   providerCostUsd: 0,     markupPct: 0  },
  "add-captions:kinetic": { provider: "Remotion", providerCostUsd: 0.08,  markupPct: 25 },
}
