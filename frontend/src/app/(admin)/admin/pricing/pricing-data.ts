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
  { name: "Free", priceMonthly: 0, priceAnnual: 0, credits: 150, perCredit: null, llmRequests: "20/mo", estimatedCost: 3, marginMonthly: null, marginAnnual: null, notes: "One-time credits, 30 cr/day, VEO 3 blocked, watermark" },
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
  ["video", ["veo", "kling", "minimax", "wan", "sora", "grok-i2v", "runway", "pika", "hailuo", "topaz-video", "motion-transfer", "speech-to-video", "bytedance", "seedance"]],
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
  readonly providerCostUsd: number | null  // null = dynamic (Replicate predict_time based)
  readonly markupPct: number
}

/** [comment removed] */
export const CREDIT_VALUE_USD = [REMOVED]

/** [comment removed] */
export const SELL_PRICE_PER_CREDIT_MAX = [REMOVED]  // Top-up ($10/150cr)
export const SELL_PRICE_PER_CREDIT_MIN = [REMOVED]  // Business tier ($129/5600cr)

/**
 * [comment removed]
 * KIE.ai costs from https://docs.kie.ai pricing tables.
 * null = dynamic (per-second billing, calculated at runtime).
 * [formula removed]
 */
export const MODEL_REFERENCE: Readonly<Record<string, ModelReferenceData>> = {
  // ── Image Generation ──
  "nano-banana":       { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },
  "nano-banana-pro":   { provider: "KIE.ai",    providerCostUsd: 0.090, markupPct: 25 },
  "flux":              { provider: "KIE.ai",    providerCostUsd: 0.025, markupPct: 25 },
  "grok":              { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },
  "gpt-image":         { provider: "KIE.ai",    providerCostUsd: 0.040, markupPct: 25 },
  "ideogram-v3":       { provider: "KIE.ai",    providerCostUsd: 0.035, markupPct: 25 },
  // ── Image Editing ──
  "recraft-upscale":   { provider: "KIE.ai",    providerCostUsd: 0.003, markupPct: 25 },
  "recraft-remove-bg": { provider: "KIE.ai",    providerCostUsd: 0,     markupPct: 25 },
  "nano-banana-edit":  { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },
  // ── Image-to-Image ──
  "flux-i2i":          { provider: "KIE.ai",    providerCostUsd: 0.025, markupPct: 25 },
  "flux-pro-i2i":      { provider: "KIE.ai",    providerCostUsd: 0.025, markupPct: 25 },
  "grok-i2i":          { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },
  "gpt-image-i2i":     { provider: "KIE.ai",    providerCostUsd: 0.040, markupPct: 25 },
  // ── Video Generation (I2V / T2V) ──
  "minimax":           { provider: "KIE.ai",    providerCostUsd: 0.040, markupPct: 25 },
  "veo3":              { provider: "KIE.ai",    providerCostUsd: 2.000, markupPct: 25 },
  "veo3.1":            { provider: "KIE.ai",    providerCostUsd: 1.250, markupPct: 25 },
  "kling":             { provider: "KIE.ai",    providerCostUsd: 0.275, markupPct: 25 },
  "kling-turbo":       { provider: "KIE.ai",    providerCostUsd: 0.210, markupPct: 25 },
  "kling-3.0":         { provider: "KIE.ai",    providerCostUsd: 0.500, markupPct: 25 },
  "grok-i2v":          { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },
  "sora2-pro":         { provider: "KIE.ai",    providerCostUsd: 0.750, markupPct: 25 },
  "runway":            { provider: "Replicate", providerCostUsd: null,  markupPct: 10 },
  "pika":              { provider: "Replicate", providerCostUsd: null,  markupPct: 10 },
  "sora":              { provider: "Replicate", providerCostUsd: null,  markupPct: 10 },
  // ── Video-to-Video / Motion ──
  "wan":               { provider: "KIE.ai",    providerCostUsd: 0.350, markupPct: 25 },
  "topaz-video":       { provider: "KIE.ai",    providerCostUsd: null,  markupPct: 25 },
  "motion-transfer":   { provider: "KIE.ai",    providerCostUsd: 0.300, markupPct: 25 },  // 6 cr/sec * 10s default (720p)
  "kling-motion":      { provider: "KIE.ai",    providerCostUsd: 0.300, markupPct: 25 },
  "kling-3.0-motion":  { provider: "KIE.ai",    providerCostUsd: 0.600, markupPct: 25 },  // 12 cr/sec * 10s default (720p)
  // ── Lip Sync ──
  "kling-avatar":      { provider: "KIE.ai",    providerCostUsd: null,  markupPct: 25 },
  "kling-avatar-pro":  { provider: "KIE.ai",    providerCostUsd: null,  markupPct: 25 },
  "hailuo-avatar":     { provider: "KIE.ai",    providerCostUsd: 0.350, markupPct: 25 },
  // ── Audio / TTS / Music ──
  "elevenlabs-turbo":       { provider: "KIE.ai",    providerCostUsd: 0.030, markupPct: 25 },
  "elevenlabs-multilingual": { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "elevenlabs":        { provider: "KIE.ai",    providerCostUsd: 0.030, markupPct: 25 },
  "elevenlabs-sfx":    { provider: "KIE.ai",    providerCostUsd: 0.0012, markupPct: 25 },
  "suno":              { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-v5":           { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-generate":     { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-cover":        { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-extend":       { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-lyrics":       { provider: "KIE.ai",    providerCostUsd: 0.002, markupPct: 25 },
  "suno-separate":       { provider: "KIE.ai",  providerCostUsd: 0.050, markupPct: 25 },
  "suno-separate-stem": { provider: "KIE.ai",   providerCostUsd: 0.250, markupPct: 25 },
  "suno-music-video":  { provider: "KIE.ai",    providerCostUsd: 0.010, markupPct: 25 },
  "suno-mashup":       { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-replace-section": { provider: "KIE.ai", providerCostUsd: 0.030, markupPct: 25 },
  "suno-style-boost":  { provider: "KIE.ai",    providerCostUsd: 0.010, markupPct: 25 },
  "suno-add-instrumental": { provider: "KIE.ai", providerCostUsd: 0.060, markupPct: 25 },
  "suno-add-vocals":   { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "suno-convert-wav":  { provider: "KIE.ai",    providerCostUsd: 0.010, markupPct: 25 },
  "suno-upload-extend": { provider: "KIE.ai",   providerCostUsd: 0.060, markupPct: 25 },
  "infinitalk":        { provider: "KIE.ai",    providerCostUsd: null,  markupPct: 25 },
  // ── Processing ──
  "topaz":             { provider: "KIE.ai",    providerCostUsd: null,  markupPct: 25 },
  "topaz-image-upscale": { provider: "KIE.ai",  providerCostUsd: 0.050, markupPct: 25 },
  "sora-watermark-remove": { provider: "KIE.ai", providerCostUsd: 0.050, markupPct: 25 },
  "speech-to-video":   { provider: "KIE.ai",    providerCostUsd: 0.060, markupPct: 25 },
  "sora-storyboard":   { provider: "KIE.ai",    providerCostUsd: 0.750, markupPct: 25 },
  "ffmpeg":            { provider: "Self",      providerCostUsd: 0,     markupPct: 0  },
  "render-video":      { provider: "Self",      providerCostUsd: 0,     markupPct: 0  },
  "video-composer":    { provider: "Anthropic", providerCostUsd: 0.010, markupPct: 25 },
}
