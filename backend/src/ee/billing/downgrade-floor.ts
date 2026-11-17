/**
 * The payg storage floor — one home for every downgrade-to-free writer.
 *
 * A user landing on stored tier "free" is NOT always entitlement-free: with
 * net lifetime top-ups > 0 they derive "payg" (effective-tier.ts) and keep a
 * 10 GB storage floor (= basic) instead of the 1 GB free floor. Three writer
 * paths used to inline the downgrade columns and would each have missed this
 * independently (design 2026-07-05 §4.5): handleSubscriptionCanceled (webhook),
 * expireSubscriptions (cron safety net), cleanupCanceledUserMedia (grace-
 * expiry media pass). They all route through here now.
 *
 * The activation half lives here too: a successful top-up grant raises the
 * floor with GREATEST semantics — an admin-raised limit is never lowered.
 */

import { supabase } from "../../lib/supabase.js"
import { ENDED_SUBSCRIPTION_CREDITS, TIER_STORAGE_LIMITS } from "./stripe-config.js"
import { resolveTierFrom, tierColumns } from "./tier-columns.js"

/** Storage floor for a user with the given NET lifetime top-up credits. */
export function storageFloorFor(lifetimeTopupCredits: number): number {
  return lifetimeTopupCredits > 0 ? TIER_STORAGE_LIMITS.payg : TIER_STORAGE_LIMITS.free
}

/** Batch-fetch net lifetime top-ups. Missing rows resolve to 0. */
export async function fetchLifetimeTopups(userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (userIds.length === 0) return out
  const { data } = await supabase
    .from("profiles")
    .select("id, lifetime_topup_credits")
    .in("id", userIds)
  for (const row of data ?? []) {
    out.set(row.id as string, (row.lifetime_topup_credits as number) ?? 0)
  }
  return out
}

/**
 * Downgrade ONE user to the free/payg effective floor. Caller-specific
 * columns (credit caps, subscription_ended_at, ...) ride along in `extra`.
 * Returns whether the user landed on the payg floor.
 *
 * `onlyIf`: write only while each named column still holds the given value
 * (null matches NULL) — a compare-and-set, so a caller that read the row
 * knows exactly what its write changed; `matched` says whether the row was
 * written. Without it the write is unconditional and `matched` is true
 * whenever there was no error.
 */
export async function downgradeToEffectiveFloor(
  userId: string,
  extra: Record<string, unknown> = {},
  onlyIf?: Readonly<Record<string, string | number | null>>,
): Promise<{ isPayg: boolean; error: { message: string } | null; matched: boolean }> {
  const lifetimes = await fetchLifetimeTopups([userId])
  const lifetime = lifetimes.get(userId) ?? 0
  let update = supabase
    .from("profiles")
    .update({
      ...tierColumns("free"),
      storage_limit_bytes: storageFloorFor(lifetime),
      ...extra,
    })
    .eq("id", userId)
  if (!onlyIf) {
    const { error } = await update
    return { isPayg: lifetime > 0, error: error ?? null, matched: !error }
  }
  for (const [column, value] of Object.entries(onlyIf)) {
    update = value === null ? update.is(column, null) : update.eq(column, value)
  }
  const { data, error } = await update.select("id")
  return { isPayg: lifetime > 0, error: error ?? null, matched: !error && Array.isArray(data) && data.length > 0 }
}

/**
 * The stored subscription statuses that hold a live plan: the account's
 * subscription, whose plan is not ended. `PAID_TIER_STATUSES` in
 * subscription-grant.ts plus `unpaid` (payment retries ended without payment):
 * the account keeps its tier then, as under `past_due` — a row could not
 * store `unpaid` before migration 656 and stayed `past_due` — but an update
 * saying `unpaid` writes no paid tier. Kept so by provision-credits.test.ts;
 * that module is not imported here, it pulls in the whole billing surface.
 */
export const LIVE_SUBSCRIPTION_STATUSES: readonly string[] = ["active", "trialing", "past_due", "unpaid"]

export type EndPlanOutcome =
  /** The plan ended now: tier free, the plan's credits ended; `removed` is exactly what the write took. */
  | { status: "ended"; removed: number; isPayg: boolean }
  /** Already on the free tier: the plan was ended before (or never reached the profile). Nothing written. */
  | { status: "already-free" }
  /** A subscription is live (a re-subscribe, possibly granted while this ran): its plan is the account's. Nothing written. */
  | { status: "live-subscription" }
  /** No such profile. Nothing written. */
  | { status: "missing" }

