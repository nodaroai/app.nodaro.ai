/**
 * Auto-recharge — "when my balance drops below X credits, load $Y".
 *
 * Fire-and-forget: `void attemptAutoRecharge(userId)` is hooked at the end
 * of every successful credit reservation (all THREE reserve sites — the
 * CreditsService entry point and both direct pipeline RPC callers; commits
 * only ever refund surplus upward, so threshold crossings happen at
 * reserve time only). The whole path is best-effort — a failure here must
 * never fail the reservation that triggered it.
 *
 * Concurrency: there is deliberately NO queue (BullMQ's fixed-jobId +
 * removeOnComplete dedupe trap — repo-documented — would fire once per
 * user, ever). The atomic `claim_auto_recharge` RPC is the only
 * concurrency mechanism: one conditional UPDATE carrying the enabled
 * check, failure gate (<3), 10-minute cooldown, and the attempt-time
 * daily cap (3/day). Exactly one concurrent caller wins.
 *
 * Exclusions: operations attributable to third-party OAuth apps never
 * trigger (a compromised execute-scoped app must not be able to pump the
 * owner's card) — threaded via reserve options as `skipAutoRecharge`.
 * The same exclusion is the extension point for Phase 4's instance
 * credentials.
 *
 * Kill switch: `AUTO_RECHARGE_ENABLED` env (default off). Webhook
 * provisioning stays on regardless so in-flight PaymentIntents settle.
 *
 * Which account a reservation may recharge is decided ONLY by
 * `autoRechargeTargetFor` below — every reserve site asks it rather than
 * deciding inline (guarded by auto-recharge-sites.test.ts).
 */

import { supabase } from "../../lib/supabase.js"
import type { BillingContext } from "../../lib/billing-context.js"
import { config } from "../../lib/config.js"
import { getStripe } from "./stripe-client.js"
import { creditsForLoadUsd, MIN_LOAD_USD, MAX_LOAD_USD } from "./load-rate.js"

/**
 * The account a successful reservation may auto-recharge, or null for none.
 *
 * - PERSONAL payer: the requester — their own balance dropped, their own card.
 * - WORKSPACE payer: never. The member's personal balance did not move, and
 *   class work must never charge a member's saved card.
 * - DEPLOYMENT payer: the payer account — the balance that dropped is the
 *   payer's — but ONLY when the context carries `autoRecharge: true`, which
 *   the resolve point stamps for an in-app session alone (JWT, no third-party
 *   app). Fail-closed: API tokens, webhook / schedule / telegram triggers,
 *   internal loopbacks and every lane that never learns how the work was
 *   started carry no stamp, so no unscoped credential can drive the payer's
 *   card. A balance such traffic lowers still recharges on the next in-app
 *   reservation — the threshold check reads the balance, not who spent it.
 */
export function autoRechargeTargetFor(requesterId: string, ctx: BillingContext | undefined): string | null {
  if (ctx?.payer === "workspace") return null
  if (ctx?.payer === "deployment") return ctx.autoRecharge === true ? ctx.payerId : null
  return requesterId
}

/** Read-only auto-recharge status for one account (billing surfaces). */
export interface AutoRechargeStatus {
  /** The account's own switch. */
  enabled: boolean
  /** Whether a charge can actually fire now: the account's switch, the
   *  instance kill switch, a complete config and fewer than 3 failures. */
  active: boolean
  thresholdCredits: number | null
  amountUsd: number | null
  failureCount: number
  lastAttemptAt: string | null
}

/**
 * The status as `attemptAutoRecharge` would see it. A FAILED READ ANSWERS
 * NULL — "unknown right now", never "off": a status line on top of a balance
 * must not take the balance down with it.
 */
export async function readAutoRechargeStatus(userId: string): Promise<AutoRechargeStatus | null> {
  const { data: p, error } = await supabase
    .from("profiles")
    .select(
      "auto_recharge_enabled, auto_recharge_threshold_credits, auto_recharge_amount_usd, auto_recharge_failure_count, auto_recharge_last_attempt_at"
    )
    .eq("id", userId)
    .maybeSingle()
  if (error || !p) {
    if (error) console.error("[auto-recharge] status read failed:", userId, error.message)
    return null
  }
  const enabled = p.auto_recharge_enabled === true
  const thresholdCredits = typeof p.auto_recharge_threshold_credits === "number" ? p.auto_recharge_threshold_credits : null
  const amountUsd = typeof p.auto_recharge_amount_usd === "number" ? p.auto_recharge_amount_usd : null
  const failureCount = p.auto_recharge_failure_count ?? 0
  return {
    enabled,
    active:
      enabled &&
      config.AUTO_RECHARGE_ENABLED === true &&
      thresholdCredits !== null &&
      amountUsd !== null &&
      failureCount < 3,
    thresholdCredits,
    amountUsd,
    failureCount,
    lastAttemptAt: p.auto_recharge_last_attempt_at ?? null,
  }
}

