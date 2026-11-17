/**
 * The Checkout session a new one replaces, so one purchase never has two
 * payable sessions at once (for example an embedded form given up for the
 * Checkout page).
 *
 * The rule: the named session is read first, and only when it is the caller's
 * own and of the same purchase as the request (the same plan checkout, pack
 * or load amount); any other reads as a session that does not exist, and is
 * left as it is. A session that is complete (paid, or paying by a method that settles
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
import {
  checkoutSessionState,
  PAYMENT_UNDER_WAY,
  paymentUnderWay,
  REPLACE_EXPAND,
  SUBSCRIPTION_PAID,
} from "./checkout-session-state.js"

export { PAYMENT_UNDER_WAY, paymentUnderWay, REPLACE_EXPAND, SUBSCRIPTION_PAID }

/**
 * What the request that names a session to replace is buying, in the terms
 * the create routes store on a session: a plan (a subscription session), a
 * pack (its price id), a load (its whole-dollar amount).
 */
export type ReplacingPurchase =
  | { readonly kind: "plan" }
  | { readonly kind: "pack"; readonly priceId: string }
  | { readonly kind: "load"; readonly amountUsd: number }

/**
 * Whether `session` is of the purchase the request makes, from its `mode`
 * and the metadata its create route stored: a plan's session is a
 * subscription session (no plan price is stored on it, so the mode decides);
 * a pack's is a payment session with the pack's price as `topupPriceId`; a
 * load's is a payment session of `kind: "load"` with the amount as `loadUsd`.
 */
export function samePurchase(session: Stripe.Checkout.Session, purchase: ReplacingPurchase): boolean {
  if (purchase.kind === "plan") return session.mode === "subscription"
  if (session.mode !== "payment") return false
  const metadata = session.metadata ?? {}
  const isLoad = metadata.kind === "load"
  if (purchase.kind === "load") return isLoad && metadata.loadUsd === String(purchase.amountUsd)
  return !isLoad && metadata.topupPriceId === purchase.priceId
}

export type ReplacedSession =
  | { kind: "not-found" }
  | { kind: "complete" }
  | { kind: "under-way" }
  | { kind: "expired" }
  | { kind: "open" }

/**
 * The named session, classified: `not-found` when it is not the caller's own
 * pack, load or plan session, or is of another purchase than `purchase`
 * (whatever state it is in); `complete`; `expired`; `under-way` when it is
 * open and its payment submitted; else `open`, to be expired before the new
 * one is created. Throws on a Stripe or database failure.
 */
export async function readReplacedSession(
  userId: string,
  sessionId: string,
  purchase: ReplacingPurchase,
): Promise<ReplacedSession> {
  const session = await retrieveOwnSession(userId, sessionId, REPLACE_EXPAND)
  if (!session) return { kind: "not-found" }
  if (!samePurchase(session, purchase)) return { kind: "not-found" }
  return { kind: checkoutSessionState(session) }
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
  purchase: ReplacingPurchase,
): Promise<{ refusal: Refusal } | { expire: string | null }> {
  const replaced = await readReplacedSession(userId, sessionId, purchase)
  if (replaced.kind === "expired") return { expire: null }
  if (replaced.kind === "open") return { expire: sessionId }
  return { refusal: replacementRefusal(replaced.kind) }
}

/** `beginReplacement` sent the route's answer itself: the route returns. */
export const REPLACEMENT_HANDLED = "handled"

/**
 * A create route's first step for `replacesSessionId`, as one call: reads and
 * classifies the session against the `purchase` the request makes and, when
 * it may not be replaced, sends the refusal
 * (or, on a Stripe or database failure, the route's own 500 with
 * `failureMessage`) on `reply` and answers `REPLACEMENT_HANDLED`. Otherwise
 * it answers the session to expire just before the create (`null`: none).
 */
export async function beginReplacement(
  userId: string,
  sessionId: string,
  purchase: ReplacingPurchase,
  reply: FastifyReply,
  failureMessage: string,
): Promise<typeof REPLACEMENT_HANDLED | { expire: string | null }> {
  let start: Awaited<ReturnType<typeof startReplacement>>
  try {
    start = await startReplacement(userId, sessionId, purchase)
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
