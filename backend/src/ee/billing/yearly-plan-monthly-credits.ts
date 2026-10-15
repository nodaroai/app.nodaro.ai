/**
 * Monthly credits on yearly plans (decided 2026-10-15).
 *
 * Every paid plan grants its credits every month — the pricing page says
 * "N credits / month" on both billing cycles. The webhook renewal
 * (`handleSubscriptionUpdated`) and its safety net (`renewSubscriptionCredits`)
 * reset `subscription_credits` only when Stripe moves the billing period: every
 * month on a monthly price, once a year on a yearly one. This step covers the
 * months in between for a YEARLY price: at each monthly anchor of the current
 * period (`monthly-credit-anchors.ts`) the pool is SET to the plan's monthly
 * amount — the same SET the renewal does, so unused subscription credits do
 * not roll over, and top-up credits are never touched.
 *
 * What each run does, per active subscription on a yearly price:
 *   - the due anchor is the latest one that is `<= now` and inside the period
 *     (the anchor at the period end is the renewal's), and before a scheduled
 *     `cancel_at`;
 *   - a profile whose `credits_reset_at` is at or after that anchor already
 *     has this month's credits — nothing to do;
 *   - otherwise `grant_yearly_plan_monthly_credits` (migration 527) re-checks
 *     everything under the profile's row lock and grants at most once per
 *     anchor, however many replicas run this cron and whatever the webhook is
 *     doing at the same moment. One grant per run per subscription: missed
 *     months are never back-paid.
 *
 * The amount is `TIER_CREDITS` of the plan the subscription's price maps to —
 * the source the renewal reads.
 */
import { supabase } from "../../lib/supabase.js"
import { isMissingFunctionError } from "../../lib/postgrest-errors.js"
import { invalidateBalanceCache } from "../routes/credits.js"
import { latestMonthlyAnchor } from "./monthly-credit-anchors.js"
import { PRICE_TO_PLAN, TIER_CREDITS } from "./stripe-config.js"

/** Every yearly price, derived from `PRICE_TO_PLAN` — never a second list. */
export const YEARLY_PRICE_IDS: readonly string[] = Object.freeze(
  Object.entries(PRICE_TO_PLAN)
    .filter(([, plan]) => plan.interval === "yearly")
    .map(([priceId]) => priceId),
)

/** Subscriptions read per page (also bounds each profile lookup's id list). */
export const YEARLY_CREDITS_PAGE_SIZE = 100

export interface YearlyPlanCreditsResult {
  /** Subscriptions whose monthly credits this run set. */
  readonly granted: number
  /** Subscriptions the database refused: already granted by a concurrent run
   *  or the renewal, or changed (price, period, status) since they were read. */
  readonly refused: number
  readonly errors: number
  /** The database does not have migration 527's function yet — staging runs
   *  `dev` code against the shared database before `main` applies it. */
  readonly awaitingMigration: boolean
}

interface YearlySubscriptionRow {
  readonly id: string
  readonly user_id: string
  readonly stripe_price_id: string | null
  readonly current_period_start: string | null
  readonly current_period_end: string | null
  readonly cancel_at: string | null
}

interface DueGrant {
  readonly row: YearlySubscriptionRow
  readonly periodStart: string
  readonly anchor: Date
  readonly plan: string
  readonly credits: number
}

function epochOf(value: string | null | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : t
}

/** The grant a row is due at `now`, or null when it is due nothing. */
function dueGrant(row: YearlySubscriptionRow, now: Date): DueGrant | null {
  const price = row.stripe_price_id ? PRICE_TO_PLAN[row.stripe_price_id] : undefined
  if (!price || price.interval !== "yearly") return null
  const credits = TIER_CREDITS[price.plan]
  if (!credits || credits <= 0) return null

  const start = epochOf(row.current_period_start)
  const end = epochOf(row.current_period_end)
  if (start === null || end === null || !row.current_period_start) return null
  // Once the period has ended, the turn of the year is the renewal's: a late
  // month-11 grant now would stamp credits_reset_at past the period end, and
  // the safety net would then skip the year-end renewal.
  if (now.getTime() >= end) return null
  // A scheduled cancellation that falls inside the period ends the grants there.
  const cancelAt = epochOf(row.cancel_at)
  const bound = cancelAt !== null && cancelAt < end ? cancelAt : end

  const anchor = latestMonthlyAnchor(new Date(start), new Date(bound), now)
  if (!anchor) return null
  return { row, periodStart: row.current_period_start, anchor, plan: price.plan, credits }
}

