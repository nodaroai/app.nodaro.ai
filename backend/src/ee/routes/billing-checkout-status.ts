import type { FastifyInstance, FastifyRequest } from "fastify"
import { CHECKOUT_SESSION_NOT_FOUND, readCheckoutStatus } from "../billing/checkout-status.js"
import { rejectProgrammaticAuth } from "../../lib/api-auth-mode.js"
import { rateLimitAddressKey } from "../../lib/client-address.js"
import { BILLING_JWT_ONLY_MSG } from "./billing.js"

/**
 * Status reads per account per minute. Each read is one Stripe call; 60 a
 * minute covers a page polling no faster than every 1.5 s, with room to
 * spare for a reload or a second tab. Keyed after the auth hook
 * (`preHandler`) on the account, so a fresh session token opens no new bucket.
 */
export const CHECKOUT_STATUS_PER_MINUTE = 60

export const CHECKOUT_STATUS_RATE_LIMIT = {
  rateLimit: {
    max: CHECKOUT_STATUS_PER_MINUTE,
    timeWindow: "1 minute",
    hook: "preHandler" as const,
    keyGenerator: (req: FastifyRequest) =>
      req.userId ? `checkout-status:user:${req.userId}` : `checkout-status:ip:${rateLimitAddressKey(req)}`,
  },
}

/**
 * `GET /v1/billing/checkout-session/:sessionId`: whether the caller's own
 * Checkout session's purchase has been granted. A signed-in session only.
 * Not gated on self-serve: reading one's own session is harmless, creating
 * one is gated.
 */
export async function billingCheckoutStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    "/v1/billing/checkout-session/:sessionId",
    { config: CHECKOUT_STATUS_RATE_LIMIT },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: "Authentication required" })
      }
      if (rejectProgrammaticAuth(req, reply, BILLING_JWT_ONLY_MSG)) return

      reply.header("Cache-Control", "no-store")
      try {
        const status = await readCheckoutStatus(userId, req.params.sessionId)
        if (!status) return reply.status(404).send(CHECKOUT_SESSION_NOT_FOUND)
        return reply.send({ data: status })
      } catch (err) {
        console.error("[billing] Failed to read a checkout session:", (err as Error).message)
        return reply.status(500).send({ error: "Failed to read the checkout session" })
      }
    },
  )
}
