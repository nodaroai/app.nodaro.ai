/**
 * Credits for a plan change: granted by the paid invoice, once, as a gap.
 *
 * A move to a higher plan is invoiced at once (`POST /v1/billing/change-plan`
 * sends `proration_behavior: "always_invoice"` with
 * `payment_behavior: "pending_if_incomplete"`, so Stripe applies the new price
 * only when that invoice is paid). The credits follow the PAYMENT, never the
 * price change: the paid invoice (`billing_reason = subscription_update`)
 * adds the gap between the plan the account already held this credit period
 * and the plan it now pays for, through `grant_plan_change_credits`
 * (migration 600), keyed by the invoice id. The route (which may see the
 * payment first) and the `invoice.paid` webhook both call it; whichever comes
 * second, and every replay, is a no-op.
 *
 * The plans are read from the invoice's own lines: a charged line names the
 * plan paid for, a credited line ("unused time on …") a plan held. An earlier
 * downgrade's pending prorations are swept into the same invoice, so the
 * highest credited plan is the floor, and the period's recorded peak (the
 * database's side) keeps a move down and back up from granting twice.
 *
 * A downgrade moves no credits; `notePlanCreditPeak` records the plan being
 * left so a later upgrade in the same period starts from it.
 *
 * A paid invoice of 0 (a 100%-off coupon, a balance that covered it) grants
 * nothing. A monthly <-> yearly switch, which restarts Stripe's billing period
 * part-way through, starts a new credit period with no grant
 * (`restartPlanCreditPeriod`).
 */
import type Stripe from "stripe"
import { supabase } from "../../lib/supabase.js"
import { isMissingFunctionError } from "../../lib/postgrest-errors.js"
import { getStripe } from "./stripe-client.js"
import { PRICE_TO_PLAN, TIER_CREDITS } from "./stripe-config.js"
import { invalidateBalanceCache } from "./balance-cache.js"

/** One invoice line, reduced to what sizes a plan-change grant. */
export interface InvoicePriceLine {
  readonly priceId: string
  /** Signed, in the invoice currency's minor unit: > 0 charged, < 0 credited. */
  readonly amount: number
}

export interface PlanChange {
  /** The plan the invoice charges for (the highest one, by credits). */
  readonly toTier: string
  readonly toCredits: number
  /** The highest plan the invoice credits back (0 when none is named). */
  readonly fromCredits: number
}

/**
 * The plan change an invoice's lines describe, or null when no charged line
 * names a subscription plan (nothing to grant).
 */
export function planChangeFromLines(lines: readonly InvoicePriceLine[]): PlanChange | null {
  let to: { tier: string; credits: number } | null = null
  let fromCredits = 0
  for (const line of lines) {
    const plan = PRICE_TO_PLAN[line.priceId]
    if (!plan) continue
    const credits = TIER_CREDITS[plan.plan]
    if (credits === undefined) continue
    if (line.amount > 0) {
      if (!to || credits > to.credits) to = { tier: plan.plan, credits }
    } else if (line.amount < 0) {
      fromCredits = Math.max(fromCredits, credits)
    }
  }
  return to ? { toTier: to.tier, toCredits: to.credits, fromCredits } : null
}

function linePriceId(line: Stripe.InvoiceLineItem): string | null {
  const price = line.pricing?.price_details?.price
  if (!price) return null
  return typeof price === "string" ? price : price.id
}

/**
 * Every priced line of an invoice. A webhook payload carries only the first
 * page of lines; the rest are read from Stripe.
 */
