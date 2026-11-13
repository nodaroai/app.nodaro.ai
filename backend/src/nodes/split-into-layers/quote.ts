// The price of a Split into Layers run before it starts (POST /v1/quote): the
// run route's own body and pricing chain, declared once. route.ts registers the
// same chain as its preHandlers, so a quote and a run read one schema and one
// resolver — the hold, the row for the most images the run may return (its Max
// layers plus the base) at its size's tier (layerSplitHoldCreditId).
import type { FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { LAYER_SPLIT_MAX_LAYERS, LAYER_SPLIT_PROMPT_MAX, layerSplitHoldCreditId, layerSplitImagesHeld, layerSplitMaxLayers, layerSplitTier } from "@nodaro/render-rules"
import type { UnitQuote } from "../kit.js"
import { findJobByIdempotencyKey } from "../../lib/dedup-fingerprint.js"
import { safeUrlSchema } from "../../lib/url-validator.js"
import { formatZodError } from "../../lib/zod-error.js"
import { isQuoting, noteAdjustment, noteWarning } from "../../lib/price-notes.js"
import { descriptor } from "./descriptor.generated.js"

/** The sizes the node declares (its `size` app field's options, unit.json) — the one list a run may name. */
function declaredSizes(): [string, ...string[]] {
  const field = descriptor.appFields?.find((f) => f.field === "size")
  const values = field && field.kind === "select" ? field.options.map((o) => o.value) : []
  if (values.length === 0) throw new Error(`${descriptor.type}: unit.json declares no size app field`)
  return values as [string, ...string[]]
}

// One image, how many layers at most, the size and an optional "what to
// separate" description. The caller is req.userId (auth), never the body.
// The size enum is the node's declared one (its app field). Max layers keeps
// the node's own 1-99 here on purpose: the 1-20 slider is the app's.
// `sessionId` and `origin` are not declared: the job funnel (insertJob) reads
// both off the raw body, as on every job-creating route.
function buildBody() {
  return z.object({
    imageUrl: safeUrlSchema,
    maxLayers: z.number().int().min(LAYER_SPLIT_MAX_LAYERS.min).max(LAYER_SPLIT_MAX_LAYERS.max).optional(),
    size: z.enum(declaredSizes()).optional(),
    prompt: z.string().max(LAYER_SPLIT_PROMPT_MAX).optional(),
    userId: z.string().uuid().optional(),
  })
}

let body: ReturnType<typeof buildBody> | undefined

/** POST /v1/split-into-layers' body (built on first use: a unit module runs no code while it loads). */
export function splitIntoLayersBody(): ReturnType<typeof buildBody> {
  body ??= buildBody()
  return body
}

/**
 * Validate FIRST, so a malformed request hears the 400 that names its problem
 * rather than a 402. On a quote it also says what the price is: the hold, the
 * most the run can cost, settled to the images it returns.
 */
async function validateSplitIntoLayers(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const parsed = splitIntoLayersBody().safeParse(req.body)
  if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  if (!isQuoting(req)) return undefined
  const maxLayers = layerSplitMaxLayers(parsed.data.maxLayers)
  const sizes = layerSplitTier(parsed.data.size) === "2k" ? "2K and auto" : "1K and 1.5K"
  noteAdjustment(req, {
    code: "max_images",
    message: `Priced as the most images the run can return: ${layerSplitImagesHeld(maxLayers)} (${maxLayers} layers and the base), at the price ${sizes} share.`,
  })
  noteWarning(req, {
    code: "settles_to_actual",
    message: "This is the most the run can cost: it is charged only for the images it returns, and the difference is refunded when it finishes.",
  })
  return undefined
}

/**
 * A retry with the Idempotency-Key of a run already started gets that run back
 * (200 `{ jobId, deduped: true }`, the answer the insert gives a repeated key),
 * however long after the first request. A run outlives the guard's own lookup
 * (`DEDUP_TTL_MS`, 10 s), and past it the retry would be judged again by the
 * balance, the spending cap, the allowance and the request policies, which the
 * first run's own hold can make refuse it — and a client that reads that
 * refusal as final starts and pays for a second run.
 *
 * The credit guard runs this as its `beforePricing` step: after the model and
 * node doors, the app-token scope gate and its own short lookup (which keeps
 * the trimmed key on `req.idempotencyKey`), and before the price and every
 * credit check. A quote never carries that key, so it is never answered with a
 * job. Only a Split into Layers run answers here: anything else filed under the
 * key goes on to the insert, as before.
 */
async function answerKeyedRetry(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const key = req.idempotencyKey
  if (!key || !req.userId) return undefined
  const existing = await findJobByIdempotencyKey(req.userId, key)
  if (!existing || existing.jobType !== descriptor.type) return undefined
  reply.header("X-Dedup-Hit", "1")
  return reply.code(200).send({ jobId: existing.id, deduped: true })
}

export const quote: UnitQuote = {
  body: splitIntoLayersBody,
  pricing: {
    prechecks: [validateSplitIntoLayers],
    // The row a run holds, from its settings — the route, the workflow payload and the estimates read the same rule.
    modelResolver: (req) => layerSplitHoldCreditId(descriptor.type, req.body as Record<string, unknown> | undefined),
    opts: { beforePricing: answerKeyedRetry },
  },
}
