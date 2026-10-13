import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { UgcEstimateUnavailable, estimateUgcRun, quoteUgcTickets } from "../lib/ugc-estimate.js"
import { UgcQuoteError } from "../lib/ugc-quote.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"
import type { PluginUgcPlanLineLimits } from "../../lib/private-plugins/types.js"

const isLimit = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x > 0

/**
 * The plan's line limits the plugin hands the app (its own schema's), for the estimate's answer:
 * all three whole numbers of characters, or none. An older plugin has none; one that fails to give
 * them never stops the estimate.
 */
function planLineLimits(): PluginUgcPlanLineLimits | undefined {
  try {
    const raw: unknown = getPluginServices().ugc?.planLineLimits?.()
    if (!raw || typeof raw !== "object") return undefined
    const { hook, beatLine, closerLine } = raw as Record<string, unknown>
    return isLimit(hook) && isLimit(beatLine) && isLimit(closerLine) ? { hook, beatLine, closerLine } : undefined
  } catch {
    return undefined
  }
}

const NOT_SERVED = "UGC videos are a Nodaro Cloud feature and are not served on this deployment."

const body = z.union([
  z.object({ tickets: z.array(z.unknown()).min(1).max(11), hasCards: z.boolean() }).strict(),
  z.object({
    estimate: z.object({
      targetDurationSec: z.number().int().min(4).max(300),
      screenshotCount: z.number().int().min(0).max(8),
      source: z.enum(["sampled", "photo"]),
      // The run draws every creator option for a person to pick (an editor run): price them all. Off: the primary alone.
      rendersEveryCandidate: z.boolean().optional(),
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
      if ("tickets" in parsed.data) return await quoteUgcTickets(caller, parsed.data.tickets, parsed.data.hasCards)
      // The plugin's estimate input is the graph's; how many options the run draws is the pricer's to know.
      const { rendersEveryCandidate = false, ...input } = parsed.data.estimate
      const estimate = await estimateUgcRun(caller, input, { rendersEveryCandidate })
      // The plan's line limits ride along: the script editor's limits, never a copy in the app.
      const limits = planLineLimits()
      return limits ? { ...estimate, limits } : estimate
    } catch (err) {
      if (err instanceof UgcEstimateUnavailable) return reply.status(503).send({ error: { code: "not_available", message: NOT_SERVED } })
      if (err instanceof UgcQuoteError) return reply.status(422).send({ error: { code: "unpriceable", message: err.message } })
      throw err
    }
  })
}
