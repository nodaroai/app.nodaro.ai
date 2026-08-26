/**
 * Stripe Webhook Handler
 *
 * POST /v1/billing/stripe-webhook
 *
 * Receives Stripe webhook events, verifies signatures, and dispatches
 * to the appropriate credit provisioning handler.
 * Uses a scoped content-type parser to capture the raw body for
 * signature verification without affecting other routes.
 */

import type { FastifyInstance, FastifyRequest } from "fastify"
import { getStripe } from "../billing/stripe-client.js"
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionCanceled,
  handleTransactionCompleted,
  handleAutoRechargeSucceeded,
  handleAutoRechargeFailed,
  handleInvoicePaid,
  resolveUserId,
} from "../billing/provision-credits.js"
import { handleOrgPackCompleted, routeClawback } from "../billing/org-customer.js"
import { config } from "../../lib/config.js"
import type Stripe from "stripe"

const WEBHOOK_SECRET = config.STRIPE_WEBHOOK_SECRET

/** Extract current billing period dates from Stripe SDK v20 SubscriptionItem. */
function extractSubscriptionPeriod(sub: Stripe.Subscription): { periodStart: string; periodEnd: string | null } {
  const item = sub.items.data[0]
  return {
    periodStart: item
      ? new Date(item.current_period_start * 1000).toISOString()
      : new Date(sub.start_date * 1000).toISOString(),
    periodEnd: item
      ? new Date(item.current_period_end * 1000).toISOString()
      : null,
  }
}

