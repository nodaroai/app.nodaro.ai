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
 */

import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { getStripe } from "./stripe-client.js"
import { creditsForLoadUsd, LOAD_CURRENCY, MIN_LOAD_USD, MAX_LOAD_USD } from "./load-rate.js"

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
        currency: LOAD_CURRENCY,
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
