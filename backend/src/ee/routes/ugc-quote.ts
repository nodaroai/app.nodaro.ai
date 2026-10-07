import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { UgcEstimateUnavailable, estimateUgcRun, quoteUgcTickets } from "../lib/ugc-estimate.js"
import { UgcQuoteError } from "../lib/ugc-quote.js"

const NOT_SERVED = "UGC videos are a Nodaro Cloud feature and are not served on this deployment."

const body = z.union([
  z.object({ tickets: z.array(z.unknown()).min(1).max(11), hasCards: z.boolean() }).strict(),
  z.object({
    estimate: z.object({
      targetDurationSec: z.number().int().min(4).max(300),
      screenshotCount: z.number().int().min(0).max(8),
      source: z.enum(["sampled", "photo"]),
    }).strict(),
  }).strict(),
])

/** The canvas UGC Clips quote and the free dry-run estimate (Nodaro Cloud). */
export async function ugcQuoteRoutes(app: FastifyInstance) {
  app.post("/v1/ugc/quote", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const parsed = body.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "invalid body" } })
    }
    // req.billingContext: the payer the billing hook resolved for this request (the one the reservations will use).
    const caller = { userId: req.userId, billingContext: req.billingContext }
    try {
      return "tickets" in parsed.data
        ? await quoteUgcTickets(caller, parsed.data.tickets, parsed.data.hasCards)
        : await estimateUgcRun(caller, parsed.data.estimate)
    } catch (err) {
      if (err instanceof UgcEstimateUnavailable) return reply.status(503).send({ error: { code: "not_available", message: NOT_SERVED } })
      if (err instanceof UgcQuoteError) return reply.status(422).send({ error: { code: "unpriceable", message: err.message } })
      throw err
    }
  })
}
