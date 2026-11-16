// @registry-enumerates writes the renewal hold's and release's audit rows through CreditsService.logTransaction — no node type is looked up, so not a @registry-lookup
/**
 * A failed renewal charge puts the period's subscription credits on hold;
 * they come back once, when that renewal is paid.
 *
 * Stripe moves a subscription's billing period when it creates the renewal
 * invoice and charges it about an hour later. The period move resets the
 * credits to the plan's allocation at once, as it always has — but only on an
 * event that says the subscription is active or trialing
 * (handleSubscriptionUpdated). When the charge fails, Stripe makes the
 * subscription `past_due` (and `unpaid` once it stops retrying, where so
 * configured); that event holds the credits left for the period:
 * `hold_subscription_renewal_credits` (migration 654) records them on the
 * subscription row against its current period and takes them out of the pool,
 * once per period.
 *
 * When the renewal invoice is paid (`invoice.paid`, billing_reason
 * `subscription_cycle`), `release_subscription_renewal_credits` records the
 * payment (always, once per invoice: its transactions row is the claim) and,
 * for the subscription's current period:
 *   - a held amount is ADDED back (anything granted during the hold, such as a
 *     plan upgrade's gap, is kept);
 *   - a period never reset (its move arrived past_due, or was lost) is SET to
 *     the plan's allocation: the catch-up;
 *   - otherwise (reset at the move, never held: the normal case) nothing.
 * An invoice for an older period, an ended subscription or one never granted
 * is recorded and gives nothing.
 *
 * The plan and the period come from the invoice's own plan line: the
 * subscription's non-proration line. It names the period paid for even when
 * `invoice.paid` arrives before the update that moves the stored row (Stripe
 * does not deliver events in order). The stored row's tier prices a catch-up
 * only when no line names a known plan.
 */
import type Stripe from "stripe"
import { supabase } from "../../lib/supabase.js"
import { isMissingFunctionError } from "../../lib/postgrest-errors.js"
import { PRICE_TO_PLAN, TIER_CREDITS } from "./stripe-config.js"
import { CreditsService } from "./credits.js"
import { invalidateBalanceCache } from "./balance-cache.js"
import { invoiceLinePriceId, listInvoiceLines } from "./plan-change-credits.js"
import { StripeEventRetryError } from "./stripe-event-retry.js"

/**
 * The statuses Stripe gives a subscription whose renewal charge failed:
 * `past_due` while it retries, `unpaid` once it stops. Either holds the
 * period's credits until the renewal is paid.
 */
export const HOLDING_STATUSES: ReadonlySet<string> = new Set(["past_due", "unpaid"])

/** One line a subscription item generated, reduced to what prices a renewal. */
export interface RenewalInvoiceLine {
  /** The price the line bills, or null when it names none. */
  readonly priceId: string | null
  /** The subscription whose item generated the line. */
  readonly subscriptionId: string | null
  /** A proration (the rest of a period after a plan change), never a renewal's own line. */
  readonly proration: boolean
  /** The service period the line bills, ISO. */
  readonly periodStart: string | null
  readonly periodEnd: string | null
}

function epochSecondsIso(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null
}

/**
 * The lines of an invoice that a subscription item generated. Lines from
 * one-off invoice items are left out. A line Stripe does not mark as a
 * non-proration reads as a proration, so it can never stand for a renewal.
 */
export async function invoiceRenewalLines(invoice: Stripe.Invoice): Promise<RenewalInvoiceLine[]> {
  const out: RenewalInvoiceLine[] = []
  for (const line of await listInvoiceLines(invoice)) {
    const item = line.parent?.subscription_item_details
    if (!item) continue
    out.push({
      priceId: invoiceLinePriceId(line),
      subscriptionId: item.subscription ?? null,
      proration: item.proration !== false,
      periodStart: epochSecondsIso(line.period?.start),
      periodEnd: epochSecondsIso(line.period?.end),
    })
  }
  return out
}