export async function attemptAutoRecharge(userId: string): Promise<void> {
  try {
    if (!config.AUTO_RECHARGE_ENABLED) return

    // Cheap precheck (read-only) before touching the claim row: most calls
    // exit here. The claim RPC re-verifies everything atomically.
    const { data: p } = await supabase
      .from("profiles")
      .select(
        "auto_recharge_enabled, auto_recharge_threshold_credits, auto_recharge_amount_usd, auto_recharge_failure_count, subscription_credits, topup_credits"
      )
      .eq("id", userId)
      .single()
    if (!p || !p.auto_recharge_enabled) return
    if ((p.auto_recharge_failure_count ?? 0) >= 3) return
    const threshold = p.auto_recharge_threshold_credits
    const amountUsd = p.auto_recharge_amount_usd
    if (!threshold || !amountUsd) return
    const balance = (p.subscription_credits ?? 0) + (p.topup_credits ?? 0)
    if (balance >= threshold) return
    if (amountUsd < MIN_LOAD_USD || amountUsd > MAX_LOAD_USD) return

    // Atomic claim — loses cleanly on cooldown / daily cap / concurrent race.
    const { data: claim, error: claimError } = await supabase.rpc("claim_auto_recharge", {
      p_user_id: userId,
    })
    if (claimError || !claim || (Array.isArray(claim) && claim.length === 0)) return
    const claimedUsd = Array.isArray(claim)
      ? ((claim[0] as { amount_usd: number })?.amount_usd ?? amountUsd)
      : amountUsd

    await chargeForRecharge(userId, claimedUsd)
  } catch (err) {
    // Best-effort by contract — never propagate into the reserve path.
    console.error("[auto-recharge] attempt failed:", userId, err instanceof Error ? err.message : err)
  }
}

async function chargeForRecharge(userId: string, amountUsd: number): Promise<void> {
  const { data: cust } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .single()

  if (!cust?.stripe_customer_id) {
    // No Stripe customer at all → no PI will ever exist → record locally.
    await recordFailureNoWebhook(userId, "no stripe customer")
    return
  }

  const stripe = getStripe()
  let paymentMethod: string | null = null
  try {
    const customer = await stripe.customers.retrieve(cust.stripe_customer_id)
    if (!("deleted" in customer && customer.deleted)) {
      const def = (customer as { invoice_settings?: { default_payment_method?: string | { id: string } | null } })
        .invoice_settings?.default_payment_method
      paymentMethod = typeof def === "string" ? def : (def?.id ?? null)
    }
    if (!paymentMethod) {
      const pms = await stripe.paymentMethods.list({
        customer: cust.stripe_customer_id,
        type: "card",
        limit: 1,
      })
      paymentMethod = pms.data[0]?.id ?? null
    }
  } catch (err) {
    await recordFailureNoWebhook(userId, `payment method lookup: ${(err as Error).message}`)
    return
  }

  if (!paymentMethod) {
    // Saved-card capture piggybacks on load checkouts (setup_future_usage);
    // until one happens there is nothing to charge — count it as a failure
    // so the config surface tells the user to make one manual load.
    await recordFailureNoWebhook(userId, "no saved payment method")
    return
  }

  const credits = creditsForLoadUsd(amountUsd)
  // Receipt destination (Billing-UX): per-PI receipt_email makes Stripe mail
  // the charge receipt for every auto-recharge, matching manual loads.
  const { data: emailRow } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single()
  try {
    await stripe.paymentIntents.create(
      {
        customer: cust.stripe_customer_id,
        amount: amountUsd * 100,
        currency: "usd",
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        ...(emailRow?.email ? { receipt_email: emailRow.email } : {}),
        metadata: {
          userId,
          kind: "auto_recharge",
          loadUsd: String(amountUsd),
          credits: String(credits),
        },
      },
      { idempotencyKey: `ar_${userId}_${Date.now()}` }
    )
    console.log(`[auto-recharge] charged user=${userId} $${amountUsd} (${credits} credits pending webhook)`)
  } catch (err) {
    const hasPi = Boolean((err as { payment_intent?: unknown }).payment_intent)
    if (!hasPi) {
      // No PI was created — no payment_failed webhook will ever come.
      await recordFailureNoWebhook(userId, `charge create: ${(err as Error).message}`)
    }
    // With a PI: Stripe fires payment_intent.payment_failed → the webhook
    // records the failure (single writer for PI-backed attempts).
  }
}

async function recordFailureNoWebhook(userId: string, reason: string): Promise<void> {
  console.warn(`[auto-recharge] failure (no webhook will follow): user=${userId} — ${reason}`)
  const { error } = await supabase.rpc("record_auto_recharge_failure", { p_user_id: userId })
  if (error) {
    console.error("[auto-recharge] failure recording failed:", userId, error.message)
  }
}
