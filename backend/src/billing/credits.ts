import { supabase } from "../lib/supabase.js"
import { hasCredits } from "../lib/config.js"
import { FREE_TIER_RESTRICTIONS, TIER_STORAGE_LIMITS } from "./paddle-config.js"

// ============================================================
// Types
// ============================================================

export interface CreditCheckResult {
  allowed: boolean
  error?: string
  balance?: number
  required?: number
  dailyLimit?: number
  dailySpent?: number
  subscriptionCredits?: number
  topupCredits?: number
  watermark?: boolean
}

export interface UserBalance {
  total: number
  subscription: number
  topup: number
  dailySpent: number
  dailyLimit: number | null
  monthlyAllocation: number
  tier: string
  features: Record<string, unknown>
  periodEnd: string | null
}

export interface ReserveResult {
  usageLogId: string
  creditsReserved: number
  watermark: boolean
}

export interface StorageLimitResult {
  allowed: boolean
  error?: string
  usedBytes: number
  limitBytes: number
}

/**
 * Pre-fetched profile shape for checkCreditsWithProfile.
 * Must include credit-related columns.
 */
export interface CreditProfile {
  tier?: string | null
  subscription_tier?: string | null
  subscription_credits?: number | null
  topup_credits?: number | null
  daily_spent_credits?: number | null
  last_daily_reset?: string | null
}

/**
 * Pre-fetched profile shape for checkStorageLimitWithProfile.
 * Must include storage columns + tier for fallback.
 */
export interface StorageProfile {
  tier?: string | null
  storage_used_bytes?: number | null
  storage_limit_bytes?: number | null
}

// ============================================================
// Fallback Static Credit Costs (used when model_pricing table doesn't exist)
// ============================================================

