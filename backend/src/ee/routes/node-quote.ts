import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../../lib/openapi-registry.js"
import { formatZodError } from "../../lib/zod-error.js"
import { deniedModelRejectionMessage, isModelDenied } from "../../lib/surface-deny.js"
import { EMPTY_PRICE_NOTES, type PriceNotes } from "../../lib/price-notes.js"
import type { RoutePricing } from "../../middleware/credit-guard.js"
import { handlePriceNotConfigured, markedUpCredits, reservedCreditsFor } from "../lib/credit-guard-impl.js"
import { textToVideoBody, textToVideoPricing } from "../../routes/text-to-video.js"
import { generateVideoBody, generateVideoPricing } from "../../routes/generate-video.js"
import { videoToVideoBody, videoToVideoPricing } from "../../routes/video-to-video.js"
import { videoUpscaleBody, videoUpscalePricing } from "../../routes/video-upscale.js"

const ROUTE = "/v1/quote"

/**
 * The node types a quote can price, each with the run route's OWN body schema
 * and pricing chain (exported by the route and registered there as its
 * preHandlers). Nothing here prices anything itself: a quote is the run's
 * pricing, run without the job.
 */
export const QUOTABLE_NODE_TYPES: Readonly<Record<string, { readonly schema: z.ZodTypeAny; readonly pricing: RoutePricing }>> = {
  "text-to-video": { schema: textToVideoBody, pricing: textToVideoPricing },
  "generate-video": { schema: generateVideoBody, pricing: generateVideoPricing },
  "video-to-video": { schema: videoToVideoBody, pricing: videoToVideoPricing },
  "video-upscale": { schema: videoUpscaleBody, pricing: videoUpscalePricing },
}

const quoteBody = z.object({
  /** The node type, as `nodes.run(type, …)` takes it. */
  type: z.string().min(1).max(64),
  /** Exactly the body the run route would receive. */
  params: z.record(z.string(), z.unknown()).default({}),
})

const quoteResponse = z.object({
  identifier: z.string(),
  reserve: z.number(),
  expected: z.number().optional(),
  adjustments: z.array(z.object({ code: z.string(), message: z.string(), credits: z.number().optional() })),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
})

/**
 * `POST /v1/quote` — the price of a run before it starts. Runs the target
 * route's own chain on the same body: its Zod body, its pre-checks (the
 * reference-clip length gate, whose probe also prices the run), its credit
 * identifier and `computeCredits`, then the reservation's own lookup
 * (`reservedCreditsFor`, shared with the credit guard). No job is created and
 * nothing is reserved.
 */
export function registerNodeQuote(app: FastifyInstance): void {
  openApiRegistry.registerPath({
    method: "post",
    path: ROUTE,
    description:
      "The credits a node run would reserve, and what it is expected to cost, without starting it. " +
      "Send the node type and exactly the body you would send to its run route. " +
      `Priceable types: ${Object.keys(QUOTABLE_NODE_TYPES).join(", ")}.`,
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: quoteBody } } } },
    responses: {
      200: { description: "The quote", content: { "application/json": { schema: z.object({ data: quoteResponse }) } } },
      400: { description: "Invalid body (the run route's own 400), or a node type that cannot be quoted" },
    },
  })

  app.post("/v1/quote", {
    // A quote may ffprobe the request's reference clips and costs nothing.
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = quoteBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const { type, params } = parsed.data
    const entry = Object.prototype.hasOwnProperty.call(QUOTABLE_NODE_TYPES, type) ? QUOTABLE_NODE_TYPES[type] : undefined
    if (!entry) {
      return reply.status(400).send({
        error: {
          code: "quote_unsupported",
          message: `"${type}" cannot be quoted yet. Quotable: ${Object.keys(QUOTABLE_NODE_TYPES).join(", ")}.`,
          supported: Object.keys(QUOTABLE_NODE_TYPES),
        },
      })
    }
    // A model this deployment does not offer is refused as the run refuses it.
    const provider = typeof params.provider === "string" ? params.provider : undefined
    if (provider && isModelDenied(provider)) {
      return reply.status(403).send({ error: { code: "model_not_available", message: deniedModelRejectionMessage([provider]) } })
    }
    // The run answers an invalid body with this same 400.
    const valid = entry.schema.safeParse(params)
    if (!valid.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(valid.error) } })
    }

    // From here on the request IS the run's: its pre-checks and pricing read
    // the raw body, exactly as the run route's preHandlers do.
    req.body = params
    req.priceNotes = EMPTY_PRICE_NOTES
    for (const precheck of entry.pricing.prechecks) {
      await precheck(req, reply)
      if (reply.sent) return reply
    }
    try {
      const identifier = entry.pricing.modelResolver(req)
      const reserve = await reservedCreditsFor(req, identifier, entry.pricing.opts)
      return { data: await quoteFrom(identifier, reserve, req.priceNotes ?? EMPTY_PRICE_NOTES, req.videoNorm?.adjustments ?? []) }
    } catch (err) {
      if (handlePriceNotConfigured(err, reply, ROUTE)) return reply
      throw err
    }
  })
}

async function quoteFrom(
  identifier: string,
  reserve: number,
  notes: PriceNotes,
  normAdjustments: readonly { reason: string }[],
): Promise<z.infer<typeof quoteResponse>> {
  const expected = notes.expectedBase === undefined
    ? undefined
    : Math.min(reserve, await markedUpCredits(notes.expectedBase, identifier))
  const priced = await Promise.all(notes.adjustments.map(async (a) => ({
    code: a.code,
    message: a.message,
    ...(a.baseCredits === undefined ? {} : { credits: await markedUpCredits(a.baseCredits, identifier) }),
  })))
  return {
    identifier,
    reserve,
    ...(expected === undefined ? {} : { expected }),
    adjustments: [
      ...normAdjustments.map((a) => ({ code: "params_adjusted", message: a.reason })),
      ...priced,
    ],
    warnings: [...notes.warnings],
  }
}
