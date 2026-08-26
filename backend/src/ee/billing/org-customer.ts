/**
 * The ORGANIZATION side of Stripe (E2/P13): the org-owned customer, the pack
 * checkout, the grant on settlement, and the refund/dispute clawback router.
 *
 * DELIBERATELY A SIBLING of `resolveUserId` / `ensureStripeCustomer`, never an
 * extension of them (design audit billing-m05): those carry a metadata
 * fallback and a personal-customer upsert that ASSUME a user — inheriting
 * them would mint a spurious user-owned `stripe_customers` row for an org
 * checkout. Everything here answers the org question only, and the personal
 * paths in `provision-credits.ts` are untouched.
 *
 * Money movement itself lives in SQL (migration 351):
 *   grant_org_credits_idempotent — exactly once per external id
 *   claw_back_org_credits        — floored at zero, idempotent per event
 * This module decides WHICH of the two worlds an event belongs to and relays.
 */
import { supabase } from "../../lib/supabase.js"
import { appBaseUrl } from "../../lib/deployment-urls.js"
import { getStripe } from "./stripe-client.js"
import { getOrgPack } from "./stripe-config.js"
import { captureReceiptUrl, handleTopupClawback, type TopupClawbackData } from "./provision-credits.js"

export type Payer = { kind: "user"; id: string } | { kind: "org"; id: string }

/**
 * Who owns this Stripe customer — a user or an organization. NULL when the
 * customer is unknown to us. The `stripe_customers_one_owner` CHECK
 * (migration 351) guarantees exactly one of the two columns is set.
 */
