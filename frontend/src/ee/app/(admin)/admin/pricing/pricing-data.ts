// Static pricing configuration for admin overview
// Subscription tiers, top-ups, and FFmpeg are hardcoded (don't change per-model).
// AI model pricing (image, video, audio) comes from the model_pricing DB table.
// Internal cost/margin figures were intentionally removed ahead of open-sourcing
// and are maintained in internal planning docs only — do not re-add them here.

export interface SubscriptionTier {
  readonly name: string
  readonly priceMonthly: number
  readonly priceAnnual: number
  readonly credits: number
  readonly perCredit: number | null
  readonly llmRequests: string
  readonly notes?: string
}

export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  { name: "Free", priceMonthly: 0, priceAnnual: 0, credits: 150, perCredit: null, llmRequests: "20/mo", notes: "One-time credits, 30 cr/day, VEO 3.1 blocked, watermark" },
  { name: "Basic", priceMonthly: 12, priceAnnual: 10, credits: 250, perCredit: 0.048, llmRequests: "100/mo" },
  { name: "Standard", priceMonthly: 29, priceAnnual: 24, credits: 850, perCredit: 0.034, llmRequests: "300/mo" },
  { name: "Pro", priceMonthly: 59, priceAnnual: 49, credits: 2000, perCredit: 0.030, llmRequests: "1,000/mo" },
  { name: "Business", priceMonthly: 129, priceAnnual: 109, credits: 4800, perCredit: 0.027, llmRequests: "Unlimited" },
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
