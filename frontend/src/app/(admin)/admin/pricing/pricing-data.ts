// Static pricing configuration for admin overview
// Subscription tiers, top-ups, FFmpeg, and LLM are hardcoded (don't change per-model).
// AI model pricing (image, video, audio) comes from the model_pricing DB table.

export interface SubscriptionTier {
  readonly name: string
  readonly price: number
  readonly credits: number
  readonly perCredit: number | null
  readonly llmRequests: string
  readonly estimatedCost: number
  readonly margin: number | null
  readonly notes?: string
}

export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  { name: "Free", price: 0, credits: 50, perCredit: null, llmRequests: "20/mo", estimatedCost: 5, margin: null, notes: "10 cr/day, VEO 3 blocked, watermark" },
  { name: "Basic", price: 19, credits: 95, perCredit: 0.20, llmRequests: "100/mo", estimatedCost: 9.6, margin: 49 },
  { name: "Standard", price: 39, credits: 235, perCredit: 0.166, llmRequests: "300/mo", estimatedCost: 23.8, margin: 39 },
  { name: "Pro", price: 79, credits: 530, perCredit: 0.149, llmRequests: "1,000/mo", estimatedCost: 54, margin: 32 },
  { name: "Business", price: 149, credits: 1120, perCredit: 0.133, llmRequests: "Unlimited", estimatedCost: 112, margin: 25 },
] as const

export interface TopUpPackage {
  readonly name: string
  readonly price: number
  readonly credits: number
  readonly perCredit: number
}

export const TOPUP_PACKAGES: readonly TopUpPackage[] = [
  { name: "Small", price: 10, credits: 50, perCredit: 0.20 },
  { name: "Medium", price: 25, credits: 130, perCredit: 0.19 },
  { name: "Large", price: 50, credits: 275, perCredit: 0.18 },
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
  ["image", ["nano", "flux", "grok", "gpt-image", "recraft", "ideogram", "midjourney"]],
  ["video", ["veo", "kling", "minimax", "wan", "sora", "grok-i2v", "runway", "pika", "hailuo", "topaz-video", "motion-transfer"]],
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
export const CREDIT_VALUE_USD = 0.10

/** [comment removed] */
export const SELL_PRICE_PER_CREDIT_MAX = 0.20   // Basic tier
export const SELL_PRICE_PER_CREDIT_MIN = 0.133  // Business tier

/**
 * [comment removed]
 * KIE.ai costs from https://docs.kie.ai pricing tables.
 * Replicate costs are dynamic (predict_time * $0.000225/s) so marked null.
 */
export const MODEL_REFERENCE: Readonly<Record<string, ModelReferenceData>> = {
  // ── Image Generation ──
  "nano-banana":       { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },
  "nano-banana-pro":   { provider: "KIE.ai",    providerCostUsd: 0.025, markupPct: 25 },
  "flux":              { provider: "KIE.ai",    providerCostUsd: 0.030, markupPct: 25 },
  "grok":              { provider: "KIE.ai",    providerCostUsd: 0.030, markupPct: 25 },
  "gpt-image":         { provider: "KIE.ai",    providerCostUsd: 0.040, markupPct: 25 },
  // ── Image Editing ──
  "recraft-upscale":   { provider: "KIE.ai",    providerCostUsd: 0.030, markupPct: 25 },
  "recraft-remove-bg": { provider: "KIE.ai",    providerCostUsd: 0.020, markupPct: 25 },
  "nano-banana-edit":  { provider: "KIE.ai",    providerCostUsd: 0.025, markupPct: 25 },
  // ── Image-to-Image ──
  "flux-i2i":          { provider: "KIE.ai",    providerCostUsd: 0.030, markupPct: 25 },
  "flux-pro-i2i":      { provider: "KIE.ai",    providerCostUsd: 0.040, markupPct: 25 },
  "grok-i2i":          { provider: "KIE.ai",    providerCostUsd: 0.030, markupPct: 25 },
  "gpt-image-i2i":     { provider: "KIE.ai",    providerCostUsd: 0.040, markupPct: 25 },
  // ── Video Generation (I2V / T2V) ──
  "minimax":           { provider: "KIE.ai",    providerCostUsd: 0.400, markupPct: 25 },
  "veo3":              { provider: "KIE.ai",    providerCostUsd: 2.000, markupPct: 25 },
  "veo3.1":            { provider: "KIE.ai",    providerCostUsd: 1.250, markupPct: 25 },
  "kling":             { provider: "KIE.ai",    providerCostUsd: 0.350, markupPct: 25 },
  "kling-turbo":       { provider: "KIE.ai",    providerCostUsd: 0.250, markupPct: 25 },
  "grok-i2v":          { provider: "KIE.ai",    providerCostUsd: 0.300, markupPct: 25 },
  "sora2-pro":         { provider: "KIE.ai",    providerCostUsd: 1.000, markupPct: 25 },
  "runway":            { provider: "Replicate", providerCostUsd: null,  markupPct: 10 },
  "pika":              { provider: "Replicate", providerCostUsd: null,  markupPct: 10 },
  "sora":              { provider: "Replicate", providerCostUsd: null,  markupPct: 10 },
  // ── Video-to-Video / Motion ──
  "wan":               { provider: "KIE.ai",    providerCostUsd: 0.300, markupPct: 25 },
  "topaz-video":       { provider: "KIE.ai",    providerCostUsd: 0.500, markupPct: 25 },
  "motion-transfer":   { provider: "KIE.ai",    providerCostUsd: 0.500, markupPct: 25 },
  // ── Lip Sync ──
  "kling-avatar":      { provider: "KIE.ai",    providerCostUsd: 0.400, markupPct: 25 },
  "hailuo-avatar":     { provider: "KIE.ai",    providerCostUsd: 0.350, markupPct: 25 },
  // ── Audio / TTS / Music ──
  "elevenlabs":        { provider: "Replicate", providerCostUsd: 0.010, markupPct: 10 },
  "suno":              { provider: "KIE.ai",    providerCostUsd: 0.050, markupPct: 25 },
  // ── Processing (FFmpeg — free) ──
  "ffmpeg":            { provider: "Self",      providerCostUsd: 0,     markupPct: 0  },
}
