/**
 * Paddle Webhook Handler
 *
 * POST /v1/billing/paddle-webhook
 *
 * Receives Paddle webhook events, verifies signatures, and dispatches
 * to the appropriate credit provisioning handler.
 * Uses a scoped content-type parser to capture the raw body for
 * signature verification without affecting other routes.
 */

import type { FastifyInstance, FastifyRequest } from "fastify"
import { paddle } from "../billing/paddle-client.js"
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionCanceled,
  handleTransactionCompleted,
  updateSubscriptionStatus,
  resolveUserId,
} from "../billing/provision-credits.js"
import { EventName } from "@paddle/paddle-node-sdk"

const WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET ?? ""

export async function paddleWebhookRoutes(app: FastifyInstance) {
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

  app.post("/v1/billing/paddle-webhook", async (req, reply) => {
    const rawBody = (req as unknown as Record<string, unknown>).rawBody as string | undefined
    const signature = req.headers["paddle-signature"] as string | undefined

    if (!rawBody || !signature) {
      console.warn("[paddle-webhook] Missing raw body or paddle-signature header")
      return reply.status(400).send({ error: "Missing signature" })
    }

    // Verify webhook signature
    let event
    try {
      event = await paddle.webhooks.unmarshal(rawBody, WEBHOOK_SECRET, signature)
    } catch (err) {
      console.error("[paddle-webhook] Signature verification failed:", (err as Error).message)
      return reply.status(401).send({ error: "Invalid signature" })
    }

    const eventType = event.eventType
    console.log(`[paddle-webhook] Received: ${eventType} (event=${event.eventId})`)

    try {
      switch (eventType) {
        case EventName.SubscriptionCreated: {
          const sub = event.data as PaddleSubscriptionData
          const priceId = sub.items?.[0]?.price?.id ?? ""
          await handleSubscriptionCreated({
            subscriptionId: sub.id,
            paddleCustomerId: sub.customerId,
            priceId,
            status: sub.status,
            currentPeriodStart: sub.currentBillingPeriod?.startsAt ?? null,
            currentPeriodEnd: sub.currentBillingPeriod?.endsAt ?? null,
            customData: sub.customData as Record<string, unknown> | null,
          })
          break
        }

        case EventName.SubscriptionUpdated: {
          const sub = event.data as PaddleSubscriptionData
          const priceId = sub.items?.[0]?.price?.id ?? ""
          await handleSubscriptionUpdated({
            subscriptionId: sub.id,
            paddleCustomerId: sub.customerId,
            priceId,
            status: sub.status,
            currentPeriodStart: sub.currentBillingPeriod?.startsAt ?? null,
            currentPeriodEnd: sub.currentBillingPeriod?.endsAt ?? null,
            customData: sub.customData as Record<string, unknown> | null,
          })
          break
        }

        case EventName.SubscriptionCanceled: {
          const sub = event.data as PaddleSubscriptionData
          await handleSubscriptionCanceled({
            subscriptionId: sub.id,
            paddleCustomerId: sub.customerId,
            currentPeriodEnd: sub.currentBillingPeriod?.endsAt ?? null,
            customData: sub.customData as Record<string, unknown> | null,
          })
          break
        }

        case EventName.SubscriptionPastDue: {
          const sub = event.data as PaddleSubscriptionData
          const userId = await resolveUserId(
            sub.customerId,
            sub.customData as Record<string, unknown> | null
          )
          console.warn(`[paddle-webhook] subscription.past_due: user=${userId} sub=${sub.id}`)
          await updateSubscriptionStatus(sub.id, "past_due")
          break
        }

        case EventName.SubscriptionPaused: {
          const sub = event.data as PaddleSubscriptionData
          await updateSubscriptionStatus(sub.id, "paused")
          break
        }

        case EventName.SubscriptionResumed: {
          const sub = event.data as PaddleSubscriptionData
          await updateSubscriptionStatus(sub.id, "active")
          break
        }

        case EventName.TransactionCompleted: {
          const tx = event.data as PaddleTransactionData
          await handleTransactionCompleted({
            transactionId: tx.id,
            paddleCustomerId: tx.customerId ?? null,
            subscriptionId: tx.subscriptionId ?? null,
            items: (tx.items ?? []).map((item: PaddleTransactionItem) => ({
              priceId: item.price?.id ?? "",
            })),
            totalAmount: tx.details?.totals?.total
              ? Number(tx.details.totals.total)
              : 0,
            customData: tx.customData as Record<string, unknown> | null,
          })
          break
        }

        case EventName.TransactionPaymentFailed: {
          const tx = event.data as PaddleTransactionData
          const userId = tx.customerId
            ? await resolveUserId(
                tx.customerId,
                tx.customData as Record<string, unknown> | null
              )
            : null
          console.error(
            `[paddle-webhook] transaction.payment_failed: user=${userId} tx=${tx.id}`
          )
          break
        }

        default:
          console.log(`[paddle-webhook] Unhandled event type: ${eventType}`)
      }
    } catch (err) {
      console.error(`[paddle-webhook] Error processing ${eventType}:`, (err as Error).message)
    }

    // Always return 200 to acknowledge receipt (Paddle retries on non-2xx)
    return reply.status(200).send({ received: true })
  })
}

// ── Minimal type shapes for Paddle event data ────────────────────
// These match the SDK notification entity fields we access.

interface PaddleTimePeriod {
  readonly startsAt?: string
  readonly endsAt?: string
}

interface PaddlePrice {
  readonly id: string
}

interface PaddleSubscriptionItem {
  readonly price: PaddlePrice | null
}

interface PaddleSubscriptionData {
  readonly id: string
  readonly status: string
  readonly customerId: string
  readonly currentBillingPeriod: PaddleTimePeriod | null
  readonly items: PaddleSubscriptionItem[]
  readonly customData: unknown
}

interface PaddleTransactionItem {
  readonly price: PaddlePrice | null
}

interface PaddleTransactionTotals {
  readonly total: string
}

interface PaddleTransactionDetails {
  readonly totals: PaddleTransactionTotals | null
}

interface PaddleTransactionData {
  readonly id: string
  readonly customerId: string | null
  readonly subscriptionId: string | null
  readonly items: PaddleTransactionItem[]
  readonly details: PaddleTransactionDetails | null
  readonly customData: unknown
}
