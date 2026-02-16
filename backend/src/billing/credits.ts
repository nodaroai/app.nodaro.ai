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
 * Must include storage columns.
 */
export interface StorageProfile {
  storage_used_bytes?: number | null
  storage_limit_bytes?: number | null
}

// ============================================================
// Fallback Static Credit Costs (used when model_pricing table doesn't exist)
// ============================================================

const STATIC_CREDIT_COSTS: Record<string, number> = {
  // ── Image Generation ── (formula: ceil(providerCost * 1.25 / 0.10))
  "nano-banana": 1,
  "nano-banana-pro": 2,
  "flux": 1,
  "grok": 1,
  "gpt-image": 1,
  // ── Image Editing ──
  "recraft-upscale": 1,
  "recraft-remove-bg": 0,
  "nano-banana-edit": 1,
  // ── Image-to-Image ──
  "flux-i2i": 1,
  "flux-pro-i2i": 1,
  "grok-i2i": 1,
  "gpt-image-i2i": 1,
  // ── Video Generation (I2V / T2V) ──
  "minimax": 1,
  "veo3": 25,
  "veo3.1": 16,
  "kling": 4,
  "kling-turbo": 3,
  "kling-3.0": 10,
  "grok-i2v": 1,
  "sora2-pro": 10,
  // ── Video-to-Video / Motion ──
  "wan": 5,
  "topaz-video": 0,
  "motion-transfer": 7,
  "kling-motion": 0,
  // ── Lip Sync ──
  "kling-avatar": 0,
  "kling-avatar-pro": 0,
  "hailuo-avatar": 5,
  // ── Audio / TTS / Music ──
  "elevenlabs-turbo": 1,
  "elevenlabs-multilingual": 1,
  "elevenlabs": 1,
  "elevenlabs-sfx": 1,
  "suno": 1,
  "suno-v5": 1,
  "suno-generate": 3,
  "suno-cover": 3,
  "suno-extend": 3,
  "suno-lyrics": 1,
  "suno-separate": 2,
  "suno-separate-stem": 4,
  "suno-music-video": 1,
  "infinitalk": 0,
  // ── Processing ──
  "topaz": 0,
  "ffmpeg": 0,
  // ── Replicate (dynamic per-second) ──
  "runway": 0,
  "pika": 0,
  "sora": 0,
  // ── LLM ──
  "ai-writer": 1,
  // ── Node types (legacy fallback for workflow estimation) ──
  "generate-script": 2,
  "generate-image": 1,
  "image-to-video": 4,
  "video-to-video": 5,
  "text-to-video": 4,
  "text-to-speech": 1,
  "qa-check": 1,
  "combine-videos": 0,
  "merge-video-audio": 0,
  "add-captions": 0,
  "resize-video": 0,
  "extract-audio": 0,
  "mix-audio": 0,
  "adjust-volume": 0,
  "trim-video": 0,
  "generate-music": 1,
  "text-to-audio": 1,
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
 */
async function getEffectiveDailySpent(
  userId: string,
  currentDailySpent: number,
  lastReset: string | null
): Promise<number> {
  const todayUTC = new Date().toISOString().slice(0, 10)
  const lastResetDay = lastReset ? lastReset.slice(0, 10) : null

  if (lastResetDay !== todayUTC) {
    // Reset daily counter
    await supabase
      .from("profiles")
      .update({
        daily_spent_credits: 0,
        last_daily_reset: new Date().toISOString(),
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
  private static async logTransaction(params: {
    userId: string
    amount: number
    creditType: "subscription" | "topup"
    source: "subscription_renewal" | "one_time_purchase" | "admin_adjustment" | "usage" | "refund" | "paddle_refund" | "expiry"
    description?: string
    jobId?: string
    paddleTransactionId?: string
    adminUserId?: string
    balanceAfter: number
  }): Promise<void> {
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
      }
    } catch (err) {
      console.error("[credits] Failed to log transaction:", err)
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
   * Reserve credits atomically using deduct_credits RPC.
   * Uses FOR UPDATE row lock in the RPC to prevent race conditions.
   * Deducts from subscription_credits first, then topup_credits.
   * Creates a usage_log entry with status 'reserved'.
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

    // Atomic deduction via RPC (FOR UPDATE row lock, subscription-first)
    const { data: deductResult, error: deductError } = await supabase.rpc("deduct_credits", {
      p_user_id: userId,
      p_amount: pricing.creditCost,
    })

    if (deductError) {
      console.error("[credits] deduct_credits RPC failed:", deductError.message)
      throw new Error(`Credit deduction failed: ${deductError.message}`)
    }

    if (deductResult === false) {
      throw new Error(`Insufficient credits: need ${pricing.creditCost}`)
    }

    // Increment daily spent counter
    const { error: dailyError } = await supabase.rpc("increment_daily_spent", {
      p_user_id: userId,
      p_amount: pricing.creditCost,
    })

    if (dailyError) {
      // Fallback: direct update if RPC doesn't exist
      const { data: p } = await supabase
        .from("profiles")
        .select("daily_spent_credits")
        .eq("id", userId)
        .single()

      if (p) {
        await supabase
          .from("profiles")
          .update({ daily_spent_credits: (p.daily_spent_credits ?? 0) + pricing.creditCost })
          .eq("id", userId)
      }
    }

    // Log credit transaction (balanceAfter=0 — exact post-deduction balance not tracked to avoid extra query)
    await CreditsService.logTransaction({
      userId,
      amount: -pricing.creditCost,
      creditType: "subscription",
      source: "usage",
      description: `Job ${jobId}: ${modelIdentifier}`,
      jobId,
      balanceAfter: 0,
    })

    // Create usage log entry
    const { data: usageLog, error: logError } = await supabase
      .from("usage_logs")
      .insert({
        user_id: userId,
        job_id: jobId,
        action: modelIdentifier,
        provider: "reserved",
        credits_used: pricing.creditCost,
        cost_usd: providerCostUsd,
        metadata: {
          status: "reserved",
          display_cost_usd: displayCostUsd,
        },
      })
      .select("id")
      .single()

    if (logError || !usageLog) {
      console.error("[credits] Failed to create usage log:", logError)
      return { usageLogId: "log-failed", creditsReserved: pricing.creditCost, watermark }
    }

    return { usageLogId: usageLog.id, creditsReserved: pricing.creditCost, watermark }
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
      .select("user_id, credits_used, metadata")
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

    // Restore credits to topup balance (simpler than tracking source)
    const { error: updateError } = await supabase.rpc("add_topup_credits", {
      p_user_id: usageLog.user_id,
      p_credits: usageLog.credits_used,
    })

    if (updateError) {
      // Try direct update as fallback
      const { data: profile } = await supabase
        .from("profiles")
        .select("topup_credits")
        .eq("id", usageLog.user_id)
        .single()

      if (profile) {
        await supabase
          .from("profiles")
          .update({ topup_credits: (profile.topup_credits ?? 0) + usageLog.credits_used })
          .eq("id", usageLog.user_id)
      }
    }

    // Log the refund as a credit transaction
    const { data: refundProfile } = await supabase
      .from("profiles")
      .select("subscription_credits, topup_credits")
      .eq("id", usageLog.user_id)
      .single()

    await CreditsService.logTransaction({
      userId: usageLog.user_id,
      amount: usageLog.credits_used,
      creditType: "topup",
      source: "refund",
      description: "Refund for failed job",
      jobId: usageLogId,
      balanceAfter: (refundProfile?.subscription_credits ?? 0) + (refundProfile?.topup_credits ?? 0),
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
      .select("storage_used_bytes, storage_limit_bytes")
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
    const limitBytes = profile.storage_limit_bytes ?? TIER_STORAGE_LIMITS.free

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