const STATIC_CREDIT_COSTS: Record<string, number> = {
  // 1 credit = $0.02. Formula: ceil(providerCost * 1.25 / 0.02)
  // Base entries = default/cheapest setting. Composite entries = specific setting.
  //
  // ── Image Generation ──
  "nano-banana": 2,              // 4 KIE cr, $0.02
  "nano-banana-pro": 6,          // 18 KIE cr, $0.09 (1K/2K default)
  "nano-banana-pro:4K": 8,       // 24 KIE cr, $0.12
  ***REDACTED-OSS-SCRUB***
  "flux:2K": 3,                  // 7 KIE cr, $0.035
  "grok": 2,                     // 4 KIE cr, $0.02
  "gpt-image": 2,                // 4 KIE cr, $0.02 (medium default)
  "gpt-image:high": 7,           // 22 KIE cr, $0.11
  "imagen4": 3,                  // 8 KIE cr, $0.04
  "imagen4-fast": 2,             // 4 KIE cr, $0.02
  "imagen4-ultra": 4,            // 12 KIE cr, $0.06
  "ideogram": 6,                 // 18 KIE cr, $0.09 (BALANCED default)
  "ideogram:TURBO": 4,           // 12 KIE cr, $0.06
  "ideogram:QUALITY": 8,         // 24 KIE cr, $0.12
  "qwen": 2,                     // 4 KIE cr, $0.02
  "seedream": 3,                 // 6.5 KIE cr, $0.032
  "flux-flex": 5,                // 14 KIE cr, $0.07 (1K default)
  "flux-flex:2K": 8,             // 24 KIE cr, $0.12
  ***REDACTED-OSS-SCRUB***
  // ── Image Editing ──
  "recraft-upscale": 2,          // 6 KIE cr, $0.03
  "recraft-remove-bg": 0,
  "nano-banana-edit": 2,         // 6 KIE cr, $0.03
  "topaz-image-upscale": 2,      // 6 KIE cr, $0.03
  "grok-upscale": 2,             // 4 KIE cr, $0.02
  // ── Image-to-Image ──
  "flux-i2i": 5,                 // 14 KIE cr, $0.07 (1K default)
  "flux-i2i:2K": 8,              // 24 KIE cr, $0.12
  ***REDACTED-OSS-SCRUB***
  "flux-pro-i2i:2K": 3,          // 7 KIE cr, $0.035
  "grok-i2i": 2,                 // 4 KIE cr, $0.02
  "gpt-image-i2i": 2,            // 4 KIE cr, $0.02 (medium default)
  "gpt-image-i2i:high": 7,       // 22 KIE cr, $0.11
  "ideogram-edit": 6,            // 18 KIE cr, $0.09 (BALANCED default)
  "ideogram-edit:TURBO": 4,      // 12 KIE cr, $0.06
  "ideogram-edit:QUALITY": 8,    // 24 KIE cr, $0.12
  "ideogram-remix": 6,           // 18 KIE cr, $0.09 (BALANCED default)
  "ideogram-remix:TURBO": 4,     // 12 KIE cr, $0.06
  "ideogram-remix:QUALITY": 8,   // 24 KIE cr, $0.12
  "ideogram-reframe": 6,         // 18 KIE cr, $0.09 (BALANCED default)
  "ideogram-reframe:TURBO": 4,   // 12 KIE cr, $0.06
  "ideogram-reframe:QUALITY": 8, // 24 KIE cr, $0.12
  "qwen-i2i": 2,                 // 4 KIE cr, $0.02
  "qwen-edit": 2,                // 4 KIE cr, $0.02
  "seedream-edit": 3,            // 6.5 KIE cr, $0.032
  // ── Video Generation (I2V / T2V) ──
  "minimax": 25,                 // 80 KIE cr, $0.40
  "veo3": 125,                   // 400 KIE cr, $2.00
  "veo3.1": 79,                  // 250 KIE cr, $1.25
  "kling": 22,                   // 70 KIE cr, $0.35
  "kling-turbo": 16,             // 50 KIE cr, $0.25
  "kling-3.0": 32,               // $0.50
  "grok-i2v": 19,                // 60 KIE cr, $0.30
  "sora2-pro": 63,               // 200 KIE cr, $1.00
  // ── Video-to-Video / Motion ──
  "wan": 25,                     // 80 KIE cr, $0.40
  "topaz-video": 0,
  "motion-transfer": 32,         // 100 KIE cr, $0.50
  "kling-motion": 0,
  // ── Lip Sync ──
  "kling-avatar": 13,            // 40 KIE cr, $0.20
  "kling-avatar-pro": 19,        // 60 KIE cr, $0.30
  "hailuo-avatar": 19,           // ~$0.30 estimated
  // ── Audio / TTS / Music ──
  "elevenlabs-turbo": 4,         // 10 KIE cr flat, $0.05
  "elevenlabs-multilingual": 4,  // 10 KIE cr flat, $0.05
  "elevenlabs": 4,               // alias for turbo
  "elevenlabs-sfx": 4,           // 10 KIE cr flat, $0.05
  "suno": 7,                     // 20 KIE cr, $0.10
  "suno-v5": 13,                 // 40 KIE cr, $0.20
  "suno-generate": 7,            // ~20 KIE cr
  "suno-cover": 7,               // ~20 KIE cr
  "suno-extend": 7,              // ~20 KIE cr
  "suno-lyrics": 2,              // cheap text-only
  "suno-separate": 5,            // vocal separation
  "suno-separate-stem": 10,      // full stem separation
  "suno-music-video": 5,
  "elevenlabs-isolation": 1,     // 1 KIE cr, $0.005
  "infinitalk": 19,              // 60 KIE cr, $0.30
  // ── Processing ──
  "topaz": 0,
  "ffmpeg": 0,
  "render-video": 15,            // Remotion compute
  // ── Replicate (dynamic per-second) ──
  "runway": 0,
  "pika": 0,
  "sora": 0,
  // ── LLM ──
  "ai-writer": 5,                // Claude Sonnet
  "scene-graph-ai": 10,          // Claude Sonnet
  "video-composer": 10,          // Claude Sonnet
  "after-effects": 10,           // Claude Sonnet
  "lottie-overlay": 10,          // Claude Sonnet
  "3d-title": 15,                // Claude Sonnet
  "motion-graphics": 10,         // Claude Sonnet
  "composite": 0,
  // ── Node types (legacy fallback for workflow estimation) ──
  "generate-script": 10,
  "generate-image": 2,
  "image-to-video": 20,
  "video-to-video": 25,
  "text-to-video": 20,
  "text-to-speech": 4,
  "qa-check": 5,
  "combine-videos": 0,
  "merge-video-audio": 0,
  "add-captions": 0,
  "resize-video": 0,
  "extract-audio": 0,
  "mix-audio": 0,
  "adjust-volume": 0,
  "trim-video": 0,
  "speed-ramp": 0,
  "loop-video": 0,
  "fade-video": 0,
  "generate-music": 7,
  "text-to-audio": 4,
  "audio-isolation": 1,
  "image-to-text": 5,
}