/**
 * When each user's subscription pool was last reset (epoch ms; null = never),
 * or null when the lookup failed — the caller then lets the database decide.
 */
async function lastResets(userIds: readonly string[]): Promise<Map<string, number | null> | null> {
  if (userIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from("profiles")
    .select("id, credits_reset_at")
    .in("id", [...userIds])
  if (error) {
    console.error("[cleanup] Yearly plan credits: profile lookup failed:", error.message)
    return null
  }
  return new Map(
    ((data ?? []) as Array<{ id: string; credits_reset_at: string | null }>).map((p) => [
      p.id,
      epochOf(p.credits_reset_at),
    ]),
  )
}

/**
 * Set this month's subscription credits for every active yearly subscription
 * that has not had them yet. Never throws for a single subscription; a failed
 * grant is counted and retried by the next run.
 */
export async function grantYearlyPlanMonthlyCredits(now: Date = new Date()): Promise<YearlyPlanCreditsResult> {
  let granted = 0
  let refused = 0
  let errors = 0
  let after: string | null = null

  for (;;) {
    let query = supabase
      .from("subscriptions")
      .select("id, user_id, stripe_price_id, current_period_start, current_period_end, cancel_at")
      .eq("status", "active")
      .in("stripe_price_id", [...YEARLY_PRICE_IDS])
    if (after) query = query.gt("id", after)
    const { data, error } = await query.order("id", { ascending: true }).limit(YEARLY_CREDITS_PAGE_SIZE)
    if (error) {
      console.error("[cleanup] Yearly plan credits: subscription query failed:", error.message)
      return { granted, refused, errors: errors + 1, awaitingMigration: false }
    }
    const rows = (data ?? []) as YearlySubscriptionRow[]
    if (rows.length === 0) break

    const due = rows.map((row) => dueGrant(row, now)).filter((g): g is DueGrant => g !== null)
    const resets = await lastResets([...new Set(due.map((g) => g.row.user_id))])
    if (resets === null) errors += 1

    for (const grant of due) {
      const lastReset = resets?.get(grant.row.user_id)
      if (lastReset != null && lastReset >= grant.anchor.getTime()) continue // this month's credits are set

      const { data: didGrant, error: rpcError } = await supabase.rpc("grant_yearly_plan_monthly_credits", {
        p_user_id: grant.row.user_id,
        p_subscription_id: grant.row.id,
        p_price_id: grant.row.stripe_price_id,
        p_period_start: grant.periodStart,
        p_anchor: grant.anchor.toISOString(),
        p_credits: grant.credits,
      })
      if (rpcError) {
        if (isMissingFunctionError(rpcError)) {
          console.warn("[cleanup] Yearly plan credits skipped: migration 527 (grant_yearly_plan_monthly_credits) is not on this database yet")
          return { granted, refused, errors, awaitingMigration: true }
        }
        console.error(`[cleanup] Yearly plan credits: grant failed for user ${grant.row.user_id}:`, rpcError.message)
        errors += 1
        continue
      }
      if (didGrant === true) {
        granted += 1
        invalidateBalanceCache(grant.row.user_id)
        console.log(
          `[cleanup] Monthly credits on a yearly plan for user ${grant.row.user_id}: ${grant.plan}, set to ${grant.credits} (anchor ${grant.anchor.toISOString()})`,
        )
      } else {
        refused += 1
      }
    }

    if (rows.length < YEARLY_CREDITS_PAGE_SIZE) break
    after = rows[rows.length - 1].id
  }

  return { granted, refused, errors, awaitingMigration: false }
}