/** The period a renewal invoice pays for, and the plan a catch-up grants. */
export interface RenewalPeriod {
  readonly periodStart: string
  readonly periodEnd: string | null
  /** The plan that prices a catch-up, or null when nothing prices it (then it grants nothing). */
  readonly tier: string | null
  readonly credits: number
  /** True when no line named a known plan and the stored row's tier priced it. */
  readonly fromStoredTier: boolean
}

/**
 * The period and plan of a renewal invoice, from the subscription's own
 * non-proration lines: the one whose price maps to a known plan (the highest
 * by credits, should there be more than one). When none maps, the stored
 * subscription row's tier — never the free tier — prices it, with the period
 * taken from the subscription's line all the same. Null when the invoice has
 * no such line: there is no period to settle.
 */
export function renewalPeriodFromLines(
  lines: readonly RenewalInvoiceLine[],
  subscriptionId: string,
  storedTier: string | null,
): RenewalPeriod | null {
  const own = lines.filter((l) => !l.proration && l.subscriptionId === subscriptionId && l.periodStart !== null)
  let best: RenewalPeriod | null = null
  for (const line of own) {
    const plan = line.priceId ? PRICE_TO_PLAN[line.priceId] : undefined
    const credits = plan ? TIER_CREDITS[plan.plan] : undefined
    if (!plan || credits === undefined || credits <= 0) continue
    if (!best || credits > best.credits) {
      best = { periodStart: line.periodStart as string, periodEnd: line.periodEnd, tier: plan.plan, credits, fromStoredTier: false }
    }
  }
  if (best) return best

  const first = own[0]
  if (!first) return null
  const storedCredits = storedTier && storedTier !== "free" ? TIER_CREDITS[storedTier] : undefined
  const priced = storedCredits !== undefined && storedCredits > 0
  return {
    periodStart: first.periodStart as string,
    periodEnd: first.periodEnd,
    tier: priced ? storedTier : null,
    credits: priced ? storedCredits : 0,
    fromStoredTier: priced,
  }
}

/** A database that could not answer: nothing was written, so Stripe is asked for the event again. */
function retryOn(error: { message?: string } | null, what: string, fn: string): never {
  if (isMissingFunctionError(error)) {
    console.warn(`[stripe] ${what}: ${fn} is not in the database yet`)
    throw new StripeEventRetryError(`${what}: ${fn} is not in the database yet`)
  }
  console.error(`[stripe] ${what} failed:`, error?.message)
  throw new StripeEventRetryError(`${what} failed: ${error?.message ?? "unknown error"}`)
}

/**
 * A failed renewal charge: hold the credits left for the subscription's
 * current period, once per period. A database that could not answer (an
 * error, or the function not there yet) asks Stripe for the event again.
 * Answers how many were held (0 when nothing was).
 */
export async function holdRenewalCredits(params: {
  readonly userId: string
  /** Stripe's subscription id. */
  readonly subscriptionId: string
  /** The subscription's current period start, from the event. */
  readonly periodStart: string | null
}): Promise<number> {
  if (!params.periodStart) return 0
  const { data, error } = await supabase.rpc("hold_subscription_renewal_credits", {
    p_user_id: params.userId,
    p_stripe_subscription_id: params.subscriptionId,
    p_period_start: params.periodStart,
  })
  if (error) retryOn(error, `renewal hold for subscription ${params.subscriptionId}`, "hold_subscription_renewal_credits")

  const held = typeof data === "number" ? data : 0
  if (held <= 0) return 0
  invalidateBalanceCache(params.userId)
  await CreditsService.logTransaction({
    userId: params.userId,
    amount: -held,
    creditType: "subscription",
    source: "subscription_renewal",
    description: `Renewal payment failed: ${held} subscription credits on hold until it is paid`,
    balanceAfter: 0,
  })
  console.log(`[stripe] subscription.updated: renewal payment failed, ${held} credits on hold: user=${params.userId} sub=${params.subscriptionId}`)
  return held
}

