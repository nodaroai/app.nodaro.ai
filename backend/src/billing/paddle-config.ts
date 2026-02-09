/**
 * Paddle Billing Configuration
 *
 * All billing constants: price IDs, tier mappings, credit allocations,
 * storage limits, and free-tier restrictions.
 */

export const PADDLE_PRICES = {
  basic_monthly: process.env.PADDLE_PRICE_BASIC || "pri_basic_monthly",
  standard_monthly: process.env.PADDLE_PRICE_STANDARD || "pri_standard_monthly",
  pro_monthly: process.env.PADDLE_PRICE_PRO || "pri_pro_monthly",
  business_monthly: process.env.PADDLE_PRICE_BUSINESS || "pri_business_monthly",
  topup_10: process.env.PADDLE_PRICE_TOPUP_10 || "pri_topup_10",
  topup_25: process.env.PADDLE_PRICE_TOPUP_25 || "pri_topup_25",
  topup_50: process.env.PADDLE_PRICE_TOPUP_50 || "pri_topup_50",
  topup_100: process.env.PADDLE_PRICE_TOPUP_100 || "pri_topup_100",
} as const

export const PRICE_TO_TIER: Record<string, string> = {
  [PADDLE_PRICES.basic_monthly]: "basic",
  [PADDLE_PRICES.standard_monthly]: "standard",
  [PADDLE_PRICES.pro_monthly]: "pro",
  [PADDLE_PRICES.business_monthly]: "business",
}

export const TIER_CREDITS: Record<string, number> = {
  free: 50,
  basic: 95,
  standard: 235,
  pro: 530,
  business: 1120,
}

export const TIER_LLM_LIMITS: Record<string, number> = {
  free: 20,
  basic: 100,
  standard: 300,
  pro: 1000,
  business: Infinity,
}

export const TOPUP_CREDITS: Record<string, number> = {
  [PADDLE_PRICES.topup_10]: 55,
  [PADDLE_PRICES.topup_25]: 150,
  [PADDLE_PRICES.topup_50]: 330,
  [PADDLE_PRICES.topup_100]: 700,
}

export const TIER_STORAGE_LIMITS: Record<string, number> = {
  free: 500 * 1024 * 1024,           // 500 MB
  basic: 5 * 1024 * 1024 * 1024,     // 5 GB
  standard: 15 * 1024 * 1024 * 1024, // 15 GB
  pro: 50 * 1024 * 1024 * 1024,      // 50 GB
  business: 100 * 1024 * 1024 * 1024, // 100 GB
}

export const RETENTION_DAYS = {
  free_media: 60,
  canceled_grace: 60,
} as const

export const FREE_TIER_RESTRICTIONS = {
  dailyCreditCap: 10,
  blockedModels: ["veo-3", "sora-2-pro"],
  watermark: true,
} as const

export function getTierFromPriceId(priceId: string): string {
  return PRICE_TO_TIER[priceId] || "free"
}

export function getTopupCredits(priceId: string): number | null {
  return TOPUP_CREDITS[priceId] || null
}
