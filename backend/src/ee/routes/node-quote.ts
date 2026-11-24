// @registry-enumerates lists every quotable node unit (unitQuotableTypes) in the 400 for an unknown type and in the route's OpenAPI description
import { adjustmentsForRun } from "../../lib/driving-audio-measure.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { nodeRunRoute } from "@nodaro/shared/nodes"
import { openApiRegistry } from "../../lib/openapi-registry.js"
import { formatZodError, zodRefusalCode } from "../../lib/zod-error.js"
import { deniedModelRejectionMessage } from "../../lib/surface-deny.js"
import { routeNodeGate } from "../../lib/route-node-gate.js"
import { EMPTY_PRICE_NOTES, type PriceNotes } from "../../lib/price-notes.js"
import { unitQuotableTypes, unitQuoteOf } from "../../lib/unit-quotes.js"
import type { RoutePricing as RegisteredPricing } from "../../middleware/credit-guard.js"
import { deniedRunModels, runNodeRefusal, type RoutePricing } from "../../middleware/credit-guard.js"
import { callerBodyOf } from "../../middleware/server-only-body-keys.js"
import { handlePriceNotConfigured, markedUpCredits, reservedCreditsFor } from "../lib/credit-guard-impl.js"
import { textToVideoBody, textToVideoPricing } from "../../routes/text-to-video.js"
import { generateVideoBody, generateVideoPricing } from "../../routes/generate-video.js"
import { videoToVideoBody, videoToVideoPricing } from "../../routes/video-to-video.js"
import { videoUpscaleBody, videoUpscalePricing } from "../../routes/video-upscale.js"
import { editImageBody, editImagePricing } from "../../routes/edit-image.js"
import { aiAvatarBody, aiAvatarPricing } from "../../routes/ai-avatar.js"
import { cinematicAvatarBody, cinematicAvatarPricing } from "../../routes/cinematic-avatar.js"
import { switchXBody, switchXPricing } from "../../routes/switchx.js"
import { lipSyncBody, lipSyncPricing } from "../../routes/lip-sync.js"

const ROUTE = "/v1/quote"

/** A node type a quote can price: its run route's OWN body schema and pricing chain. */
export interface QuotableNode {
  readonly schema: () => z.ZodTypeAny
  readonly pricing: RoutePricing
  /** What every quote of this type says beside its price. */
  readonly notes?: PriceNotes
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
  // HeyGen's AI Avatar: its duration bucket, an audio-mode run's audio measured as the run measures it.
  "ai-avatar": { schema: () => aiAvatarBody, pricing: aiAvatarPricing },
  // HeyGen's Cinematic Avatar: its exact (resolution, duration) hold.
  "cinematic-avatar": { schema: () => cinematicAvatarBody, pricing: cinematicAvatarPricing },
  // Beeble SwitchX: its frame-block tier, the clip's frames measured as the run measures them.
  "switchx": { schema: () => switchXBody, pricing: switchXPricing },
  // Lip Sync: a model priced by its audio's length on the audio measured as the run measures it;
  // LatentSync's hold, charged what its run used, is the most it costs (`settles_to_actual`).
  "lip-sync": { schema: () => lipSyncBody, pricing: lipSyncPricing },
}

/**
 * The least an Edit Video Pro quote's body must be, checked here. The run
 * route is the authority on everything else (the span's 4-second floor and
 * its ceiling, the prompt's length, the model): its pre-checks answer those,
 * for the run and the quote alike. Loose on purpose — a client sends `origin`
 * and `sessionId` in the same body.
 */
const editVideoProQuoteBody = z
  .object({
    // Present, no more: the route's own chain judges the link, as on the run.
    videoUrl: z.string().min(1),
    spanStart: z.number().min(0),
    spanEnd: z.number().positive(),
    prompt: z.string().min(1),
  })
  .passthrough()

/**
 * Node types whose run route a deployment's own module registers, so this
 * file has no `RoutePricing` to import: the quote prices them with the chain
 * the app registered at their run route (lib/route-pricing-registry.ts) — the
 * same functions, by construction. Such a type is quotable only where that
 * route is registered (its module is loaded); elsewhere it is a
 * `quote_unsupported`, like any type with no quote.
 */