// Tier order for restriction checks
const TIER_ORDER = ["free", "basic", "standard", "pro", "business"]

// ============================================================
// Helper Functions
// ============================================================

/**
 * Check if credit system is disabled (community or business edition)
 */
function creditsDisabled(): boolean {
  return !hasCredits()
}

/**
 * Resolve the user's tier from profile, checking both `tier` and `subscription_tier`
 * columns for backward compatibility.
 */
function resolveTier(profile: Record<string, unknown>): string {
  return (profile.tier as string) ?? (profile.subscription_tier as string) ?? "free"
}

/**
 * Check if daily_spent_credits needs resetting (new UTC day).
 * Returns the effective daily spent value (0 if reset needed).
 * Uses atomic RPC with FOR UPDATE lock to prevent race conditions at midnight.
 */
async function getEffectiveDailySpent(
  userId: string,
  currentDailySpent: number,
  lastReset: string | null
): Promise<number> {
  const todayUTC = new Date().toISOString().slice(0, 10)
  const lastResetDay = lastReset ? lastReset.slice(0, 10) : null

  if (lastResetDay !== todayUTC) {
    // Atomic reset via RPC (FOR UPDATE lock prevents race at midnight)
    const { data, error } = await supabase.rpc("reset_daily_spent_if_needed", {
      p_user_id: userId,
    })
    if (!error && data !== null && data !== undefined) {
      return data as number
    }
    // Fallback: non-atomic reset if RPC not available
    await supabase
      .from("profiles")
      .update({
        daily_spent_credits: 0,
        last_daily_reset: new Date().toISOString().slice(0, 10),
      })
      .eq("id", userId)
    return 0
  }

  return currentDailySpent
}

// ============================================================
// TTL Cache — reusable map with time-based expiration
// ============================================================

class TtlCache<T> {
  private readonly entries = new Map<string, T>()
  private expiresAt = 0

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    if (Date.now() >= this.expiresAt) {
      this.entries.clear()
      return undefined
    }
    return this.entries.get(key)
  }

  set(key: string, value: T): void {
    if (Date.now() >= this.expiresAt) {
      this.entries.clear()
      this.expiresAt = Date.now() + this.ttlMs
    }
    this.entries.set(key, value)
  }

  invalidate(): void {
    this.entries.clear()
    this.expiresAt = 0
  }
}

// ── Model pricing cache (60s TTL) ──

interface ModelPricing {
  creditCost: number
  isEnabled: boolean
  tierRestriction: string | null
}

const modelPricingCache = new TtlCache<ModelPricing>(60_000)

/**
 * Invalidate the model pricing cache (e.g. after admin updates model_pricing table)
 */
export function invalidateModelPricingCache(): void {
  modelPricingCache.invalidate()
}

/**
 * Get credit cost for a model from database, falling back to static costs.
 * Results are cached for 60s to avoid repeated DB queries.
 */
async function getModelCreditCostFromDB(modelIdentifier: string): Promise<ModelPricing> {
  const cached = modelPricingCache.get(modelIdentifier)
  if (cached) return cached

  const { data, error } = await supabase
    .from("model_pricing")
    .select("credit_cost, is_enabled, tier_restriction")
    .eq("model_identifier", modelIdentifier)
    .single()

  const result: ModelPricing = (error || !data)
    ? { creditCost: STATIC_CREDIT_COSTS[modelIdentifier] ?? 0, isEnabled: true, tierRestriction: null }
    : { creditCost: data.credit_cost, isEnabled: data.is_enabled, tierRestriction: data.tier_restriction }

  modelPricingCache.set(modelIdentifier, result)
  return result
}

