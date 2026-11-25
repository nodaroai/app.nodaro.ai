// @registry-enumerates writes the plan grant's audit rows through CreditsService.logTransaction — no node type is looked up, so not a @registry-lookup
/**
 * When a Stripe subscription's plan is granted, and the grant itself.
 *
 * The plan (the paid tier, the plan's credits, the storage that comes with
 * it, and the move of the account's remaining balance into top-up) is given
 * once per subscription, only once it is paid for: at creation when it is
 * already `active` or `trialing`, otherwise by the first update that sees it
 * so. The subscription row's `plan_granted` marker (migration 650) records the
 * claim, and every grant is claimed through one database call,
 * `claim_subscription_grant` (migration 663), which serializes an account's
 * claims and refuses one while another subscription of the account that has
 * not ended is claimed (`plan_claimed_at`) or granted and live: one granted
 * subscription per account. The webhook handlers that call this live in
 * provision-credits.ts.
 */

import { supabase } from "../../lib/supabase.js"
import { isMissingColumnError, isMissingFunctionError } from "../../lib/postgrest-errors.js"
import { TIER_CREDITS, TIER_STORAGE_LIMITS } from "./stripe-config.js"
import { tierColumns } from "./tier-columns.js"
import { notifyPaidConversion } from "../notifications/founder-notify.js"
import { CreditsService } from "./credits.js"
import { invalidateBalanceCache } from "./balance-cache.js"
import { StripeEventRetryError } from "./stripe-event-retry.js"
import { ENDED_STATUSES } from "./downgrade-floor.js"

/**
 * Stripe creates a Checkout subscription `incomplete` while its first payment
 * is not done (a payment that needs the customer's action, a declined card)
 * and moves it to `active` once that invoice is paid, or to
 * `incomplete_expired` after 23 hours unpaid. Only an `active` or `trialing`
 * subscription is granted its plan: the paid tier (and the watermark-free
 * output and storage that follow it), the plan's credits, and the move of
 * the remaining balance into top-up. Any other status grants nothing.
 */
export const GRANTING_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"])

/**
 * The statuses under which an update keeps writing the plan's paid tier on a
 * granted account: the granting ones, and `past_due` (a renewal payment being
 * retried), as before. Under any other status an update leaves the account's
 * tier as it is.
 */
export const PAID_TIER_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"])

/**
 * The statuses a subscription never leaves: Stripe's two terminal ones
 * (`canceled`, `incomplete_expired`) and `expired`, which the hourly expiry
 * gives a cancelled subscription past its period. An event that says such a
 * subscription is live again is a late one: it neither grants the plan nor
 * moves the stored status.
 */
export { ENDED_STATUSES }

export function isEndedStatus(status: string | null | undefined): boolean {
  return status != null && ENDED_STATUSES.includes(status)
}

/** `ENDED_STATUSES` as a PostgREST list, for `.not("status", "in", …)`. */
export const ENDED_STATUS_LIST = `(${ENDED_STATUSES.join(",")})`

/**
 * Whether a subscription row's plan was granted. `plan_granted` is false only
 * on a row the created handler recorded unpaid; a row from before the column
 * existed, or from a writer that does not name it, reads as granted (the
 * column's default), and so does a row read without the column at all (a
 * database the column has not reached yet, where every row was granted at
 * creation).
 */
export function planGranted(row: GrantMarker): boolean {
  return row.plan_granted !== false
}

export interface GrantMarker {
  /** Absent when the row was read from a database without the column yet. */
  readonly plan_granted?: boolean | null
}

/** What handleSubscriptionUpdated reads of the stored subscription. */
export const SUBSCRIPTION_UPDATE_COLUMNS = "id, status, stripe_price_id, tier, current_period_start, current_period_end, cancel_at_period_end"

export interface StoredSubscription {
  readonly id: string
  readonly status: string
  readonly stripe_price_id: string | null
  readonly tier: string
  readonly current_period_start: string | null
  readonly current_period_end: string | null
  readonly cancel_at_period_end: boolean | null
}

/**
 * A subscription row with its grant marker. A database without the marker yet
 * (staging runs ahead of main on the shared database) is read without it.
 */
