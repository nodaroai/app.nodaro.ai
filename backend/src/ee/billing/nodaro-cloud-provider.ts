import { resolveEffectiveTier } from "@nodaro/shared"
import type { BillingProvider, Charge, AccountSummary, UsageCategory } from "../../lib/billing-provider.js"
import { supabase } from "../../lib/supabase.js"
import { deploymentPayerActive } from "../../lib/deployment-payer.js"
import { allowanceFor } from "./deployment-allowance-service.js"

/** Display-only bucketing of a usage_logs `action` (a model identifier) into
 *  the /usage breakdown's categories. ORDER MATTERS: "image-to-video" is
 *  video work, so video outranks image. Unknown actions land in "other" —
 *  never dropped. */
function usageCategoryOf(action: string): string {
  const a = action.toLowerCase()
  if (/video|motion|animate|lip|kling|veo|runway/.test(a)) return "video"
  if (/audio|speech|music|suno|voice|tts|eleven|sound|dub/.test(a)) return "audio"
  if (/image|flux|imagen|photo|upscale|edit|collage|mask/.test(a)) return "image"
  return "other"
}

/**
 * D3(a) — the per-user answer on a deployment-payer instance: the requester's
 * CONSUMPTION this calendar month (attributed via usage_logs.on_behalf_of,
 * migration 362), plus — since Track A — the one balance that is honestly
 * theirs. The payer pool is still the instance owner's number and is still
 * never surfaced here; the requester's own profile row is still a frozen
 * signup grant nothing debits and is still not what is shown. What changed is
 * that a per-user allowance exists: `balance` is what they have LEFT of it and
 * `allocated` is what they were GRANTED, both raw credits, converted once at
 * the display-unit seam. When the deployment wires its own billing provider's
 * `account()` (D3(c)), that registration replaces this whole answer.
 */
async function deploymentConsumptionAccount(userId: string): Promise<AccountSummary | null> {
  const periodStart = new Date()
  periodStart.setUTCDate(1)
  periodStart.setUTCHours(0, 0, 0, 0)
  // Client-side aggregation, capped: no sum() without an RPC, and a
  // deployment instance's per-user monthly row count sits far below the cap.
  // At the cap the figures under-report and say so in the log.
  const CAP = 5000
  const { data, error } = await supabase
    .from("usage_logs")
    .select("action, credits_used, status")
    .eq("on_behalf_of", userId)
    .in("status", ["reserved", "committed"]) // refunded rows are not consumption
    .gte("created_at", periodStart.toISOString())
    .limit(CAP)
  if (error) {
    // Includes 42703 on a DB that predates migration 362 — unavailable, never zeros.
    console.error("[nodaro-cloud-provider] consumption read failed:", error.message)
    return null
  }
  const rows = (data ?? []) as ReadonlyArray<{ action: string | null; credits_used: number | null }>
  if (rows.length === CAP) {
    console.warn(`[nodaro-cloud-provider] consumption for ${userId} hit the ${CAP}-row cap — figures under-report`)
  }
  const byKey = new Map<string, { count: number; amount: number }>()
  for (const r of rows) {
    const key = usageCategoryOf(r.action ?? "")
    const agg = byKey.get(key) ?? { count: 0, amount: 0 }
    agg.count += 1
    agg.amount += r.credits_used ?? 0
    byKey.set(key, agg)
  }
  const byCategory: UsageCategory[] = [...byKey.entries()].map(([category, agg]) => ({
    category,
    count: agg.count,
    amount: agg.amount,
    spent: null,
  }))
  // Read AFTER the consumption aggregate and never allowed to sink it: the
  // two are different reads with different failure modes. An unreadable
  // allowance is "unavailable" for the two balance fields alone (null, which
  // renders as an em dash) — it must not blank the period's spend and its
  // breakdown, which came back fine. `allowanceFor` is also the only place the
  // D7 no-row rule lives, so a user who has never generated gets the default
  // here rather than a manufactured 0.
  const allowance = await allowanceFor(userId)
  return {
    plan: "",
    // Before a payer, this function is never reached at all, and these stay
    // null — the pre-Track-A answer, verbatim. Under a payer they are real
    // from rollout step 2: the allowance is VISIBLE whether or not enforcement
    // has been flipped on (the ruling in deployment-allowance-service.ts), so
    // /usage stops showing two em dashes at step 5 rather than step 8.
    balance: allowance ? allowance.remaining : null,
    allocated: allowance ? allowance.granted : null,
    dailyAllowance: null,
    unit: "credits",
    periodStart: periodStart.toISOString(),
    generations: rows.length,
    byCategory,
  }
}

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
    if (deploymentPayerActive()) return deploymentConsumptionAccount(userId)
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
