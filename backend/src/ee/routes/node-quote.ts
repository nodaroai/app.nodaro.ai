// @registry-enumerates lists every quotable node unit (unitQuotableTypes) in the 400 for an unknown type and in the route's OpenAPI description
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { nodeRunRoute } from "@nodaro/shared/nodes"
import { openApiRegistry } from "../../lib/openapi-registry.js"
import { formatZodError } from "../../lib/zod-error.js"
import { deniedModelRejectionMessage } from "../../lib/surface-deny.js"
import { routeNodeGate } from "../../lib/route-node-gate.js"
import { EMPTY_PRICE_NOTES, type PriceNotes } from "../../lib/price-notes.js"
import { unitQuotableTypes, unitQuoteOf } from "../../lib/unit-quotes.js"
import { deniedRunModels, runNodeRefusal, type RoutePricing } from "../../middleware/credit-guard.js"
import { handlePriceNotConfigured, markedUpCredits, reservedCreditsFor } from "../lib/credit-guard-impl.js"
import { textToVideoBody, textToVideoPricing } from "../../routes/text-to-video.js"
import { generateVideoBody, generateVideoPricing } from "../../routes/generate-video.js"
import { videoToVideoBody, videoToVideoPricing } from "../../routes/video-to-video.js"
import { videoUpscaleBody, videoUpscalePricing } from "../../routes/video-upscale.js"
import { editImageBody, editImagePricing } from "../../routes/edit-image.js"

const ROUTE = "/v1/quote"

/** A node type a quote can price: its run route's OWN body schema and pricing chain. */
export interface QuotableNode {
  readonly schema: () => z.ZodTypeAny
  readonly pricing: RoutePricing
}

/**
 * The hand-written node types a quote can price, each with the run route's OWN
 * body schema and pricing chain (exported by the route and registered there as
 * its preHandlers). A node unit joins through its own `quote.ts`
 * (lib/unit-quotes.ts), never a row here. Nothing here prices anything itself:
 * a quote is the run's pricing, run without the job.
 */
export const QUOTABLE_NODE_TYPES: Readonly<Record<string, QuotableNode>> = {
  "text-to-video": { schema: () => textToVideoBody, pricing: textToVideoPricing },
  "generate-video": { schema: () => generateVideoBody, pricing: generateVideoPricing },
  "video-to-video": { schema: () => videoToVideoBody, pricing: videoToVideoPricing },
  "video-upscale": { schema: () => videoUpscaleBody, pricing: videoUpscalePricing },
  // Every edit-image model: the upscalers (Nodaro Image Upscale measured from
  // the picture, nothing stored), background removal and the prompt edits.
  "edit-image": { schema: () => editImageBody, pricing: editImagePricing },
}

/** What a quote prices `type` with: a hand-written row, else the node unit's quote.ts; undefined when it cannot be quoted. */
export function quotableNodeOf(type: string): QuotableNode | undefined {
  if (Object.hasOwn(QUOTABLE_NODE_TYPES, type)) return QUOTABLE_NODE_TYPES[type]
  const unit = unitQuoteOf(type)
  return unit ? { schema: unit.body, pricing: unit.pricing } : undefined
}

/** Every node type a quote can price: the hand-written rows, then the node units. */
export function quotableNodeTypes(): string[] {
  return [...Object.keys(QUOTABLE_NODE_TYPES), ...unitQuotableTypes()]
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
 * route's own chain on the same body, in the run's order: its pre-checks (the
 * reference-clip length gate, whose probe also prices the run; a retired
 * model's refusal), the guard's model and node doors on the run's own route
 * (`deniedRunModels`, `runNodeRefusal`), the route's step that measures what
 * its price reads (Nodaro Image Upscale's picture, checked with nothing
 * stored), its Zod body, its credit identifier and `computeCredits`, then the
 * reservation's own lookup (`reservedCreditsFor`, shared with the credit
 * guard). No job is created and nothing is reserved.
 * `src/__tests__/quote-route-pricing.test.ts` boots the app and holds every
 * quotable type's chain to the one its run route registers.
 */
export function registerNodeQuote(app: FastifyInstance): void {
  openApiRegistry.registerPath({
    method: "post",
    path: ROUTE,
    description:
      "The credits a node run would reserve, and what it is expected to cost, without starting it. " +
      "Send the node type and exactly the body you would send to its run route. " +
      `Priceable types: ${quotableNodeTypes().join(", ")}.`,
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: quoteBody } } } },
    responses: {
      200: { description: "The quote", content: { "application/json": { schema: z.object({ data: quoteResponse }) } } },
      400: { description: "Invalid body (the run route's own 400), or a node type that cannot be quoted" },
      403: { description: "A model or node this deployment does not offer the caller (the run's own 403), or an outside link this deployment does not import" },
    },
  })

  app.post("/v1/quote", {
    // A quote may ffprobe the request's reference clips, or read an outside picture, and costs nothing.
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
    const entry = quotableNodeOf(type)
    if (!entry) {
      const supported = quotableNodeTypes()
      return reply.status(400).send({
        error: {
          code: "quote_unsupported",
          message: `"${type}" cannot be quoted yet. Quotable: ${supported.join(", ")}.`,
          supported,
        },
      })
    }
    // Every quotable type runs on a route of its own; one without is refused, never quoted past the node door.
    const runRoute = nodeRunRoute(type)
    if (!runRoute) {
      return reply.status(400).send({
        error: { code: "quote_unsupported", message: `"${type}" cannot be quoted: it has no run route of its own.`, supported: quotableNodeTypes() },
      })
    }

    // From here on the request IS the run's, in the run's own order: its
    // pre-checks (which read the raw body and may refuse it before anything
    // else, as on the run), the guard's model and node doors on the run's route,
    // the route's step that prepares what its price reads, then the body the
    // run's handler validates — so each refusal is the one the run gives first.
    req.body = params
    req.priceNotes = EMPTY_PRICE_NOTES
    // A quote stores nothing: a pre-check that copies an input checks it instead.
    req.quoteOnly = true
    for (const precheck of entry.pricing.prechecks) {
      await precheck(req, reply)
      if (reply.sent) return reply
    }
    // The model it runs on — a house model this install does not serve
    // included, and the default for a body that names none — refused by the
    // guard's own model door.
    const gate = routeNodeGate(runRoute, params)
    const deniedModels = deniedRunModels(req, runRoute, entry.pricing.modelResolver, entry.pricing.opts, gate)
    if (deniedModels.length > 0) {
      return reply.status(403).send({ error: { code: "model_not_available", message: deniedModelRejectionMessage(deniedModels) } })
    }
    // The node the run's route runs, refused by the guard's own node door.
    const nodeRefusal = await runNodeRefusal(runRoute, params, req.userId, gate)
    if (nodeRefusal) {
      return reply.status(403).send({ error: { code: nodeRefusal.code, message: nodeRefusal.message } })
    }
    // The route's own step that prepares what its price reads, where the run's guard runs it.
    if (entry.pricing.opts?.beforePricing) {
      await entry.pricing.opts.beforePricing(req, reply)
      if (reply.sent) return reply
    }
    // The run's handler answers an invalid body with this same 400, before anything is reserved.
    const valid = entry.schema().safeParse(params)
    if (!valid.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(valid.error) } })
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