export type RenewalSettlement =
  /** The held amount came back. */
  | { readonly kind: "released"; readonly credits: number; readonly balance: number }
  /** A period never reset was set to the plan's allocation. */
  | { readonly kind: "renewed"; readonly credits: number; readonly tier: string }
  /** Recorded, nothing given: the normal case, an older period, an ended or never-granted subscription, a hold for another period dropped (logged). */
  | { readonly kind: "recorded" }
  /** This invoice was settled already (a redelivery). */
  | { readonly kind: "replay" }
  /** No such profile or subscription: nothing recorded. */
  | { readonly kind: "unknown" }

/**
 * `invoice.paid` for a renewal invoice: record it, and release or catch up
 * the period's credits, through one database function. Nothing is written
 * before the database answers, so one that could not answer asks Stripe for
 * the event again (StripeEventRetryError); Stripe redelivers for up to three
 * days, and production always has the migration before its code.
 */
export async function settlePaidRenewal(params: {
  readonly userId: string
  readonly subscriptionId: string
  readonly invoiceId: string
  readonly amountPaidCents: number
  readonly lines: readonly RenewalInvoiceLine[]
  readonly storedTier: string | null
}): Promise<RenewalSettlement> {
  const period = renewalPeriodFromLines(params.lines, params.subscriptionId, params.storedTier)
  if (!period) {
    console.warn(`[stripe] invoice.paid: renewal invoice ${params.invoiceId} has no line for subscription ${params.subscriptionId}; recorded, nothing released`)
  }
  const { data, error } = await supabase.rpc("release_subscription_renewal_credits", {
    p_user_id: params.userId,
    p_stripe_subscription_id: params.subscriptionId,
    p_invoice_id: params.invoiceId,
    p_period_start: period?.periodStart ?? null,
    p_period_end: period?.periodEnd ?? null,
    p_credits: period?.credits ?? 0,
    p_amount_usd: Math.max(0, Number.isFinite(params.amountPaidCents) ? params.amountPaidCents : 0) / 100,
    p_tier: period?.tier ?? params.storedTier,
  })
  if (error) retryOn(error, `settling renewal invoice ${params.invoiceId}`, "release_subscription_renewal_credits")

  const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string; credits?: number; balance?: number } | null
  const credits = row?.credits ?? 0
  if (row?.outcome === "released" && credits > 0) {
    const balance = row.balance ?? credits
    invalidateBalanceCache(params.userId)
    await CreditsService.logTransaction({
      userId: params.userId,
      amount: credits,
      creditType: "subscription",
      source: "subscription_renewal",
      description: `Renewal paid: ${credits} subscription credits released`,
      balanceAfter: balance,
    })
    console.log(`[stripe] invoice.paid: renewal paid, ${credits} held credits released: user=${params.userId} invoice=${params.invoiceId}`)
    return { kind: "released", credits, balance }
  }
  if (row?.outcome === "renewed" && credits > 0 && period?.tier) {
    invalidateBalanceCache(params.userId)
    await CreditsService.logTransaction({
      userId: params.userId,
      amount: credits,
      creditType: "subscription",
      source: "subscription_renewal",
      description: `Subscription renewal: ${period.tier} tier (credits reset to ${credits})`,
      balanceAfter: credits,
    })
    console.log(
      `[stripe] invoice.paid: renewal of a period never reset, credits reset to ${credits}: user=${params.userId} invoice=${params.invoiceId}` +
        (period.fromStoredTier ? " (tier from the stored subscription: no line named a known plan)" : ""),
    )
    return { kind: "renewed", credits, tier: period.tier }
  }
  if (row?.outcome === "dropped") {
    console.warn(
      `[stripe] invoice.paid: renewal invoice ${params.invoiceId} paid, but its subscription held ${credits} credits for another period; that hold was dropped: user=${params.userId} sub=${params.subscriptionId}`,
    )
    return { kind: "recorded" }
  }
  if (row?.outcome === "replay") return { kind: "replay" }
  if (row?.outcome === "unknown") return { kind: "unknown" }
  return { kind: "recorded" }
}