export async function stripeWebhookRoutes(app: FastifyInstance) {
  // Override JSON parser in this plugin scope to capture raw body.
  // The root scope installs a CUSTOM application/json parser
  // (lib/tolerant-json-parser.ts), and Fastify treats an inherited custom
  // parser as "already present" even across encapsulation — adding without
  // removing first throws FST_ERR_CTP_ALREADY_PRESENT at boot. The removal is
  // scoped to this plugin; root routes keep the tolerant parser.
  app.removeContentTypeParser("application/json")
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req: FastifyRequest, body: string, done: (err: Error | null, result?: unknown) => void) => {
      ;(_req as unknown as Record<string, unknown>).rawBody = body
      try {
        done(null, JSON.parse(body))
      } catch (err) {
        done(err as Error)
      }
    }
  )

  app.post("/v1/billing/stripe-webhook", async (req, reply) => {
    const rawBody = (req as unknown as Record<string, unknown>).rawBody as string | undefined
    const signature = req.headers["stripe-signature"] as string | undefined

    if (!rawBody || !signature) {
      console.warn("[stripe-webhook] Missing raw body or stripe-signature header")
      return reply.status(400).send({ error: "Missing signature" })
    }

    if (!WEBHOOK_SECRET) {
      console.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured — rejecting webhook")
      return reply.status(500).send({ error: "Webhook secret not configured" })
    }

    // Verify webhook signature
    let event: Stripe.Event
    try {
      event = getStripe().webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET)
    } catch (err) {
      console.error("[stripe-webhook] Signature verification failed:", (err as Error).message)
      return reply.status(401).send({ error: "Invalid signature" })
    }

    console.log(`[stripe-webhook] Received: ${event.type} (event=${event.id})`)

    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
          const session = event.data.object as Stripe.Checkout.Session
          // One-time payment (top-up). Only grant once funds have SETTLED: card
          // pays "paid" on `completed`; async methods (bank debit / some wallets)
          // fire `completed` with payment_status "unpaid"/"processing" and settle
          // later via `async_payment_succeeded`. Granting on an unsettled
          // `completed` would hand out credits a later payment failure can't claw
          // back. "no_payment_required" (100%-off promo) is treated as settled to
          // preserve the prior coupon behavior. The idempotency mutex
          // (transactionId = payment_intent) makes the two events grant exactly once.
          const settled =
            session.payment_status === "paid" ||
            session.payment_status === "no_payment_required"
          // An ORGANIZATION pack (E2/P13): the org-owned customer bought a
          // prepaid pack. Branch BEFORE the personal handler — resolveUserId's
          // metadata fallback and customer upsert assume a person and would
          // mint a spurious user row for an org checkout (billing-m05). Same
          // settlement gate as the personal path, same payment-intent
          // idempotency mutex, different ledger.
          if (session.mode === "payment" && settled && session.metadata?.payerKind === "org") {
            // Metadata only NAMES the org and pack — the grant is verified
            // against the session's REAL line items and the customer's owner
            // row inside the handler (metadata never sizes or authorizes a
            // grant, same rule as the personal path).
            await handleOrgPackCompleted({
              orgId: session.metadata.orgId ?? "",
              packId: session.metadata.packId ?? "",
              transactionId: (session.payment_intent as string) ?? session.id,
              stripeCustomerId: (session.customer as string | null) ?? null,
              amountTotalCents: session.amount_total ?? 0,
              lineItems: await getSessionLineItems(session.id),
            })
            break
          }
          if (session.mode === "payment" && settled) {
            await handleTransactionCompleted({
              transactionId: (session.payment_intent as string) ?? session.id,
              stripeCustomerId: session.customer as string | null,
              subscriptionId: null,
              lineItems: await getSessionLineItems(session.id),
              totalAmount: session.amount_total ?? 0,
              metadata: session.metadata ?? null,
            })
          }
          // subscription mode: handled by customer.subscription.created
          break
        }

        case "customer.subscription.created": {
          const sub = event.data.object as Stripe.Subscription
          const { periodStart, periodEnd } = extractSubscriptionPeriod(sub)
          await handleSubscriptionCreated({
            subscriptionId: sub.id,
            stripeCustomerId: sub.customer as string,
            priceId: sub.items.data[0]?.price?.id ?? "",
            status: sub.status,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            metadata: sub.metadata ?? null,
          })
          break
        }

        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription
          const { periodStart, periodEnd } = extractSubscriptionPeriod(sub)
          await handleSubscriptionUpdated({
            subscriptionId: sub.id,
            stripeCustomerId: sub.customer as string,
            priceId: sub.items.data[0]?.price?.id ?? "",
            status: sub.status,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
            cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
            canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
            metadata: sub.metadata ?? null,
          })
          break
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription
          const periodEnd = sub.ended_at
            ? new Date(sub.ended_at * 1000).toISOString()
            : new Date().toISOString()
          await handleSubscriptionCanceled({
            subscriptionId: sub.id,
            stripeCustomerId: sub.customer as string,
            currentPeriodEnd: periodEnd,
            metadata: sub.metadata ?? null,
          })
          break
        }

        case "charge.refunded": {
          // Top-up refund clawback (payg NET lifetime, design §4.1a). The
          // grant claim is keyed by payment_intent, so the join is direct.
          // Each refund in the charge is claimed individually by its own id —
          // redeliveries and multiple partial refunds all converge to
          // exactly-once per refund.
          const charge = event.data.object as Stripe.Charge
          let refunds = (charge.refunds?.data ?? [])
            .filter((r) => typeof r.id === "string" && (r.amount ?? 0) > 0)
            .map((r) => ({ refundId: r.id, amountCents: r.amount }))
          // Modern Stripe API versions (2022-11-15+, incl. clover) omit the
          // embedded refunds list from charge payloads — the first live
          // refund arrived with refunds: null and the clawback silently
          // no-oped (soak catch, 2026-08-12). Fetch the real refund rows so
          // each claims idempotently by its own id.
          if (refunds.length === 0 && (charge.amount_refunded ?? 0) > 0) {
            const listed = await getStripe().refunds.list({ charge: charge.id, limit: 100 })
            refunds = listed.data
              .filter((r) => (r.amount ?? 0) > 0 && r.status !== "failed")
              .map((r) => ({ refundId: r.id, amountCents: r.amount }))
          }
          await routeClawback({
            paymentIntentId: (charge.payment_intent as string) ?? null,
            refunds,
          })
          break
        }

        case "charge.dispute.funds_withdrawn": {
          // Chargeback: funds left our account — claw the credits back now.
          // Idempotent per dispute id (same claim mechanism as refunds).
          const dispute = event.data.object as Stripe.Dispute
          await routeClawback({
            paymentIntentId: (dispute.payment_intent as string) ?? null,
            refunds: [{ refundId: dispute.id, amountCents: dispute.amount ?? 0 }],
          })
          break
        }

        case "payment_intent.succeeded": {
          // Auto-recharge grants ONLY (kind gate) — checkout-created PIs are
          // granted by checkout.session.completed; entering here would
          // double-grant (regression-tested).
          const pi = event.data.object as Stripe.PaymentIntent
          if (pi.metadata?.kind === "auto_recharge") {
            await handleAutoRechargeSucceeded({
              piId: pi.id,
              userId: pi.metadata.userId ?? null,
              amountReceivedCents: pi.amount_received ?? 0,
            })
          }
          break
        }

        case "payment_intent.payment_failed": {
          const pi = event.data.object as Stripe.PaymentIntent
          if (pi.metadata?.kind === "auto_recharge") {
            await handleAutoRechargeFailed({ userId: pi.metadata.userId ?? null })
          }
          break
        }

        case "invoice.paid": {
          const invoice = event.data.object as Stripe.Invoice
          const subDetails = invoice.parent?.subscription_details
          if (subDetails) {
            await handleInvoicePaid({
              invoiceId: invoice.id,
              subscriptionId: subDetails.subscription as string,
              stripeCustomerId: invoice.customer as string,
              amountPaid: invoice.amount_paid,
              metadata: subDetails.metadata ?? null,
            })
          }
          break
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice
          const customerId = invoice.customer as string
          const subDetails = invoice.parent?.subscription_details
          const userId = await resolveUserId(customerId, subDetails?.metadata ?? null)
          console.warn(
            `[stripe-webhook] invoice.payment_failed: user=${userId} invoice=${invoice.id}`
          )
          break
        }

        default:
          console.log(`[stripe-webhook] Unhandled event type: ${event.type}`)
      }
    } catch (err) {
      console.error(`[stripe-webhook] Error processing ${event.type}:`, (err as Error).message)
    }

    // Always return 200 to acknowledge receipt (Stripe retries on non-2xx)
    return reply.status(200).send({ received: true })
  })
}

/** Retrieve line items from a checkout session for top-up credit resolution. */
async function getSessionLineItems(sessionId: string): Promise<Array<{ priceId: string }>> {
  try {
    const lineItems = await getStripe().checkout.sessions.listLineItems(sessionId, { limit: 10 })
    return lineItems.data.map((item) => ({
      priceId: item.price?.id ?? "",
    }))
  } catch {
    return []
  }
}
