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
  handleInvoicePaid,
  resolveUserId,
} from "../billing/provision-credits.js"
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
  // Override JSON parser in this plugin scope to capture raw body
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
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session
          if (session.mode === "payment") {
            // One-time payment (top-up)
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
