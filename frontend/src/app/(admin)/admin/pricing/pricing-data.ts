// Static pricing configuration for admin overview
// All costs in USD, credits as integers

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

export type ModelCategory = "video" | "lip-sync" | "image" | "audio" | "llm"

export interface ModelPricing {
  readonly model: string
  readonly variant: string
  readonly provider: "KIE.ai" | "Replicate"
  readonly providerCost: string
  readonly credits: string
  readonly notes?: string
}

export const VIDEO_MODELS: readonly ModelPricing[] = [
  { model: "VEO 3.1", variant: "Quality", provider: "KIE.ai", providerCost: "$1.25", credits: "16" },
  { model: "VEO 3.1", variant: "Fast", provider: "KIE.ai", providerCost: "$0.30", credits: "4" },
  { model: "VEO 3.1", variant: "4K Output", provider: "KIE.ai", providerCost: "$0.60", credits: "8" },
  { model: "Sora 2", variant: "Standard 10s", provider: "KIE.ai", providerCost: "$0.15", credits: "2" },
  { model: "Sora 2", variant: "Standard 15s", provider: "KIE.ai", providerCost: "$0.25", credits: "4" },
  { model: "Sora 2", variant: "Pro Standard 10s", provider: "KIE.ai", providerCost: "$0.65", credits: "9" },
  { model: "Sora 2", variant: "Pro Standard 15s", provider: "KIE.ai", providerCost: "$1.05", credits: "14" },
  { model: "Sora 2", variant: "Pro High 10s", provider: "KIE.ai", providerCost: "$2.10", credits: "27" },
  { model: "Sora 2", variant: "Pro High 15s", provider: "KIE.ai", providerCost: "$3.15", credits: "40", notes: "Most expensive" },
  { model: "Kling 2.6", variant: "5s no audio", provider: "KIE.ai", providerCost: "$0.275", credits: "4" },
  { model: "Kling 2.6", variant: "5s + audio", provider: "KIE.ai", providerCost: "$0.55", credits: "7" },
  { model: "Kling 2.6", variant: "10s no audio", provider: "KIE.ai", providerCost: "$0.55", credits: "7" },
  { model: "Kling 2.6", variant: "10s + audio", provider: "KIE.ai", providerCost: "$1.10", credits: "14" },
  { model: "Kling 2.5 Turbo", variant: "5s", provider: "KIE.ai", providerCost: "$0.21", credits: "3" },
  { model: "Kling 2.5 Turbo", variant: "10s", provider: "KIE.ai", providerCost: "$0.42", credits: "6" },
  { model: "Wan 2.6", variant: "5s 720p", provider: "KIE.ai", providerCost: "$0.35", credits: "5" },
  { model: "Wan 2.6", variant: "5s 1080p", provider: "KIE.ai", providerCost: "$0.525", credits: "7" },
  { model: "Wan 2.6", variant: "10s 720p", provider: "KIE.ai", providerCost: "$0.70", credits: "9" },
  { model: "Wan 2.6", variant: "15s 1080p", provider: "KIE.ai", providerCost: "$1.575", credits: "20" },
  { model: "Runway Aleph", variant: "5s", provider: "KIE.ai", providerCost: "$0.55", credits: "7" },
  { model: "Runway", variant: "5s 720p", provider: "KIE.ai", providerCost: "$0.06", credits: "1", notes: "Cheapest video" },
  { model: "Runway", variant: "10s 720p", provider: "KIE.ai", providerCost: "$0.12", credits: "2" },
  { model: "minimax video-01", variant: "Standard", provider: "KIE.ai", providerCost: "$0.04", credits: "1" },
  { model: "Hailuo", variant: "Standard", provider: "KIE.ai", providerCost: "$0.04", credits: "1" },
  { model: "Topaz Video Upscale", variant: "per second", provider: "KIE.ai", providerCost: "$0.06/sec", credits: "1/sec", notes: "5s=$0.30 (4cr), 10s=$0.60 (8cr)" },
  { model: "Motion Transfer", variant: "Kling 2.6 Motion Control", provider: "KIE.ai", providerCost: "$0.50/job", credits: "7" },
] as const

export const LIP_SYNC_MODELS: readonly ModelPricing[] = [
  { model: "Kling Avatar", variant: "per second", provider: "KIE.ai", providerCost: "$0.04-$0.08/s", credits: "1/sec" },
  { model: "InfiniteTalk", variant: "per second", provider: "KIE.ai", providerCost: "$0.015-$0.06/s", credits: "1/sec" },
] as const

export const IMAGE_MODELS: readonly ModelPricing[] = [
  { model: "Google nano-banana", variant: "Standard", provider: "KIE.ai", providerCost: "$0.02", credits: "1" },
  { model: "FLUX 2 Pro", variant: "Standard", provider: "KIE.ai", providerCost: "$0.025-$0.035", credits: "1" },
  { model: "Ideogram v3", variant: "Standard", provider: "KIE.ai", providerCost: "$0.0175-$0.05", credits: "1" },
  { model: "Midjourney", variant: "Standard", provider: "KIE.ai", providerCost: "$0.015-$0.08", credits: "1" },
  { model: "Topaz Image 2K", variant: "Upscale", provider: "KIE.ai", providerCost: "$0.05", credits: "1" },
  { model: "Topaz Image 4K", variant: "Upscale", provider: "KIE.ai", providerCost: "$0.10", credits: "2" },
  { model: "Topaz Image 8K", variant: "Upscale", provider: "KIE.ai", providerCost: "$0.20", credits: "3" },
  { model: "Recraft Remove BG", variant: "Background removal", provider: "KIE.ai", providerCost: "FREE", credits: "0" },
] as const

export const AUDIO_MODELS: readonly ModelPricing[] = [
  { model: "Suno Generate", variant: "Music generation", provider: "KIE.ai", providerCost: "$0.06", credits: "1" },
  { model: "Suno Extend", variant: "Music extension", provider: "KIE.ai", providerCost: "$0.06", credits: "1" },
  { model: "Suno Vocals", variant: "Vocal generation", provider: "KIE.ai", providerCost: "$0.06", credits: "1" },
  { model: "Suno Multi-Stem", variant: "Stem separation", provider: "KIE.ai", providerCost: "$0.25", credits: "4" },
  { model: "ElevenLabs TTS", variant: "Text to Speech", provider: "KIE.ai", providerCost: "$0.03-$0.07/1K chars", credits: "1" },
] as const

export interface LLMPricing {
  readonly model: string
  readonly inputCost: string
  readonly outputCost: string
  readonly perRequest: string
  readonly notes?: string
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

export interface QuickStat {
  readonly label: string
  readonly value: string
}

export const QUICK_STATS: readonly QuickStat[] = [
  { label: "Cheapest video", value: "Runway 5s 720p = 1 credit" },
  { label: "Most expensive video", value: "Sora 2 Pro High 15s = 40 credits" },
  { label: "Popular range", value: "2-16 credits" },
  { label: "All images", value: "1-3 credits" },
  { label: "FFmpeg nodes", value: "Always free" },
  { label: "Markup", value: "KIE 25% / Replicate 10%" },
  { label: "Credit value", value: "1 credit = $0.10 cost" },
] as const
