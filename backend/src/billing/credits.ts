import { supabase } from "../lib/supabase.js"
import { hasCredits } from "../lib/config.js"

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
}

// ============================================================
// Fallback Static Credit Costs (used when model_pricing table doesn't exist)
// ============================================================

const STATIC_CREDIT_COSTS: Record<string, number> = {
  // Image models
  "nano-banana": 5,
  "flux": 8,
  "grok": 10,
  "gpt-image": 15,
  // Video models
  "veo3": 50,
  "veo3.1": 75,
  "kling": 30,
  "kling-turbo": 20,
  "minimax": 20,
  // TTS
  "elevenlabs": 3,
  // Node types (legacy)
  "generate-script": 2,
  "generate-image": 5,
  "image-to-video": 20,
  "video-to-video": 25,
  "text-to-video": 25,
  "text-to-speech": 3,
  "qa-check": 1,
  "combine-videos": 2,
  "merge-video-audio": 1,
  "add-captions": 2,
  "resize-video": 1,
  "extract-audio": 1,
  "mix-audio": 1,
  "adjust-volume": 0,
  "trim-video": 0,
  "generate-music": 3,
  "text-to-audio": 3,
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
 * Get credit cost for a model from database, falling back to static costs
 */
async function getModelCreditCostFromDB(modelIdentifier: string): Promise<{
  creditCost: number
  isEnabled: boolean
  tierRestriction: string | null
}> {
  // Try to get from model_pricing table
  const { data, error } = await supabase
    .from("model_pricing")
    .select("credit_cost, is_enabled, tier_restriction")
    .eq("model_identifier", modelIdentifier)
    .single()

  if (error || !data) {
    // Fall back to static costs
    const staticCost = STATIC_CREDIT_COSTS[modelIdentifier] ?? 0
    return {
      creditCost: staticCost,
      isEnabled: true,
      tierRestriction: null,
    }
  }

  return {
    creditCost: data.credit_cost,
    isEnabled: data.is_enabled,
    tierRestriction: data.tier_restriction,
  }
}

// ============================================================
// Credits Service
// ============================================================

export class CreditsService {
  /**
   * Check if user has sufficient credits (read-only check)
   * Returns allowed: true for self-hosted mode
   */
  static async checkCredits(
    userId: string,
    modelIdentifier: string
  ): Promise<CreditCheckResult> {
    // Self-hosted: always allow
    if (creditsDisabled()) {
      return { allowed: true, balance: 999999 }
    }

    // Get model pricing
    const pricing = await getModelCreditCostFromDB(modelIdentifier)

    if (!pricing.isEnabled) {
      return {
        allowed: false,
        error: "This model is currently disabled",
      }
    }

    // Get user's profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("subscription_tier, subscription_credits, topup_credits, daily_spent_credits")
      .eq("id", userId)
      .single()

    if (profileError || !profile) {
      return {
        allowed: false,
        error: "User profile not found",
      }
    }

    // Check tier restriction
    if (pricing.tierRestriction) {
      const userTierIndex = TIER_ORDER.indexOf(profile.subscription_tier || "free")
      const requiredTierIndex = TIER_ORDER.indexOf(pricing.tierRestriction)

      if (userTierIndex < requiredTierIndex) {
        return {
          allowed: false,
          error: `This model requires ${pricing.tierRestriction} tier or higher. Please upgrade your plan.`,
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
      }
    }

    // Get daily limit from tier config (optional)
    const { data: tierConfig } = await supabase
      .from("tier_config")
      .select("daily_credit_limit")
      .eq("tier", profile.subscription_tier)
      .single()

    const dailyLimit = tierConfig?.daily_credit_limit ?? null
    const dailySpent = profile.daily_spent_credits ?? 0

    // Check daily limit if configured
    if (dailyLimit !== null && dailySpent + pricing.creditCost > dailyLimit) {
      return {
        allowed: false,
        error: `Daily credit limit reached. Limit: ${dailyLimit}, Spent: ${dailySpent}`,
        balance: totalBalance,
        required: pricing.creditCost,
        dailyLimit,
        dailySpent,
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
    }
  }

  /**
   * Reserve credits atomically before job creation
   * Creates a usage_log entry with status 'reserved'
   */
  static async reserveCredits(
    userId: string,
    jobId: string,
    modelIdentifier: string,
    providerCostUsd: number,
    displayCostUsd: number
  ): Promise<ReserveResult> {
    // Self-hosted: skip reservation
    if (creditsDisabled()) {
      return { usageLogId: "self-hosted-skip", creditsReserved: 0 }
    }

    // Get credit cost for this model
    const pricing = await getModelCreditCostFromDB(modelIdentifier)

    // Try to call RPC function for atomic reservation
    const { data: rpcResult, error: rpcError } = await supabase.rpc("reserve_credits", {
      p_user_id: userId,
      p_job_id: jobId,
      p_model_identifier: modelIdentifier,
      p_credits: pricing.creditCost,
      p_provider_cost_usd: providerCostUsd,
      p_display_cost_usd: displayCostUsd,
    })

    if (!rpcError && rpcResult) {
      return { usageLogId: rpcResult, creditsReserved: pricing.creditCost }
    }

    // Fallback: manual reservation if RPC doesn't exist
    console.warn("[credits] reserve_credits RPC not found, using fallback")

    // Get current balance
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_credits, topup_credits")
      .eq("id", userId)
      .single()

    if (!profile) {
      throw new Error("User profile not found")
    }

    const subscriptionCredits = profile.subscription_credits ?? 0
    const topupCredits = profile.topup_credits ?? 0
    const totalBalance = subscriptionCredits + topupCredits

    if (totalBalance < pricing.creditCost) {
      throw new Error(`Insufficient credits: need ${pricing.creditCost}, have ${totalBalance}`)
    }

    // Deduct from subscription first, then topup
    let remaining = pricing.creditCost
    let newSubscription = subscriptionCredits
    let newTopup = topupCredits

    if (newSubscription >= remaining) {
      newSubscription -= remaining
      remaining = 0
    } else {
      remaining -= newSubscription
      newSubscription = 0
      newTopup -= remaining
    }

    // Update profile
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        subscription_credits: newSubscription,
        topup_credits: newTopup,
      })
      .eq("id", userId)

    if (updateError) {
      throw new Error(`Failed to update credits: ${updateError.message}`)
    }

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
      return { usageLogId: "log-failed", creditsReserved: pricing.creditCost }
    }

    return { usageLogId: usageLog.id, creditsReserved: pricing.creditCost }
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
    const { error: updateError } = await supabase.rpc("increment_topup_credits", {
      p_user_id: usageLog.user_id,
      p_amount: usageLog.credits_used,
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

    // Mark as refunded
    await supabase
      .from("usage_logs")
      .update({
        metadata: { status: "refunded" },
      })
      .eq("id", usageLogId)
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

    // Get tier configuration
    const { data: tierConfig } = await supabase
      .from("tier_config")
      .select("daily_credit_limit, monthly_credits, features")
      .eq("tier", profile.subscription_tier)
      .single()

    const subscriptionCredits = profile.subscription_credits ?? 0
    const topupCredits = profile.topup_credits ?? 0

    return {
      total: subscriptionCredits + topupCredits,
      subscription: subscriptionCredits,
      topup: topupCredits,
      dailySpent: profile.daily_spent_credits ?? 0,
      dailyLimit: tierConfig?.daily_credit_limit ?? null,
      monthlyAllocation: tierConfig?.monthly_credits ?? 0,
      tier: profile.subscription_tier ?? "free",
      features: (tierConfig?.features as Record<string, unknown>) ?? {},
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