// ── Tier config cache (60s TTL) ──

interface TierConfig {
  daily_credit_limit: number | null
  monthly_credits: number | null
  features: Record<string, unknown> | null
}

const tierConfigCache = new TtlCache<TierConfig>(60_000)

async function getTierConfig(tier: string): Promise<TierConfig> {
  const cached = tierConfigCache.get(tier)
  if (cached) return cached

  const { data } = await supabase
    .from("tier_config")
    .select("daily_credit_limit, monthly_credits, features")
    .eq("tier", tier)
    .single()

  const result: TierConfig = {
    daily_credit_limit: data?.daily_credit_limit ?? null,
    monthly_credits: data?.monthly_credits ?? null,
    features: (data?.features as Record<string, unknown>) ?? null,
  }

  tierConfigCache.set(tier, result)
  return result
}

// ============================================================
// Credits Service
// ============================================================

export class CreditsService {
  /**
   * Log a credit transaction (never throws -- errors are logged silently)
   */
  static async logTransaction(params: {
    userId: string
    amount: number
    creditType: "subscription" | "topup"
    source: "subscription_created" | "subscription_renewal" | "one_time_purchase" | "admin_adjustment" | "usage" | "refund" | "paddle_refund" | "expiry"
    description?: string
    jobId?: string
    paddleTransactionId?: string
    adminUserId?: string
    balanceAfter: number
  }): Promise<boolean> {
    try {
      const { error } = await supabase
        .from("credit_transactions")
        .insert({
          user_id: params.userId,
          amount: params.amount,
          credit_type: params.creditType,
          source: params.source,
          description: params.description || null,
          job_id: params.jobId || null,
          paddle_transaction_id: params.paddleTransactionId || null,
          admin_user_id: params.adminUserId || null,
          balance_after: params.balanceAfter,
        })
      if (error) {
        console.error("[credits] Failed to log transaction:", error)
        return false
      }
      return true
    } catch (err) {
      console.error("[credits] Failed to log transaction:", err)
      return false
    }
  }

  /**
   * Admin: adjust a user's credits (add or remove)
   */
  static async adminAdjustCredits(params: {
    userId: string
    amount: number
    creditType: "subscription" | "topup"
    description: string
    adminUserId: string
  }): Promise<{ newBalance: number }> {
    if (creditsDisabled()) {
      return { newBalance: 999999 }
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("subscription_credits, topup_credits")
      .eq("id", params.userId)
      .single()

    if (profileError || !profile) {
      throw new Error("User profile not found")
    }

    const field = params.creditType === "subscription" ? "subscription_credits" : "topup_credits"
    const currentValue = ((profile as Record<string, unknown>)[field] ?? 0) as number
    const newValue = Math.max(0, currentValue + params.amount)

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ [field]: newValue })
      .eq("id", params.userId)

    if (updateError) {
      throw new Error(`Failed to update credits: ${updateError.message}`)
    }

    const newTotal = params.creditType === "subscription"
      ? newValue + (profile.topup_credits ?? 0)
      : (profile.subscription_credits ?? 0) + newValue

    await CreditsService.logTransaction({
      userId: params.userId,
      amount: params.amount,
      creditType: params.creditType,
      source: "admin_adjustment",
      description: params.description,
      adminUserId: params.adminUserId,
      balanceAfter: newTotal,
    })

