/**
 * Paddle Billing Configuration
 *
 * All billing constants: price IDs, tier mappings, credit allocations,
 * storage limits, and free-tier restrictions.
 */

export const PADDLE_PRICES = {
  basic_monthly: process.env.PADDLE_PRICE_BASIC || "pri_01kh3bsqwcvna2shws5ee1fzek",
  standard_monthly: process.env.PADDLE_PRICE_STANDARD || "pri_01kh3btfezxg529x44qknn5h1q",
  pro_monthly: process.env.PADDLE_PRICE_PRO || "pri_01kh3bvg0gjkhnydp175zyzzd6",
  business_monthly: process.env.PADDLE_PRICE_BUSINESS || "pri_01kh3bwnatzcgmj55pxdrkhap7",
  credits_55: process.env.PADDLE_PRICE_CREDITS_55 || "pri_01kh3bxzszyn16c2mzsyyz4105",
  credits_150: process.env.PADDLE_PRICE_CREDITS_150 || "pri_01kh3bympxgkk83md78ey177bt",
  credits_330: process.env.PADDLE_PRICE_CREDITS_330 || "pri_01kh3bz8shkvr7vrq65zpfdfn6",
  credits_700: process.env.PADDLE_PRICE_CREDITS_700 || "pri_01kh3bzr8tq1jbnkg2arkng5n9",
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
  [PADDLE_PRICES.credits_55]: 55,
  [PADDLE_PRICES.credits_150]: 150,
  [PADDLE_PRICES.credits_330]: 330,
  [PADDLE_PRICES.credits_700]: 700,
}

export const TIER_STORAGE_LIMITS: Record<string, number> = {
  free: 1 * 1024 * 1024 * 1024,          // 1 GB
  basic: 10 * 1024 * 1024 * 1024,        // 10 GB
  standard: 25 * 1024 * 1024 * 1024,     // 25 GB
  pro: 50 * 1024 * 1024 * 1024,          // 50 GB
  business: 200 * 1024 * 1024 * 1024,    // 200 GB
  enterprise: 500 * 1024 * 1024 * 1024,  // 500 GB
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