export async function readSubscriptionRow<T extends object>(subscriptionId: string, columns: string): Promise<(T & GrantMarker) | null> {
  const withMarker = await supabase
    .from("subscriptions")
    .select(`${columns}, plan_granted`)
    .eq("stripe_subscription_id", subscriptionId)
    .single()
  if (!isMissingColumnError(withMarker.error)) return (withMarker.data ?? null) as unknown as (T & GrantMarker) | null
  const { data } = await supabase
    .from("subscriptions")
    .select(columns)
    .eq("stripe_subscription_id", subscriptionId)
    .single()
  return (data ?? null) as unknown as (T & GrantMarker) | null
}

export interface SubscriptionRecord {
  readonly subscriptionId: string
  readonly priceId: string
  readonly status: string
  readonly currentPeriodStart: string | null
  readonly currentPeriodEnd: string | null
  readonly transactionId?: string
  readonly amountUsd?: number
}

/**
 * Record a subscription that is not paid for yet, marked not granted. Answers
 * "marker-missing" when the database has no marker column yet: the caller
 * then grants at creation, as before the column existed.
 */
export async function recordUnpaidSubscription(
  userId: string,
  tier: string,
  data: SubscriptionRecord,
): Promise<"recorded" | "failed" | "marker-missing"> {
  const { error } = await supabase
    .from("subscriptions")
    .insert({
      user_id: userId,
      stripe_subscription_id: data.subscriptionId,
      stripe_price_id: data.priceId,
      tier,
      status: data.status,
      current_period_start: data.currentPeriodStart,
      current_period_end: data.currentPeriodEnd,
      plan_granted: false,
    })
  if (!error) {
    console.log(
      `[stripe] subscription.created: ${data.status}, nothing granted until it is paid: user=${userId} sub=${data.subscriptionId}`,
    )
    return "recorded"
  }
  if (isMissingColumnError(error)) {
    console.warn("[stripe] subscription.created: plan_granted is not in the database yet, granting at creation", data.subscriptionId)
    return "marker-missing"
  }
  console.error("[stripe] subscription.created: insert failed:", error.message)
  return "failed"
}

/**
 * Record a paid subscription and grant its plan, in the update path's order:
 * the row is inserted `incomplete` and not granted, claimed through
 * `claimSubscriptionGrant` like every other grant, granted, and only then
 * given the event's status (`writeGrantedStatus`). A refused claim
 * (`other_live`) leaves the row `incomplete`, so it never holds the
 * one-active-subscription index and never counts as a live subscription. The
 * subscription id is unique, so of two events recording the same
 * subscription only the one whose insert lands goes on to claim it; the other
 * (`null`) leaves it to the row's own claim. Answers the claim's outcome, or
 * `null` when nothing was recorded. A grant whose write failed gives the claim
 * back and throws StripeEventRetryError (grantSubscriptionPlan).
 * `duplicateExpected`: the caller (an update that may have outrun created)
 * reads a row that is already there as the normal race, not as a failure.
 *
 * A database without migration 663 yet (staging runs ahead of main on the
 * shared database) records the row with the event's status, as before 663,
 * and one without migration 650's marker records it with no marker, the
 * insert being the claim (below).
 */