export async function invoicePriceLines(invoice: Stripe.Invoice): Promise<InvoicePriceLine[]> {
  let lines: Stripe.InvoiceLineItem[] = invoice.lines?.data ?? []
  if (invoice.lines?.has_more) {
    const all: Stripe.InvoiceLineItem[] = []
    let startingAfter: string | undefined
    for (;;) {
      const page: Stripe.ApiList<Stripe.InvoiceLineItem> = await getStripe().invoices.listLineItems(invoice.id, {
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      all.push(...page.data)
      if (!page.has_more || page.data.length === 0) break
      startingAfter = page.data[page.data.length - 1].id
    }
    lines = all
  }
  const out: InvoicePriceLine[] = []
  for (const line of lines) {
    const priceId = linePriceId(line)
    if (priceId) out.push({ priceId, amount: line.amount ?? 0 })
  }
  return out
}

export interface PlanChangeGrant {
  /** False when this invoice was already granted (a replay). */
  readonly claimed: boolean
  readonly credits: number
}

/**
 * Grant the credits a PAID plan-change invoice buys. The caller has checked
 * that the invoice is paid and is a `subscription_update`. Returns null when
 * nothing was attempted (no plan on the invoice, or the database does not
 * have migration 600 yet) or the grant failed; a failure is logged and
 * leaves nothing committed, so a webhook replay grants it later.
 */
export async function grantPaidPlanChange(params: {
  readonly userId: string
  readonly invoiceId: string
  readonly lines: readonly InvoicePriceLine[]
  readonly amountPaidCents: number
}): Promise<PlanChangeGrant | null> {
  // Credits follow money: an invoice that charged nothing (a 100%-off
  // coupon, or a balance that covered it) buys no credits.
  if (!(params.amountPaidCents > 0)) {
    console.warn(`[stripe] plan change: invoice ${params.invoiceId} was paid with 0, nothing granted`)
    return null
  }

  const change = planChangeFromLines(params.lines)
  if (!change) {
    console.warn(`[stripe] plan change: invoice ${params.invoiceId} names no plan on a charged line, nothing granted`)
    return null
  }

  const { data, error } = await supabase.rpc("grant_plan_change_credits", {
    p_user_id: params.userId,
    p_invoice_id: params.invoiceId,
    p_from_credits: change.fromCredits,
    p_to_credits: change.toCredits,
    p_amount_usd: Math.max(0, params.amountPaidCents) / 100,
    p_tier: change.toTier,
  })
  if (error) {
    if (isMissingFunctionError(error)) {
      console.error(`[stripe] plan change: grant_plan_change_credits is not in the database yet, invoice ${params.invoiceId} not granted`)
    } else {
      console.error(`[stripe] plan change: grant failed for invoice ${params.invoiceId}:`, error.message)
    }
    return null
  }

  const row = (Array.isArray(data) ? data[0] : data) as { claimed?: boolean; granted_credits?: number } | null
  const result: PlanChangeGrant = { claimed: row?.claimed === true, credits: row?.granted_credits ?? 0 }
  if (!result.claimed) {
    console.log(`[stripe] plan change: invoice ${params.invoiceId} already granted, skipping`)
    return result
  }
  invalidateBalanceCache(params.userId)
  console.log(
    `[stripe] plan change: user=${params.userId} invoice=${params.invoiceId} ${change.toTier} +${result.credits} credits`,
  )
  return result
}

/**
 * Record that the account held a plan worth `credits` this credit period, so
 * a later upgrade inside the period grants only above it. Best effort: a
 * failure is logged, never thrown (the change itself already happened).
 */
export async function notePlanCreditPeak(userId: string, credits: number): Promise<void> {
  if (!Number.isFinite(credits) || credits <= 0) return
  const { error } = await supabase.rpc("note_plan_credit_peak", { p_user_id: userId, p_credits: credits })
  if (error) {
    if (isMissingFunctionError(error)) {
      console.warn("[stripe] plan change: note_plan_credit_peak is not in the database yet")
    } else {
      console.error(`[stripe] plan change: noting the period's plan failed for user=${userId}:`, error.message)
    }
  }
}

/**
 * Stripe restarted the billing period part-way through the current one (a
 * monthly <-> yearly switch). The current credit period has already granted
 * its credits, so this starts the next one with none: it stamps the reset and
 * carries the period's peak over (`restart_plan_credit_period`, migration
 * 600). The next real renewal, or a yearly plan's next monthly grant, sets
 * the plan's credits as usual. Best effort, like notePlanCreditPeak.
 */
export async function restartPlanCreditPeriod(userId: string, heldCredits: number): Promise<void> {
  const { error } = await supabase.rpc("restart_plan_credit_period", {
    p_user_id: userId,
    p_held_credits: Math.max(0, Number.isFinite(heldCredits) ? heldCredits : 0),
  })
  if (error) {
    if (isMissingFunctionError(error)) {
      console.warn("[stripe] plan change: restart_plan_credit_period is not in the database yet")
    } else {
      console.error(`[stripe] plan change: restarting the credit period failed for user=${userId}:`, error.message)
    }
  }
}
