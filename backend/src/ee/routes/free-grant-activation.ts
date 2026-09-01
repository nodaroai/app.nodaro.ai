import type { FastifyInstance } from "fastify"
import { createHash } from "node:crypto"
import { z } from "zod"
import type Stripe from "stripe"
import { supabase } from "../../lib/supabase.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { formatZodError } from "../../lib/zod-error.js"
import { getStripe } from "../billing/stripe-client.js"
import { ensureStripeCustomer } from "../billing/provision-credits.js"
import { activateSignupGrant, readFreeGrantState } from "../billing/signup-grant.js"

/**
 * Free-credit abuse gate: the way OUT of 'withheld', for the user.
 *
 * A withheld account activates its grant by adding a payment method. Nothing
 * is charged — it is a Stripe Checkout session in `setup` mode, a $0
 * SetupIntent behind a hosted page — and what it buys the platform is the
 * card's FINGERPRINT: the one signal in the system that is deterministic
 * across accounts. `free_grant_activations` holds each fingerprint (hashed)
 * under a UNIQUE index, so a card activates exactly one account, ever. That
 * enforcement is the point; collecting the card without it would let one real
 * card unlock every farmed account.
 *
 * The flow is synchronous on the return leg rather than webhook-driven: the
 * success URL carries the session id back to /billing, the client posts it
 * here, and this route verifies the session against Stripe directly. The
 * existing webhook ignores setup-mode sessions, so nothing else reacts.
 */

const ACTIVATION_PURPOSE = "free_grant_activation"

const activateBody = z.object({
  sessionId: z.string().min(1).max(200),
})

function getOrigin(req: { headers: Record<string, string | string[] | undefined> }): string {
  const origin = req.headers.origin
  const referer = req.headers.referer
  if (typeof origin === "string" && origin) return origin
  if (typeof referer === "string" && referer) {
    try { return new URL(referer).origin } catch { /* fall through */ }
  }
  return ""
}

/** The user's personal Stripe customer, created on first need (same shape as billing.ts). */
async function ensurePersonalCustomer(userId: string): Promise<string> {
  const { data: existing } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .single()
  if (existing?.stripe_customer_id) return existing.stripe_customer_id as string

  const { data: profile } = await supabase.from("profiles").select("email").eq("id", userId).single()
  const customer = await getStripe().customers.create({
    email: profile?.email ?? undefined,
    metadata: { userId },
  })
  await ensureStripeCustomer(customer.id, userId)
  return customer.id
}

/** Stripe's fingerprint is already opaque; hashing keeps the row a pure uniqueness token. */
export function hashCardFingerprint(fingerprint: string): string {
  return createHash("sha256").update(fingerprint).digest("hex")
}

/**
 * The card fingerprint proven by a completed setup session that belongs to
 * `userId`, or a reason it cannot be used.
 */
export function extractActivationCard(
  session: Stripe.Checkout.Session,
  userId: string,
): { ok: true; fingerprint: string; setupIntentId: string } | { ok: false; code: string; message: string } {
  if (session.metadata?.purpose !== ACTIVATION_PURPOSE || session.metadata?.userId !== userId) {
    return { ok: false, code: "session_mismatch", message: "This checkout session does not belong to this account" }
  }
  if (session.mode !== "setup" || session.status !== "complete") {
    return { ok: false, code: "session_incomplete", message: "The payment method was not saved" }
  }
  const setupIntent = session.setup_intent
  if (!setupIntent || typeof setupIntent === "string" || setupIntent.status !== "succeeded") {
    return { ok: false, code: "session_incomplete", message: "The payment method was not saved" }
  }
  const pm = setupIntent.payment_method
  const fingerprint = pm && typeof pm !== "string" ? pm.card?.fingerprint : undefined
  if (!fingerprint) {
    return { ok: false, code: "card_required", message: "A card is required to activate free credits" }
  }
  return { ok: true, fingerprint, setupIntentId: setupIntent.id }
}

export async function freeGrantActivationRoutes(app: FastifyInstance) {
  /**
   * POST /v1/credits/free-grant/activation-session
   * A hosted Stripe page that saves a card and charges nothing.
   */
  app.post(
    "/v1/credits/free-grant/activation-session",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      try {
        const state = await readFreeGrantState(userId)
        if (state !== "withheld") {
          return reply.status(400).send({
            error: { code: "not_withheld", message: "Free credits are not pending activation on this account" },
          })
        }

        const customer = await ensurePersonalCustomer(userId)
        const baseUrl = getOrigin(req)
        const session = await getStripe().checkout.sessions.create({
          mode: "setup",
          customer,
          payment_method_types: ["card"],
          metadata: { userId, purpose: ACTIVATION_PURPOSE },
          success_url: `${baseUrl}/billing?activate_grant={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/billing`,
        })
        return { data: { url: session.url } }
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to start activation")
      }
    },
  )

  /**
   * POST /v1/credits/free-grant/activate  { sessionId }
   * Verifies the completed setup session with Stripe and activates the grant
   * when the card has never activated another account.
   */
  app.post(
    "/v1/credits/free-grant/activate",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      const parsed = activateBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", message: formatZodError(parsed.error) } })
      }

      try {
        const state = await readFreeGrantState(userId)
        if (state === "granted") return { state: "granted", activated: false }
        if (state !== "withheld") {
          return reply.status(400).send({
            error: { code: "not_withheld", message: "Free credits are not pending activation on this account" },
          })
        }

        const session = await getStripe().checkout.sessions.retrieve(parsed.data.sessionId, {
          expand: ["setup_intent.payment_method"],
        })
        const card = extractActivationCard(session, userId)
        if (!card.ok) {
          return reply.status(400).send({ error: { code: card.code, message: card.message } })
        }

        const fingerprintHash = hashCardFingerprint(card.fingerprint)

        // ONE CARD, ONE GRANT. Look before inserting so the same user retrying
        // with the same card is idempotent, and another user's card is a
        // clean refusal rather than a constraint error.
        const { data: holder, error: holderError } = await supabase
          .from("free_grant_activations")
          .select("user_id")
          .eq("card_fingerprint_hash", fingerprintHash)
          .maybeSingle()
        if (holderError) return sendInternalError(reply, req, holderError, "Failed to activate free credits")

        if (holder && holder.user_id !== userId) {
          return reply.status(409).send({
            error: { code: "card_already_used", message: "This card has already activated free credits on another account" },
          })
        }
        if (!holder) {
          const { error: insertError } = await supabase.from("free_grant_activations").insert({
            user_id: userId,
            card_fingerprint_hash: fingerprintHash,
            stripe_customer_id: typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
            stripe_setup_intent_id: card.setupIntentId,
          })
          if (insertError) {
            // A race on the unique index: someone else's activation landed first.
            if ((insertError as { code?: string }).code === "23505") {
              return reply.status(409).send({
                error: { code: "card_already_used", message: "This card has already activated free credits on another account" },
              })
            }
            return sendInternalError(reply, req, insertError, "Failed to activate free credits")
          }
        }

        const result = await activateSignupGrant(userId, "Free signup grant (activated with a payment method)")
        req.log.info({ userId, activated: result.activated }, "free grant activated by card")
        return { state: result.state, activated: result.activated }
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to activate free credits")
      }
    },
  )
}