export async function recordAndGrantSubscription(
  userId: string,
  tier: string,
  data: SubscriptionRecord,
  event: string,
  duplicateExpected = false,
): Promise<SubscriptionClaimOutcome | null> {
  const preProfile = await readPreSubscribeProfile(userId)

  const row = {
    user_id: userId,
    stripe_subscription_id: data.subscriptionId,
    stripe_price_id: data.priceId,
    tier,
    current_period_start: data.currentPeriodStart,
    current_period_end: data.currentPeriodEnd,
  }
  // Migration 663's claim time is named (null) so that a database without it
  // answers "no such column" here, before anything is granted: that database
  // has no claim function either, and is recorded as before 663, with the
  // event's live status, so the one-active index still refuses a second paid
  // subscription there. A database without migration 650's marker either is
  // recorded as before 650: no marker, and the insert is the claim.
  let { error: subError } = await supabase
    .from("subscriptions")
    .insert({ ...row, status: "incomplete", plan_granted: false, plan_claimed_at: null })
  let markerMissing = false
  if (isMissingColumnError(subError)) {
    console.warn(`[stripe] ${event}: plan_claimed_at is not in the database yet, recording the subscription with its status`, data.subscriptionId)
    ;({ error: subError } = await supabase.from("subscriptions").insert({ ...row, status: data.status, plan_granted: false }))
  }
  if (isMissingColumnError(subError)) {
    console.warn(`[stripe] ${event}: plan_granted is not in the database yet, the insert is the claim`, data.subscriptionId)
    markerMissing = true
    ;({ error: subError } = await supabase.from("subscriptions").insert({ ...row, status: data.status }))
  }

  if (subError) {
    // Only an insert on a database without migration 663 writes a live
    // status, so only it can meet the one-active index.
    if (subError.code === "23505" && subError.message?.includes(ONE_ACTIVE_INDEX)) {
      const other = await activeSubscriptionOf(userId)
      console.error(
        `[stripe] second live subscription refused: sub=${data.subscriptionId} user=${userId} not recorded; kept sub=${other ?? "(unknown)"}, the account's active subscription`,
      )
      return other ? { outcome: "other_live", otherSubscriptionId: other } : null
    }
    if (duplicateExpected && subError.code === "23505") {
      console.log(`[stripe] ${event}: already recorded by its created event, the claim decides: sub=${data.subscriptionId}`)
    } else {
      console.error(`[stripe] ${event}: insert failed:`, subError.message)
    }
    return null
  }

  if (markerMissing) {
    await grantSubscriptionPlan(userId, tier, data, preProfile, event)
    return { outcome: "claimed" }
  }
  const claim = await claimAndGrantSubscription(userId, tier, data, event, preProfile)
  if (claim.outcome === "claimed") await writeGrantedStatus(data.subscriptionId, data.status, event)
  return claim
}

/** The Stripe id of the account's `active` subscription, if one can be read. */
async function activeSubscriptionOf(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
  if (error || !Array.isArray(data) || data.length === 0) return null
  const id = (data[0] as { stripe_subscription_id?: unknown }).stripe_subscription_id
  return typeof id === "string" ? id : null
}

/**
 * Give a subscription just granted the status of the event that granted it,
 * when the row still carries the `incomplete` it was recorded with (the
 * insert above records every paid subscription that way until its grant
 * lands). Conditional on that placeholder, so a cancellation, or a newer
 * status another event wrote meanwhile, is never overwritten. A write that
 * fails throws StripeEventRetryError after the grant has landed: the grant
 * stands, the row stays claimed (so it keeps the account's other
 * subscriptions from being claimed), and the event's redelivery finds the row
 * granted and still `incomplete` and writes the status then, granting nothing
 * again.
 */