    return { newBalance: newTotal }
  }

  /**
   * Check if user has sufficient credits (read-only check).
   * Enforces free tier restrictions: blocked models, daily credit cap.
   * Returns allowed: true for self-hosted mode.
   */
  static async checkCredits(
    userId: string,
    modelIdentifier: string
  ): Promise<CreditCheckResult> {
    // Self-hosted: always allow
    if (creditsDisabled()) {
      return { allowed: true, balance: 999999, watermark: false }
    }

    // Get user's profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, subscription_credits, topup_credits, daily_spent_credits, last_daily_reset")
      .eq("id", userId)
      .single()

    if (profileError || !profile) {
      return {
        allowed: false,
        error: "User profile not found",
      }
    }

    return CreditsService.checkCreditsWithProfile(userId, profile as CreditProfile, modelIdentifier)
  }

  /**
   * Check credits using a pre-fetched profile (avoids extra DB query).
   * The profile must include: tier, subscription_tier, subscription_credits,
   * topup_credits, daily_spent_credits, last_daily_reset.
   */
  static async checkCreditsWithProfile(
    userId: string,
    profile: CreditProfile,
    modelIdentifier: string
  ): Promise<CreditCheckResult> {
    if (creditsDisabled()) {
      return { allowed: true, balance: 999999, watermark: false }
    }

    // Get model pricing
    const pricing = await getModelCreditCostFromDB(modelIdentifier)

    if (!pricing.isEnabled) {
      return {
        allowed: false,
        error: "This model is currently disabled",
      }
    }

    const userTier = resolveTier(profile as Record<string, unknown>)
    const isFree = userTier === "free"
    const watermark = isFree && FREE_TIER_RESTRICTIONS.watermark

    // Check tier restriction (from model_pricing table)
    if (pricing.tierRestriction) {
      const userTierIndex = TIER_ORDER.indexOf(userTier)
      const requiredTierIndex = TIER_ORDER.indexOf(pricing.tierRestriction)

      if (userTierIndex < requiredTierIndex) {
        return {
          allowed: false,
          error: `This model requires ${pricing.tierRestriction} tier or higher. Please upgrade your plan.`,
          watermark,
        }
      }
    }

    // Free tier: blocked models
    if (isFree) {
      const blockedModels = FREE_TIER_RESTRICTIONS.blockedModels as readonly string[]
      if (blockedModels.includes(modelIdentifier)) {
        return {
          allowed: false,
          error: "This model requires a paid subscription. Upgrade to Basic or higher.",
          watermark,
        }
      }
    }

    // Calculate total balance
    const subscriptionCredits = profile.subscription_credits ?? 0
    const topupCredits = profile.topup_credits ?? 0
    const totalBalance = subscriptionCredits + topupCredits

    // Check if user has enough credits
    if (totalBalance < pricing.creditCost) {
      return {
        allowed: false,
        error: `Insufficient credits. Required: ${pricing.creditCost}, Available: ${totalBalance}`,
        balance: totalBalance,
        required: pricing.creditCost,
        subscriptionCredits,
        topupCredits,
        watermark,
      }
    }

    // Free tier: daily credit cap
    if (isFree) {
      const dailyCap = FREE_TIER_RESTRICTIONS.dailyCreditCap
      const dailySpent = await getEffectiveDailySpent(
        userId,
        profile.daily_spent_credits ?? 0,
        profile.last_daily_reset ?? null
      )

      if (dailySpent + pricing.creditCost > dailyCap) {
        return {
          allowed: false,
          error: `Daily credit limit reached for free tier. Limit: ${dailyCap}, Spent today: ${dailySpent}. Upgrade for higher limits.`,
          balance: totalBalance,
          required: pricing.creditCost,
          dailyLimit: dailyCap,
          dailySpent,
          watermark,
        }
      }

      return {
        allowed: true,
        balance: totalBalance,
        required: pricing.creditCost,
        subscriptionCredits,
        topupCredits,
        dailyLimit: dailyCap,
        dailySpent,
        watermark,
      }
    }

    // Paid tiers: check daily limit from tier_config if configured
    const tierConfig = await getTierConfig(userTier)
    const dailyLimit = tierConfig.daily_credit_limit ?? undefined
    const dailySpent = profile.daily_spent_credits ?? 0

    if (dailyLimit !== undefined && dailySpent + pricing.creditCost > dailyLimit) {
      return {
        allowed: false,
        error: `Daily credit limit reached. Limit: ${dailyLimit}, Spent: ${dailySpent}`,
        balance: totalBalance,
        required: pricing.creditCost,
        dailyLimit,
        dailySpent,
        watermark,
      }
    }

    return {
      allowed: true,
      balance: totalBalance,
      required: pricing.creditCost,
      subscriptionCredits,
      topupCredits,
      dailyLimit,
      dailySpent,
      watermark,
    }
  }

  /**
   * Reserve credits atomically using reserve_credits RPC.
   * Single RPC call: deducts credits (subscription first, then topup),
   * increments daily_spent, and creates usage_log — all in one transaction.
   */
  static async reserveCredits(
    userId: string,
    jobId: string,
    modelIdentifier: string,
    providerCostUsd: number,
    displayCostUsd: number,
    watermarkOverride?: boolean,
  ): Promise<ReserveResult> {
    // Self-hosted: skip reservation
    if (creditsDisabled()) {
      return { usageLogId: "self-hosted-skip", creditsReserved: 0, watermark: false }
    }

    // Get credit cost for this model (cached)
    const pricing = await getModelCreditCostFromDB(modelIdentifier)

    // Determine watermark: use override from creditGuard if available, otherwise query
    let watermark: boolean
    if (watermarkOverride !== undefined) {
      watermark = watermarkOverride
    } else {
      const { data: tierProfile } = await supabase
        .from("profiles")
        .select("tier, subscription_tier")
        .eq("id", userId)
        .single()

      const userTier = tierProfile ? resolveTier(tierProfile as Record<string, unknown>) : "free"
      watermark = userTier === "free" && FREE_TIER_RESTRICTIONS.watermark
    }

    // Skip deduction for zero-cost models
    if (pricing.creditCost === 0) {
      const { data: usageLog } = await supabase
        .from("usage_logs")
        .insert({
          user_id: userId,
          job_id: jobId,
          action: modelIdentifier,
          provider: "reserved",
          credits_used: 0,
          cost_usd: providerCostUsd,
          metadata: { status: "reserved", display_cost_usd: displayCostUsd },
        })
        .select("id")
        .single()

      return {
        usageLogId: usageLog?.id ?? "log-failed",
        creditsReserved: 0,
        watermark,
      }
    }

    // Atomic reservation via single RPC (deducts credits + increments daily spent + creates usage log)
    const { data: usageLogId, error: reserveError } = await supabase.rpc("reserve_credits", {
      p_user_id: userId,
      p_credits: pricing.creditCost,
      p_job_id: jobId,
      p_model_identifier: modelIdentifier,
      p_provider_cost_usd: providerCostUsd,
      p_display_cost_usd: displayCostUsd,
    })

    if (reserveError) {
      console.error("[credits] reserve_credits RPC failed:", reserveError.message)
      throw new Error(`Credit reservation failed: ${reserveError.message}`)
    }

    if (!usageLogId) {
      console.error("[credits] reserve_credits returned null usage log ID")
      return { usageLogId: "log-failed", creditsReserved: pricing.creditCost, watermark }
    }

    // Fetch usage_log metadata (from_sub/from_topup) for accurate creditType,
    // and current user balance for accurate balanceAfter (C3 + H6 fix)
    let creditType: "subscription" | "topup" = "subscription"
    let balanceAfter = 0
    try {
      const [{ data: usageLog }, { data: balanceProfile }] = await Promise.all([
        supabase
          .from("usage_logs")
          .select("metadata")
          .eq("id", usageLogId)
          .single(),
        supabase
          .from("profiles")
          .select("subscription_credits, topup_credits")
          .eq("id", userId)
          .single(),
      ])
      const meta = usageLog?.metadata as Record<string, unknown> | null
      const fromSub = (meta?.from_sub as number) ?? 0
      const fromTopup = (meta?.from_topup as number) ?? 0
      if (fromTopup > 0 && fromSub === 0) {
        creditType = "topup"
      }
      if (balanceProfile) {
        balanceAfter = (balanceProfile.subscription_credits ?? 0) + (balanceProfile.topup_credits ?? 0)
      }
    } catch {
      // Non-critical: fall back to defaults if fetch fails
    }

    // Log credit transaction
    await CreditsService.logTransaction({
      userId,
      amount: -pricing.creditCost,
      creditType,
      source: "usage",
      description: `Job ${jobId}: ${modelIdentifier}`,
      jobId,
      balanceAfter,
    })

    return { usageLogId: usageLogId as string, creditsReserved: pricing.creditCost, watermark }
  }

  /**
   * Commit reserved credits after job success
   * Updates usage_log status to 'committed'
   */
  static async commitCredits(
    usageLogId: string,
    actualCredits?: number
  ): Promise<void> {
    if (creditsDisabled() || usageLogId === "self-hosted-skip") return

    // Try RPC first
    const { error: rpcError } = await supabase.rpc("commit_credits", {
      p_usage_log_id: usageLogId,
      p_actual_credits: actualCredits,
    })

    if (!rpcError) return

    // Fallback: manual commit
    console.warn("[credits] commit_credits RPC not found, using fallback")

    const { error } = await supabase
      .from("usage_logs")
      .update({
        metadata: { status: "committed" },
      })
      .eq("id", usageLogId)

    if (error) {
      console.error("[credits] Failed to commit credits:", error)
    }
  }

  /**
   * Refund reserved credits after job failure
   * Updates usage_log status to 'refunded' and restores credits
   */
  static async refundCredits(usageLogId: string): Promise<void> {
    if (creditsDisabled() || usageLogId === "self-hosted-skip") return

    // Try RPC first
    const { error: rpcError } = await supabase.rpc("refund_credits", {
      p_usage_log_id: usageLogId,
    })

    if (!rpcError) return

    // Fallback: manual refund
    console.warn("[credits] refund_credits RPC not found, using fallback")

    // Get the usage log to find credits to refund
    const { data: usageLog, error: logError } = await supabase
      .from("usage_logs")
      .select("user_id, job_id, credits_used, metadata")
      .eq("id", usageLogId)
      .single()

    if (logError || !usageLog) {
      console.error("[credits] Usage log not found for refund:", usageLogId)
      return
    }

    // Check if already refunded
    if ((usageLog.metadata as Record<string, unknown>)?.status === "refunded") {
      console.warn("[credits] Credits already refunded for:", usageLogId)
      return
    }

    // Restore credits to the original pools based on metadata from reserve_credits RPC
    const meta = usageLog.metadata as Record<string, unknown> | null
    const fromSub = (meta?.from_sub as number) ?? 0
    const fromTopup = (meta?.from_topup as number) ?? 0

    // Restore subscription credits if any were deducted from that pool
    if (fromSub > 0) {
      const { error: subError } = await supabase.rpc("add_subscription_credits", {
        p_user_id: usageLog.user_id,
        p_credits: fromSub,
      })
      if (subError) {
        console.error("[credits] add_subscription_credits RPC failed for refund:", usageLogId, subError.message)
      }
    }

    // Restore topup credits if any were deducted from that pool
    if (fromTopup > 0) {
      const { error: topupError } = await supabase.rpc("add_topup_credits", {
        p_user_id: usageLog.user_id,
        p_credits: fromTopup,
      })
      if (topupError) {
        console.error("[credits] add_topup_credits RPC failed for refund:", usageLogId, topupError.message)
      }
    }

    // Fallback: if metadata didn't record pool split, restore all to topup
    if (fromSub === 0 && fromTopup === 0 && usageLog.credits_used > 0) {
      const { error: fallbackError } = await supabase.rpc("add_topup_credits", {
        p_user_id: usageLog.user_id,
        p_credits: usageLog.credits_used,
      })
      if (fallbackError) {
        console.error("[credits] Fallback add_topup_credits RPC failed:", usageLogId, fallbackError.message)
      }
    }

    // Determine creditType for transaction log based on which pool was dominant
    const refundCreditType: "subscription" | "topup" =
      fromSub > 0 && fromTopup === 0 ? "subscription" : "topup"

    await CreditsService.logTransaction({
      userId: usageLog.user_id,
      amount: usageLog.credits_used,
      creditType: refundCreditType,
      source: "refund",
      description: "Refund for failed job",
      jobId: usageLog.job_id ?? undefined,
      balanceAfter: 0,
    })

    // Mark as refunded
    await supabase
      .from("usage_logs")
      .update({
        metadata: { status: "refunded" },
      })
      .eq("id", usageLogId)
  }

  /**
   * Check if user is within their storage limit.
   * Returns allowed: true for self-hosted mode.
   */
  static async checkStorageLimit(userId: string): Promise<StorageLimitResult> {
    if (creditsDisabled()) {
      return { allowed: true, usedBytes: 0, limitBytes: Number.MAX_SAFE_INTEGER }
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("tier, storage_used_bytes, storage_limit_bytes")
      .eq("id", userId)
      .single()

    if (error || !profile) {
      return { allowed: false, error: "User profile not found", usedBytes: 0, limitBytes: 0 }
    }

    return CreditsService.checkStorageLimitWithProfile(profile as StorageProfile)
  }

  /**
   * Check storage limit using a pre-fetched profile (avoids extra DB query).
   * The profile must include: storage_used_bytes, storage_limit_bytes.
   */
  static checkStorageLimitWithProfile(profile: StorageProfile): StorageLimitResult {
    if (creditsDisabled()) {
      return { allowed: true, usedBytes: 0, limitBytes: Number.MAX_SAFE_INTEGER }
    }

    const usedBytes = profile.storage_used_bytes ?? 0
    const tier = (profile.tier as string) ?? "free"
    const dbLimit = profile.storage_limit_bytes ?? 0
    const tierLimit = TIER_STORAGE_LIMITS[tier] ?? TIER_STORAGE_LIMITS.free
    // Use tier-based limit when DB has no value or the stale 500MB default (524288000)
    const limitBytes = dbLimit > 0 && dbLimit !== 524288000 ? dbLimit : tierLimit

    if (usedBytes >= limitBytes) {
      const usedGB = (usedBytes / (1024 * 1024 * 1024)).toFixed(1)
      const limitGB = (limitBytes / (1024 * 1024 * 1024)).toFixed(1)
      return {
        allowed: false,
        error: `Storage limit reached (${usedGB} GB of ${limitGB} GB used). Delete files or upgrade your plan.`,
        usedBytes,
        limitBytes,
      }
    }

    return { allowed: true, usedBytes, limitBytes }
  }

  /**
   * Get user's current balance and tier info
   */
  static async getBalance(userId: string): Promise<UserBalance> {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select(`
        subscription_credits,
        topup_credits,
        tier,
        subscription_tier,
        daily_spent_credits,
        last_daily_reset,
        current_period_end
      `)
      .eq("id", userId)
      .single()

    if (error || !profile) {
      // Return default values if profile not found
      return {
        total: 0,
        subscription: 0,
        topup: 0,
        dailySpent: 0,
        dailyLimit: null,
        monthlyAllocation: 0,
        tier: "free",
        features: {},
        periodEnd: null,
      }
    }

    const userTier = resolveTier(profile as Record<string, unknown>)

    // Get tier configuration (cached)
    const tierConfig = await getTierConfig(userTier)

    const subscriptionCredits = profile.subscription_credits ?? 0
    const topupCredits = profile.topup_credits ?? 0

    // For free tier, use FREE_TIER_RESTRICTIONS.dailyCreditCap
    const dailyLimit = userTier === "free"
      ? FREE_TIER_RESTRICTIONS.dailyCreditCap
      : (tierConfig.daily_credit_limit ?? null)

    return {
      total: subscriptionCredits + topupCredits,
      subscription: subscriptionCredits,
      topup: topupCredits,
      dailySpent: profile.daily_spent_credits ?? 0,
      dailyLimit,
      monthlyAllocation: tierConfig.monthly_credits ?? 0,
      tier: userTier,
      features: (tierConfig.features as Record<string, unknown>) ?? {},
      periodEnd: profile.current_period_end ?? null,
    }
  }

  /**
   * Get credit cost for a specific model
   */
  static async getModelCreditCost(modelIdentifier: string): Promise<number> {
    const pricing = await getModelCreditCostFromDB(modelIdentifier)
    return pricing.creditCost
  }

  /**
   * Estimate credits for a workflow (legacy function for backward compatibility)
   */
  static estimateWorkflowCredits(nodes: ReadonlyArray<{ type: string }>): number {
    return nodes.reduce((sum, node) => sum + (STATIC_CREDIT_COSTS[node.type] ?? 0), 0)
  }
}

// Export legacy function for backward compatibility
export function estimateWorkflowCredits(nodes: ReadonlyArray<{ type: string }>): number {
  return CreditsService.estimateWorkflowCredits(nodes)
}