const ROUTE_PRICED_NODE_TYPES: Readonly<Record<string, Pick<QuotableNode, "schema" | "notes">>> = {
  // Edit Video Pro holds the most a span can cost (its length, the bridge
  // clips around it, the source's own frame size) and is charged for what it
  // generated.
  "edit-video-pro": {
    schema: () => editVideoProQuoteBody,
    notes: {
      adjustments: [],
      warnings: [{ code: "settles_to_actual", message: "This is the most the edit can cost: the run is charged for what it generates and the rest of the hold is released." }],
    },
  },
}

/** How the quote reads a registered route's chain: the app's own registry (`app.routePricingOf`). */
type RoutePricingLookup = (url: string) => RegisteredPricing | undefined

/** A route-priced type's entry, when the app registered its run route as quotable. */
function routePricedNodeOf(type: string, routePricingOf: RoutePricingLookup | undefined): QuotableNode | undefined {
  if (!routePricingOf || !Object.hasOwn(ROUTE_PRICED_NODE_TYPES, type)) return undefined
  const route = nodeRunRoute(type)
  const pricing = route ? routePricingOf(route) : undefined
  return pricing ? { ...ROUTE_PRICED_NODE_TYPES[type]!, pricing } : undefined
}

/**
 * What a quote prices `type` with: a hand-written row, else the node unit's
 * quote.ts, else the chain its run route registered (a route-priced type,
 * read through the app's `routePricingOf`); undefined when it cannot be quoted.
 */
export function quotableNodeOf(type: string, routePricingOf?: RoutePricingLookup): QuotableNode | undefined {
  if (Object.hasOwn(QUOTABLE_NODE_TYPES, type)) return QUOTABLE_NODE_TYPES[type]
  const unit = unitQuoteOf(type)
  return unit ? { schema: unit.body, pricing: unit.pricing } : routePricedNodeOf(type, routePricingOf)
}

/**
 * Every node type a quote can price NOW: the hand-written rows, the node
 * units, then the route-priced types whose run route is registered as
 * quotable. Read per request (a refusal's `supported` list), never at boot: a
 * route-priced type's route registers after this file's own.
 */
export function quotableNodeTypes(routePricingOf?: RoutePricingLookup): string[] {
  return [
    ...Object.keys(QUOTABLE_NODE_TYPES),
    ...unitQuotableTypes(),
    ...Object.keys(ROUTE_PRICED_NODE_TYPES).filter((type) => routePricedNodeOf(type, routePricingOf) !== undefined),
  ]
}

/** The types the API reference names: every type this build can quote, whether or not its route is loaded yet. */
function documentedQuotableTypes(): string[] {
  return [...Object.keys(QUOTABLE_NODE_TYPES), ...unitQuotableTypes(), ...Object.keys(ROUTE_PRICED_NODE_TYPES)]
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
      `Priceable types: ${documentedQuotableTypes().join(", ")}.`,
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
    const { type } = parsed.data
    // The run's body, less the keys the server keeps its own measurements
    // under, exactly as the run's route reads it.
    const params = callerBodyOf(req, parsed.data.params)
    const routePricingOf = req.server.routePricingOf
    const entry = quotableNodeOf(type, routePricingOf)
    if (!entry) {
      const supported = quotableNodeTypes(routePricingOf)
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
        error: { code: "quote_unsupported", message: `"${type}" cannot be quoted: it has no run route of its own.`, supported: quotableNodeTypes(routePricingOf) },
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
      // A rule that names its own code answers it here as on the run (lib/zod-error.ts `zodRefusalCode`).
      const refusalCode = zodRefusalCode(valid.error)
      return reply.status(400).send({
        error: refusalCode
          ? { code: refusalCode, message: valid.error.issues[0]!.message }
          : { code: "validation_error", ...formatZodError(valid.error) },
      })
    }
    try {
      const identifier = entry.pricing.modelResolver(req)
      const reserve = await reservedCreditsFor(req, identifier, entry.pricing.opts)
      return { data: await quoteFrom(identifier, reserve, withEntryNotes(req.priceNotes ?? EMPTY_PRICE_NOTES, entry.notes), adjustmentsForRun(req.videoNorm?.adjustments ?? [], req.drivingAudio)) }
    } catch (err) {
      if (handlePriceNotConfigured(err, reply, ROUTE)) return reply
      throw err
    }
  })
}

/** The request's notes with what every quote of the type says. */
function withEntryNotes(notes: PriceNotes, own: PriceNotes | undefined): PriceNotes {
  if (!own) return notes
  return { ...notes, adjustments: [...notes.adjustments, ...own.adjustments], warnings: [...notes.warnings, ...own.warnings] }
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