export async function writeGrantedStatus(subscriptionId: string, status: string, event: string): Promise<void> {
  if (status === "incomplete") return
  const { error } = await supabase
    .from("subscriptions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscriptionId)
    .eq("status", "incomplete")
  if (error) {
    console.error(`[stripe] ${event}: plan granted but its status write failed: sub=${subscriptionId} status=${status}:`, error.message)
    throw new StripeEventRetryError(`writing the status of ${subscriptionId} after its grant failed: ${error.message}`)
  }
}

/** The one-active-subscription index (migration 024): a second `active` row of an account is refused by it. */
const ONE_ACTIVE_INDEX = "idx_one_active_subscription_per_user"

/**
 * What `claimSubscriptionGrant` answers:
 *  - `claimed`: this call holds the subscription's grant and must give it;
 *  - `not_claimable`: nothing to grant — no such subscription of this account,
 *    an ended one, or one already granted (a redelivered event lands here,
 *    never on `other_live`);
 *  - `other_live`: another subscription of the account that has not ended is
 *    claimed, or granted and live (`otherSubscriptionId`, its Stripe id).
 *    Nothing was written and nothing may be granted; the account keeps the
 *    plan it has.
 */
export type SubscriptionClaimOutcome =
  | { readonly outcome: "claimed" }
  | { readonly outcome: "not_claimable" }
  | { readonly outcome: "other_live"; readonly otherSubscriptionId: string }

let claimFunctionMissingWarned = false

/** Test seam: forget that the missing-function warning was given. */
export function resetClaimFunctionWarning(): void {
  claimFunctionMissingWarned = false
}

/**
 * Claim a recorded subscription's plan grant: `claim_subscription_grant`
 * (migration 663) locks the account's profile row, so two claims for one
 * account run one after the other, and refuses a subscription while another of
 * the account is granted and live. Of every event that claims one
 * subscription, at once or later, exactly one gets `claimed`. An `other_live`
 * answer is logged loudly here, once per refused claim. A claimed subscription
 * blocks from its claim on (`plan_claimed_at`), before the live status that
 * follows its grant is written, until it ends or its claim is released.
 *
 * A database error, or an answer this code does not know, throws
 * StripeEventRetryError before anything is written, so Stripe redelivers the
 * event and the claim is tried again. A database without the function yet
 * (staging runs dev before main applies 663) claims with the conditional
 * update it used before, which knows nothing of other subscriptions; that is
 * warned once.
 */
export async function claimSubscriptionGrant(subscriptionId: string, userId: string): Promise<SubscriptionClaimOutcome> {
  const { data, error } = await supabase.rpc("claim_subscription_grant", {
    p_stripe_subscription_id: subscriptionId,
    p_user_id: userId,
  })
  if (error) {
    if (isMissingFunctionError(error)) return claimByConditionalUpdate(subscriptionId, userId)
    console.error("[stripe] claiming the plan grant failed:", subscriptionId, error.message)
    throw new StripeEventRetryError(`claiming the plan grant of ${subscriptionId} failed: ${error.message}`)
  }
  const answer = (Array.isArray(data) ? data[0] : data) as { outcome?: unknown; other_stripe_subscription_id?: unknown } | null | undefined
  switch (answer?.outcome) {
    case "claimed":
      return { outcome: "claimed" }
    case "not_claimable":
      return { outcome: "not_claimable" }
    case "other_live": {
      const other = answer.other_stripe_subscription_id
      if (typeof other !== "string" || other === "") break
      console.error(
        `[stripe] second live subscription refused: sub=${subscriptionId} user=${userId} granted nothing; kept sub=${other}, the account's live subscription`,
      )
      return { outcome: "other_live", otherSubscriptionId: other }
    }
  }
  console.error("[stripe] claiming the plan grant got an answer it does not know:", subscriptionId, JSON.stringify(data))
  throw new StripeEventRetryError(`claiming the plan grant of ${subscriptionId} got an unknown answer`)
}

/**
 * The claim before migration 663: a conditional update of a row recorded
 * unpaid and not ended. It cannot see the account's other subscriptions, so it
 * answers only `claimed` or `not_claimable`.
 */
async function claimByConditionalUpdate(subscriptionId: string, userId: string): Promise<SubscriptionClaimOutcome> {
  if (!claimFunctionMissingWarned) {
    claimFunctionMissingWarned = true
    console.warn(
      "[stripe] claim_subscription_grant is not in the database yet: claiming with the conditional update, without the one-live-subscription check",
    )
  }
  const { data, error } = await supabase
    .from("subscriptions")
    .update({ plan_granted: true })
    .eq("stripe_subscription_id", subscriptionId)
    .eq("user_id", userId)
    .eq("plan_granted", false)
    .not("status", "in", ENDED_STATUS_LIST)
    .select("id")
  if (error) {
    console.error("[stripe] claiming the plan grant failed:", subscriptionId, error.message)
    throw new StripeEventRetryError(`claiming the plan grant of ${subscriptionId} failed: ${error.message}`)
  }
  return Array.isArray(data) && data.length > 0 ? { outcome: "claimed" } : { outcome: "not_claimable" }
}

/**
 * Claim a recorded subscription's grant and, when this call holds it, give it.
 * Every grant goes through here (or, on a database without the marker yet,
 * through the insert that claims it). Answers the claim's outcome; nothing is
 * granted on `not_claimable` or `other_live`. `preProfile`: the balance read
 * before the row was recorded, when the caller has it; otherwise read now.
 */
export async function claimAndGrantSubscription(
  userId: string,
  tier: string,
  data: SubscriptionRecord,
  event: string,
  preProfile?: PreSubscribeProfile | null,
): Promise<SubscriptionClaimOutcome> {
  const claim = await claimSubscriptionGrant(data.subscriptionId, userId)
  if (claim.outcome !== "claimed") return claim
  const before = preProfile === undefined ? await readPreSubscribeProfile(userId) : preProfile
  await grantSubscriptionPlan(userId, tier, data, before, event)
  return claim
}

/**
 * Give back a claim whose grant could not be written: the row is marked not
 * granted again and its claim time cleared, so the event's redelivery (or the next update that sees the
 * subscription paid) claims it and grants it. Conditional on the marker this
 * call's claim set: only the claim's holder reaches here, and nothing else
 * moves the marker back. A release that fails leaves the row marked granted
 * with nothing granted; that is logged loudly, and the caller still asks
 * Stripe for the event again.
 */
async function releaseSubscriptionGrant(subscriptionId: string, event: string): Promise<void> {
  const release = (marker: Record<string, unknown>) =>
    supabase.from("subscriptions").update(marker).eq("stripe_subscription_id", subscriptionId).eq("plan_granted", true)
  // The claim time goes too, so a released claim stops blocking the account's
  // other subscriptions. A database without that column yet (before 663)
  // releases the grant marker alone.
  let { error } = await release({ plan_granted: false, plan_claimed_at: null })
  if (isMissingColumnError(error)) ({ error } = await release({ plan_granted: false }))
  if (error) {
    console.error(
      `[stripe] ${event}: PLAN NOT GRANTED AND ITS CLAIM NOT RELEASED: sub=${subscriptionId} is marked granted but its plan was never written; grant it by hand:`,
      error.message,
    )
  }
}

/**
 * True when the profile carries `stamp` as its reset time: the grant write
 * that set it committed. An unreadable profile reads as not landed (the claim
 * is then released and the event redelivered, as for any failed write).
 */
async function grantWriteLanded(userId: string, stamp: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("credits_reset_at").eq("id", userId).single()
  if (error || !data) return false
  const value = (data as { credits_reset_at?: string | null }).credits_reset_at
  return typeof value === "string" && Date.parse(value) === Date.parse(stamp)
}

export interface PreSubscribeProfile {
  readonly subscription_credits?: number | null
  readonly topup_credits?: number | null
  readonly subscription_tier?: string | null
}

/**
 * Snapshot the pre-subscribe balance BEFORE the tier grant overwrites it.
 * The free signup grant (or a prior post-cancel capped balance) lives in
 * subscription_credits, and the grant's SET would silently destroy it —
 * subscribing must never reduce a user's total credits. The remainder is
 * preserved by moving it into the topup pool (which survives renewals and
 * cancellation) after the profile update succeeds.
 */
export async function readPreSubscribeProfile(userId: string): Promise<PreSubscribeProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("subscription_credits, topup_credits, subscription_tier")
    .eq("id", userId)
    .single()
  return data
}

