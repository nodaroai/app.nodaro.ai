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

// Grants and the top-up ladder below are the POST-re-denomination values, taken
// from `TIER_CREDITS` / `TOP_UPS` in `ee/billing/stripe-config.ts` — the numbers
// Stripe actually provisions. This table is display-only (the admin pricing
// reference), which is exactly why it went stale through the 2026-07-30 ×10
// without anything failing: nothing reads it, so nothing broke — it just told
// admins the wrong prices.
//
// Note the top-ups are NOT the old ladder ×10. They were re-rated onto the
// flattened curve (design §4.3), so copy them, never scale them.
export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  { name: "Free", priceMonthly: 0, priceAnnual: 0, credits: 1500, perCredit: null, llmRequests: "20/mo", notes: "One-time credits, 500 cr/day, VEO 3.1 blocked, watermark" },
  { name: "Basic", priceMonthly: 12, priceAnnual: 10, credits: 4500, perCredit: 0.0027, llmRequests: "100/mo" },
  { name: "Standard", priceMonthly: 29, priceAnnual: 24, credits: 11000, perCredit: 0.0026, llmRequests: "300/mo" },
  { name: "Pro", priceMonthly: 59, priceAnnual: 49, credits: 23000, perCredit: 0.0026, llmRequests: "1,000/mo" },
  { name: "Business", priceMonthly: 129, priceAnnual: 109, credits: 52000, perCredit: 0.0025, llmRequests: "Unlimited" },
] as const

export interface TopUpPackage {
  readonly name: string
  readonly price: number
  readonly credits: number
  readonly perCredit: number
}

export const TOPUP_PACKAGES: readonly TopUpPackage[] = [
  { name: "Small", price: 10, credits: 3300, perCredit: 0.0030 },
  { name: "Medium", price: 25, credits: 8500, perCredit: 0.0029 },
  { name: "Large", price: 50, credits: 17500, perCredit: 0.0029 },
  { name: "XL", price: 100, credits: 36000, perCredit: 0.0028 },
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
  // "gemini-omni" (NOT bare "gemini") matches the video SKUs gemini-omni-video
  // and gemini-omni-flash while leaving the Gemini LLM ids alone.
  ["video", ["veo", "kling", "minimax", "wan", "grok-i2v", "runway", "pika", "hailuo", "topaz-video", "motion-transfer", "speech-to-video", "bytedance", "seedance", "gemini-omni", "happyhorse"]],
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