/**
 * End a paid plan on ONE account: the free tier and its storage floor, the
 * plan's credits ended (`ENDED_SUBSCRIPTION_CREDITS`), plus `extra`. Top-up
 * credits are never part of the write. Each attempt first asks again:
 *  - an account with a live subscription is left alone (a newer plan, even
 *    one granted while this ran);
 *  - an account already on the free tier is left alone, so a repeated end
 *    (a redelivered webhook, a second sweep) never touches credits it gained
 *    since.
 * The write is a compare-and-set on the subscription credits AND the
 * credit-period stamp read just before it: a run settling in between makes it
 * read again (so `removed` stays exact), and a plan granted in between (which
 * restamps `credits_reset_at`) is caught by the next attempt's checks.
 * Throws on a read or write error — nothing is written then — and when the
 * credits keep moving.
 */
export async function endPaidPlan(userId: string, extra: Record<string, unknown> = {}): Promise<EndPlanOutcome> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: live, error: liveError } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", userId)
      .in("status", [...LIVE_SUBSCRIPTION_STATUSES])
    if (liveError) throw new Error(`reading the live subscriptions of ${userId} failed: ${liveError.message}`)
    if (Array.isArray(live) && live.length > 0) return { status: "live-subscription" }

    const { data, error } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, subscription_credits, credits_reset_at")
      .eq("id", userId)
      .maybeSingle()
    if (error) throw new Error(`reading the profile of ${userId} failed: ${error.message}`)
    if (!data) return { status: "missing" }
    const profile = data as {
      tier?: string | null
      subscription_tier?: string | null
      subscription_credits?: number | null
      credits_reset_at?: string | null
    }
    if (resolveTierFrom(profile) === "free") return { status: "already-free" }
    const before = profile.subscription_credits ?? null
    const res = await downgradeToEffectiveFloor(
      userId,
      { ...extra, subscription_credits: ENDED_SUBSCRIPTION_CREDITS },
      { subscription_credits: before, credits_reset_at: profile.credits_reset_at ?? null },
    )
    if (res.error) throw new Error(`ending the plan of ${userId} failed: ${res.error.message}`)
    if (res.matched) return { status: "ended", removed: Math.max(0, (before ?? 0) - ENDED_SUBSCRIPTION_CREDITS), isPayg: res.isPayg }
    // The row moved between the read and the write: a run settled (read
    // again, so `removed` stays exact) or a plan was granted (the next
    // attempt's checks find it and end nothing).
  }
  throw new Error(`ending the plan of ${userId}: its credits kept changing`)
}

/**
 * Activation-side raise: after a successful top-up grant, lift the storage
 * limit to the payg floor — but never lower an admin-raised value, and never
 * touch subscribers (their floor is write-managed by the subscription paths).
 */
/**
 * After a refund/dispute clawback: a user whose NET lifetime dropped to 0 is
 * no longer payg — collapse the storage floor back to the free 1 GB, but ONLY
 * when the current limit is exactly the payg floor. An admin-raised value is
 * never touched (admin override wins in both directions).
 */
export async function reapplyStorageFloorAfterClawback(userId: string): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tier, subscription_tier, lifetime_topup_credits, storage_limit_bytes")
    .eq("id", userId)
    .single()
  if (!profile) return

  const stored = (profile.tier as string | null) ?? (profile.subscription_tier as string | null) ?? "free"
  const lifetime = (profile.lifetime_topup_credits as number) ?? 0
  const current = (profile.storage_limit_bytes as number) ?? 0
  if (stored !== "free" || lifetime > 0) return
  if (current !== TIER_STORAGE_LIMITS.payg) return // admin-raised or already free floor

  const { error } = await supabase
    .from("profiles")
    .update({ storage_limit_bytes: TIER_STORAGE_LIMITS.free })
    .eq("id", userId)
  if (error) {
    console.error("[billing] clawback floor collapse failed:", userId, error.message)
  }
}

export async function raiseStorageFloorOnActivation(userId: string): Promise<void> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tier, subscription_tier, lifetime_topup_credits, storage_limit_bytes")
    .eq("id", userId)
    .single()
  if (!profile) return

  const stored = (profile.tier as string | null) ?? (profile.subscription_tier as string | null) ?? "free"
  const lifetime = (profile.lifetime_topup_credits as number) ?? 0
  if (stored !== "free" || lifetime <= 0) return // subscribers never reach this branch

  const current = (profile.storage_limit_bytes as number) ?? 0
  const floor = TIER_STORAGE_LIMITS.payg
  if (current >= floor) return // admin-raised (or already floored) — no-lower

  const { error } = await supabase
    .from("profiles")
    .update({ storage_limit_bytes: floor })
    .eq("id", userId)
  if (error) {
    console.error("[billing] payg activation storage raise failed:", userId, error.message)
  }
}