/**
 * The plan grant, given once per subscription by whichever event claimed it:
 * the paid tier, the plan's credits, its storage, the period end, and the
 * pre-subscribe balance moved into top-up. A grant whose write fails is never
 * lost: the claim is released and StripeEventRetryError thrown, so the
 * redelivered event claims and grants it.
 */
export async function grantSubscriptionPlan(
  userId: string,
  tier: string,
  data: SubscriptionRecord,
  preProfile: PreSubscribeProfile | null,
  event: string,
): Promise<void> {
  const credits = TIER_CREDITS[tier] ?? TIER_CREDITS.free
  const storageLimit = TIER_STORAGE_LIMITS[tier] ?? TIER_STORAGE_LIMITS.free
  const carryover = Math.max(0, preProfile?.subscription_credits ?? 0)
  const priorTier = preProfile?.subscription_tier ?? "free"

  // Update user profile. The stamp is kept, so a write that reports an error
  // can be told apart from one that did not land (below).
  const stamp = new Date().toISOString()
  const { error: writeError } = await supabase
    .from("profiles")
    .update({
      ...tierColumns(tier, priorTier),
      subscription_credits: credits,
      credits_reset_at: stamp,
      storage_limit_bytes: storageLimit,
      subscription_ended_at: null,
      current_period_end: data.currentPeriodEnd,
    })
    .eq("id", userId)

  // Nothing of the grant landed: the claim is given back and Stripe is asked
  // for the event again, so its redelivery claims and grants it then. Thrown
  // before anything else is written (the carryover, the audit rows, the
  // transaction record, the announcement), so each is done once, by the grant
  // that lands.
  // A write can commit and still report an error (a connection dropped after
  // the commit). Released and redelivered, that grant would run twice: a
  // second allocation, and the first moved into top-up as "pre-subscribe"
  // credits. So an error is only believed when the profile does not carry
  // this write's own stamp.
  const profileError = writeError && !(await grantWriteLanded(userId, stamp)) ? writeError : null
  if (writeError && !profileError) {
    console.warn(`[stripe] ${event}: profile update reported an error but landed; continuing the grant:`, writeError.message)
  }
  if (profileError) {
    console.error(`[stripe] ${event}: profile update failed:`, profileError.message)
    await releaseSubscriptionGrant(data.subscriptionId, event)
    throw new StripeEventRetryError(`granting the plan of ${data.subscriptionId} failed: ${profileError.message}`)
  }

  // Carry the pre-subscribe remainder into topup AFTER the grant SET succeeded
  // (a failed SET throws above, and subscription_credits still holds the old
  // balance — granting the carryover on top would double it). The atomic RPC
  // increments topup_credits; a redelivered event can't re-run this because
  // the grant was claimed first (claimSubscriptionGrant).
  if (carryover > 0) {
    const { error: carryError } = await supabase.rpc("add_topup_credits", {
      p_user_id: userId,
      p_credits: carryover,
    })
    if (carryError) {
      console.error(`[stripe] ${event}: balance carryover failed:`, carryError.message)
    } else {
      await CreditsService.logTransaction({
        userId,
        amount: carryover,
        creditType: "topup",
        source: "subscription_created",
        description: `Pre-subscription balance preserved: ${carryover} credits moved to top-up`,
        balanceAfter: (preProfile?.topup_credits ?? 0) + carryover,
      })
    }
  }

  invalidateBalanceCache(userId)

  // Insert transaction record (if transaction info provided)
  if (data.transactionId) {
    await insertTransaction({
      userId,
      stripeTransactionId: data.transactionId,
      type: "subscription",
      amountUsd: data.amountUsd ?? 0,
      creditsGranted: credits,
      tier,
    })
  }

  // Audit log: subscription creation
  await CreditsService.logTransaction({
    userId,
    amount: credits,
    creditType: "subscription",
    source: "subscription_created",
    description: `Subscription created: ${tier} tier (${credits} credits)`,
    balanceAfter: credits,
  })

  console.log(`[stripe] ${event}: user=${userId} tier=${tier} credits=${credits}`)

  // Internal founder milestone alert (fire-and-forget; a notification failure
  // must never affect billing). Fires only on a real free→paid transition.
  void notifyPaidConversion(userId, priorTier, tier)
}

// ── Insert Transaction Record ────────────────────────────────────

interface InsertTransactionParams {
  readonly userId: string
  readonly stripeTransactionId: string
  readonly type: "subscription" | "topup"
  readonly amountUsd: number
  readonly creditsGranted: number
  readonly tier?: string
}

export async function insertTransaction(params: InsertTransactionParams): Promise<void> {
  const { error } = await supabase
    .from("transactions")
    .upsert(
      {
        user_id: params.userId,
        stripe_transaction_id: params.stripeTransactionId,
        type: params.type,
        amount_usd: params.amountUsd,
        credits_granted: params.creditsGranted,
        tier: params.tier ?? null,
      },
      { onConflict: "stripe_transaction_id" }
    )

  if (error) {
    console.error("[stripe] insertTransaction failed:", error.message)
  }
}
