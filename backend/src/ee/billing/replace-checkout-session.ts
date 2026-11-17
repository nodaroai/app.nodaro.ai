/**
 * The Checkout session a new one replaces, so one purchase never has two
 * payable sessions at once (for example an embedded form given up for the
 * Checkout page).
 *
 * The rule: the named session is read first, and only when it is the caller's
 * own. A session that is complete (paid, or paying by a method that settles
 * later) or whose payment has been submitted is never replaced. A session
 * that is open and not being paid is expired just before the new one is
 * created; expiring it cancels its payment, so nothing finished in it later
 * can charge. A payment that is waiting for the person (a card challenge
 * nobody can finish any more, say) is expired rather than waited on, so
 * nobody is kept from paying. When Stripe refuses the expire, the session is
 * read again and classified; an open session is never taken as safe to
 * replace. Any other failure throws, and nothing new is created.
 */

import Stripe from "stripe"
import type { FastifyReply } from "fastify"
import { getStripe } from "./stripe-client.js"
import { CHECKOUT_SESSION_NOT_FOUND, retrieveOwnSession } from "./checkout-status.js"

/** What the read expands: the payment of a pack or a load, the subscription of a plan. */
export const REPLACE_EXPAND = ["payment_intent", "subscription"] as const

/** A plan session's subscription in one of these has been paid for. */
export const SUBSCRIPTION_PAID: ReadonlySet<Stripe.Subscription.Status> = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
])

/** A pack or load session's payment in one of these has been submitted. */
export const PAYMENT_UNDER_WAY: ReadonlySet<Stripe.PaymentIntent.Status> = new Set<Stripe.PaymentIntent.Status>([
  "processing",
  "requires_capture",
  "succeeded",
])

/**
 * Whether the session's payment has been submitted (a pack or a load) or its
 * subscription paid for (a plan). Reads the expanded objects; a bare id,
 * which the read never leaves unexpanded, reads as not under way.
 */
export function paymentUnderWay(session: Stripe.Checkout.Session): boolean {
  if (session.mode === "payment") {
    const intent = session.payment_intent
    return typeof intent === "object" && intent !== null && PAYMENT_UNDER_WAY.has(intent.status)
  }
  if (session.mode === "subscription") {
    const subscription = session.subscription
    return typeof subscription === "object" && subscription !== null && SUBSCRIPTION_PAID.has(subscription.status)
  }
  return false
}

export type ReplacedSession =
  | { kind: "not-found" }
  | { kind: "complete" }
  | { kind: "under-way" }
  | { kind: "expired" }
  | { kind: "open" }

/**
 * The named session, classified: `not-found` when it is not the caller's own
 * pack, load or plan session; `complete`; `expired`; `under-way` when it is
 * open and its payment submitted; else `open`, to be expired before the new
 * one is created. Throws on a Stripe or database failure.
 */
export async function readReplacedSession(userId: string, sessionId: string): Promise<ReplacedSession> {
  const session = await retrieveOwnSession(userId, sessionId, REPLACE_EXPAND)
  if (!session) return { kind: "not-found" }
  // Stripe's `null` status reads `open`, as the status read reads it.
  const status = session.status ?? "open"
  if (status === "complete") return { kind: "complete" }
  if (status === "expired") return { kind: "expired" }
  if (paymentUnderWay(session)) return { kind: "under-way" }
  return { kind: "open" }
}

/**
 * Expires a session `readReplacedSession` read as `open`. When Stripe refuses
 * (it completed, or its payment started, in between), the session is read
 * again: `complete`; `expired` (or gone); and one still open is `under-way`.
 * Any other failure throws.
 */
export async function expireReplacedSession(
  userId: string,
  sessionId: string,
): Promise<"expired" | "complete" | "under-way"> {
  try {
    await getStripe().checkout.sessions.expire(sessionId)
    return "expired"
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err
  }
  const session = await retrieveOwnSession(userId, sessionId, REPLACE_EXPAND)
  if (!session) return "expired"
  const status = session.status ?? "open"
  if (status === "complete") return "complete"
  if (status === "expired") return "expired"
  return "under-way"
}

export type ReplacementRefusal = "not-found" | "complete" | "under-way"

interface RefusalBody {
  readonly error: { readonly code: string; readonly message: string }
}

const REFUSALS: Record<ReplacementRefusal, { status: 404 | 409; body: RefusalBody }> = {
  // The status read's own 404 body, the same object.
  "not-found": { status: 404, body: CHECKOUT_SESSION_NOT_FOUND },
  complete: {
    status: 409,
    body: {
      error: {
        code: "checkout_already_complete",
        message: "This purchase has already been paid. Nothing new was started.",
      },
    },
  },
  "under-way": {
    status: 409,
    body: {
      error: {
        code: "checkout_in_progress",
        message: "The payment for this purchase is still being confirmed. Nothing new was started.",
      },
    },
  },
}

/** The answer a create route gives when the session it was asked to replace may not be replaced. */
export function replacementRefusal(kind: ReplacementRefusal): { status: 404 | 409; body: RefusalBody } {
  return REFUSALS[kind]
}

type Refusal = ReturnType<typeof replacementRefusal>

/**
 * A create route's first step for `replacesSessionId`, before its own checks
 * that touch the database: the refusal to answer, or the session to expire
 * just before the create (`null` when it has expired already). Throws on a
 * Stripe or database failure.
 */
export async function startReplacement(
  userId: string,
  sessionId: string,
): Promise<{ refusal: Refusal } | { expire: string | null }> {
  const replaced = await readReplacedSession(userId, sessionId)
  if (replaced.kind === "expired") return { expire: null }
  if (replaced.kind === "open") return { expire: sessionId }
  return { refusal: replacementRefusal(replaced.kind) }
}

/** `beginReplacement` sent the route's answer itself: the route returns. */
export const REPLACEMENT_HANDLED = "handled"

/**
 * A create route's first step for `replacesSessionId`, as one call: reads and
 * classifies the session and, when it may not be replaced, sends the refusal
 * (or, on a Stripe or database failure, the route's own 500 with
 * `failureMessage`) on `reply` and answers `REPLACEMENT_HANDLED`. Otherwise
 * it answers the session to expire just before the create (`null`: none).
 */
export async function beginReplacement(
  userId: string,
  sessionId: string,
  reply: FastifyReply,
  failureMessage: string,
): Promise<typeof REPLACEMENT_HANDLED | { expire: string | null }> {
  let start: Awaited<ReturnType<typeof startReplacement>>
  try {
    start = await startReplacement(userId, sessionId)
  } catch (err) {
    console.error("[billing] Failed to read the checkout session being replaced:", (err as Error).message)
    reply.status(500).send({ error: failureMessage })
    return REPLACEMENT_HANDLED
  }
  if ("expire" in start) return start
  reply.status(start.refusal.status).send(start.refusal.body)
  return REPLACEMENT_HANDLED
}

/**
 * A create route's last step before the create, for a session
 * `startReplacement` left to expire: `null` once it has expired, else the
 * refusal to answer. Throws on any other Stripe failure.
 */
export async function finishReplacement(userId: string, sessionId: string): Promise<Refusal | null> {
  const outcome = await expireReplacedSession(userId, sessionId)
  return outcome === "expired" ? null : replacementRefusal(outcome)
}