export async function resolvePayer(stripeCustomerId: string): Promise<Payer | null> {
  const { data } = await supabase
    .from("stripe_customers")
    .select("user_id, org_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle()
  if (!data) return null
  if (data.org_id) return { kind: "org", id: data.org_id as string }
  if (data.user_id) return { kind: "user", id: data.user_id as string }
  return null
}

/**
 * The org's Stripe customer, created on first need. Concurrency-safe through
 * the partial unique index `uq_stripe_customers_org`: the loser of a create
 * race re-reads the winner's row and abandons its own Stripe customer (an
 * orphaned Stripe-side customer is inert; a second DB row would not be).
 */
export async function ensureOrgStripeCustomer(orgId: string, actorUserId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("org_id", orgId)
    .maybeSingle()
  if (existing?.stripe_customer_id) return existing.stripe_customer_id as string

  const { data: org } = await supabase
    .from("organizations")
    .select("name, slug")
    .eq("id", orgId)
    .maybeSingle()
  if (!org) throw new Error(`ensureOrgStripeCustomer: no organization ${orgId}`)

  const customer = await getStripe().customers.create({
    name: org.name as string,
    description: `Nodaro organization ${org.slug as string}`,
    metadata: { orgId, createdByUserId: actorUserId },
  })

  const { error } = await supabase
    .from("stripe_customers")
    .insert({ org_id: orgId, user_id: null, stripe_customer_id: customer.id })
  if (error) {
    // ONLY a unique violation means "lost the race" (the partial unique index
    // kept exactly one row) — then the winner's row is the answer. Any other
    // failure (connection, CHECK) must throw as itself, not be misread as a
    // race and answered with a possibly-absent row.
    if (error.code === "23505") {
      const { data: winner } = await supabase
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("org_id", orgId)
        .maybeSingle()
      if (winner?.stripe_customer_id) return winner.stripe_customer_id as string
    }
    throw new Error(`ensureOrgStripeCustomer: insert failed: ${error.message}`)
  }
  return customer.id
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A settled org pack checkout → the pool, exactly once (the transactions
 * claim row is keyed by the payment intent, same mutex as the personal
 * grant). Returns false on a replay, an unknown pack, or a session whose
 * evidence does not hold together — every refusal is logged loudly rather
 * than thrown, because throwing inside a webhook makes Stripe redeliver an
 * event that can never succeed.
 *
 * Metadata never stands alone (second-review finding, mirroring the personal
 * handler's own rule at provision-credits.ts): the pack's price id must
 * appear in the session's REAL line items, and the session's customer must
 * be the customer this org owns (`resolvePayer`). `p_amount_usd` records
 * what actually SETTLED — a discounted purchase must claw back against the
 * discounted price, not the catalog price, or every partial refund of a
 * promo purchase under-claws.
 */
export async function handleOrgPackCompleted(data: {
  orgId: string
  packId: string
  /** payment_intent when present, else the session id — the idempotency key. */
  transactionId: string
  /** The session's customer — must resolve to this very org. */
  stripeCustomerId: string | null
  /** `session.amount_total`: the settled price in cents (0 for a 100%-off promo). */
  amountTotalCents: number
  /** The session's real line items — the pack's priceId must be among them. */
  lineItems: Array<{ priceId: string }>
}): Promise<boolean> {
  const pack = getOrgPack(data.packId)
  if (!pack) {
    console.error(`[org-billing] checkout completed for unknown packId "${data.packId}" (org ${data.orgId}) — NOT granted`)
    return false
  }
  if (!UUID_RE.test(data.orgId)) {
    console.error(`[org-billing] checkout completed with a non-uuid orgId "${data.orgId}" — NOT granted`)
    return false
  }
  if (!data.lineItems.some((li) => li.priceId === pack.priceId)) {
    console.error(
      `[org-billing] session line items ${JSON.stringify(data.lineItems)} do not carry pack "${data.packId}"'s price — NOT granted`,
    )
    return false
  }
  const payer = data.stripeCustomerId ? await resolvePayer(data.stripeCustomerId) : null
  if (payer?.kind !== "org" || payer.id !== data.orgId) {
    console.error(
      `[org-billing] metadata orgId ${data.orgId} does not own customer ${data.stripeCustomerId ?? "<none>"} — NOT granted`,
    )
    return false
  }
  const { data: granted, error } = await supabase.rpc("grant_org_credits_idempotent", {
    p_org_id: data.orgId,
    p_credits: pack.credits,
    p_external_id: data.transactionId,
    p_source: "org_purchase",
    p_amount_usd: Math.max(0, data.amountTotalCents) / 100,
  })
  if (error) throw new Error(`grant_org_credits_idempotent failed: ${error.message}`)
  if (granted === true) void captureReceiptUrl(data.transactionId)
  return granted === true
}

/**
 * Refunds and disputes: ONE router in front of the two clawback worlds.
 *
 * The claim row written at grant time decides — `transactions.org_id IS NOT
 * NULL` routes to `claw_back_org_credits` (pool, floored at zero); anything
 * else falls through to the UNCHANGED personal `handleTopupClawback`, which
 * joins on the user's own grant claim (design audit billing-07/H23: the
 * personal path joins `transactions.user_id` and must never see an org row).
 *
 * Credits are clawed proportionally to the refunded cents, clamped to the
 * grant — a partial refund takes a partial clawback, a redelivery is a no-op
 * inside the RPC.
 */
export async function routeClawback(data: TopupClawbackData): Promise<void> {
  if (data.paymentIntentId) {
    const { data: tx, error: lookupError } = await supabase
      .from("transactions")
      .select("org_id, credits_granted, amount_usd")
      .eq("stripe_transaction_id", data.paymentIntentId)
      .maybeSingle()
    if (lookupError) {
      // 42703 = the org_id column has not reached this database yet (351
      // applies on the next promotion). No org claim row can exist there, so
      // the personal path is the ONLY correct route — falling through keeps
      // pre-351 refunds working exactly as before this router existed.
      if (lookupError.code === "42703") {
        await handleTopupClawback(data)
        return
      }
      // Any other failure: REFUSE to route — never guess. The org claim row
      // is `type='topup'` with the OWNER's user_id, so falling through here
      // would let the personal clawback find it and debit the owner's own
      // pools for the organization's refund (second-review finding). Stripe
      // redelivers the event; the retry routes with real data.
      console.error(
        `[org-billing] clawback routing lookup failed for ${data.paymentIntentId} — refusing to route: ${lookupError.message}`,
      )
      return
    }
    if (tx?.org_id) {
      const grantedCredits = Number(tx.credits_granted ?? 0)
      const grantedCents = Math.round(Number(tx.amount_usd ?? 0) * 100)
      for (const refund of data.refunds) {
        if (grantedCents <= 0) {
          // A $0-settled grant (100%-off promo) has nothing refundable; a
          // refund event against it is noise. Never "claw everything" as a
          // fallback for missing price data.
          console.error(
            `[org-billing] refund ${refund.refundId} against zero-settled grant ${data.paymentIntentId} — nothing clawed`,
          )
          continue
        }
        const credits = Math.min(grantedCredits, Math.round((grantedCredits * refund.amountCents) / grantedCents))
        if (credits <= 0) continue
        const { error } = await supabase.rpc("claw_back_org_credits", {
          p_org_id: tx.org_id as string,
          p_amount: credits,
          p_stripe_event_id: refund.refundId,
        })
        if (error) throw new Error(`claw_back_org_credits failed: ${error.message}`)
      }
      return
    }
  }
  await handleTopupClawback(data)
}

/**
 * A Stripe Checkout session for one org pack. Same fixed price the personal
 * ladder sells; the metadata is what the webhook branches on. Lands the buyer
 * back on the generic completion page — the org billing console is P16.
 */
export async function createOrgPackCheckout(
  orgId: string,
  actorUserId: string,
  packId: string,
): Promise<{ url: string } | null> {
  const pack = getOrgPack(packId)
  if (!pack) return null
  const customerId = await ensureOrgStripeCustomer(orgId, actorUserId)
  const base = appBaseUrl()
  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [{ price: pack.priceId, quantity: 1 }],
    metadata: { payerKind: "org", orgId, packId, actorUserId },
    success_url: `${base}/checkout-complete?status=success`,
    cancel_url: `${base}/checkout-complete?status=cancelled`,
  })
  if (!session.url) throw new Error("Stripe returned a checkout session with no url")
  return { url: session.url }
}

/** The Stripe customer portal for the org's customer (receipts, invoices). */
export async function getOrgCustomerPortalUrl(orgId: string): Promise<{ url: string } | null> {
  const { data: customer } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("org_id", orgId)
    .maybeSingle()
  if (!customer?.stripe_customer_id) return null
  const { data: org } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", orgId)
    .maybeSingle()
  const base = appBaseUrl()
  const portal = await getStripe().billingPortal.sessions.create({
    customer: customer.stripe_customer_id as string,
    return_url: org?.slug ? `${base}/org/${org.slug as string}` : base,
  })
  return { url: portal.url }
}
