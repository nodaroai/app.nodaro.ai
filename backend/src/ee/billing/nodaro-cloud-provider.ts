import { resolveEffectiveTier } from "@nodaro/shared"
import type { BillingProvider, Charge, AccountSummary } from "../../lib/billing-provider.js"
import { supabase } from "../../lib/supabase.js"

/**
 * The credit-bearing billing adapter for the Nodaro cloud edition. Registered
 * ONLY when hasCredits() (via registerNodaroCloudBillingProvider in
 * lib/billing-provider.ts). Reads the same `jobs` / `profiles` data the cloud
 * edition already computes — this is a DISPLAY adapter, it never prices.
 *
 * report(): `amount` is credits (the authority's primary unit); `secondaryAmount`
 * is the USD view for the admin dollar toggle. null stays null (rule 1).
 * account(): `plan` is the effective tier string; "unknown" survives if the
 * profile row is absent (rule 2). unit is credits (rule 3).
 */
export const nodaroCloudBillingProvider: BillingProvider = {
  id: "nodaro-cloud",
  displayUnit: "credits",

  async report(jobIds: string[]): Promise<Map<string, Charge> | null> {
    if (jobIds.length === 0) return new Map()
    const { data, error } = await supabase
      .from("jobs")
      .select("id, credits, display_cost, provider_cost")
      .in("id", jobIds)
    if (error) return null // whole batch unavailable — NOT "all free"
    const out = new Map<string, Charge>()
    for (const row of (data ?? []) as ReadonlyArray<{
      id: string
      credits: number | null
      display_cost: number | null
      provider_cost: number | null
    }>) {
      const usd = row.display_cost ?? row.provider_cost ?? null
      out.set(row.id, {
        amount: row.credits ?? null,
        unit: "credits",
        secondaryAmount: usd,
        secondaryUnit: "usd",
      })
    }
    return out
  },

  async account(userId: string): Promise<AccountSummary | null> {
    const { data, error } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, lifetime_topup_credits, subscription_credits, topup_credits, app_credits_allowance")
      .eq("id", userId)
      .maybeSingle()
    if (error || !data) return null
    const row = data as {
      tier: string | null
      subscription_tier: string | null
      lifetime_topup_credits: number | null
      subscription_credits: number | null
      topup_credits: number | null
      app_credits_allowance: number | null
    }
    const balance = Number(row.subscription_credits ?? 0) + Number(row.topup_credits ?? 0)
    const plan =
      resolveEffectiveTier({
        tier: row.tier ?? null,
        subscription_tier: row.subscription_tier ?? null,
        lifetime_topup_credits: row.lifetime_topup_credits ?? 0,
      }) ?? "unknown"
    return {
      plan,
      balance,
      dailyAllowance: row.app_credits_allowance ?? null,
      unit: "credits",
    }
  },
}
