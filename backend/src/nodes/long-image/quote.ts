// The price of a Long Image run before it starts (POST /v1/quote): the run
// route's own body and pricing chain, declared once. route.ts registers the
// same chain as its preHandlers, so a quote and a run read one schema and one
// resolver — the row of the run's mode, length, size and the pictures it sends
// (@nodaro/render-rules longImageRunCreditId). A run is charged what it holds.
import type { FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { LONG_IMAGE_MAX_PRODUCT_IMAGES, LONG_IMAGE_MODES, LONG_IMAGE_PROMPT_MAX, longImageProblem, longImageRun, longImageRunCreditId } from "@nodaro/render-rules"
import type { UnitQuote } from "../kit.js"
import { findJobByIdempotencyKey } from "../../lib/dedup-fingerprint.js"
import { safeUrlSchema } from "../../lib/url-validator.js"
import { formatZodError } from "../../lib/zod-error.js"
import { descriptor } from "./descriptor.generated.js"

/** The values a select app field of the node declares (unit.json) — the one list a run may name for it. */
function declaredValues(field: string): [string, ...string[]] {
  const f = descriptor.appFields?.find((a) => a.field === field)
  const values = f && f.kind === "select" ? f.options.map((o) => o.value) : []
  if (values.length === 0) throw new Error(`${descriptor.type}: unit.json declares no ${field} app field`)
  return values as [string, ...string[]]
}

// The mode, its own fields and the prompt. The caller is req.userId (auth),
// never the body. The size and length enums are the node's declared ones (its
// app fields). `productImageUrls` lists the product pictures by place (the
// first is @image_1; a `null` keeps the numbering of the ones after it).
// `sessionId` and `origin` are not declared: the job funnel (insertJob) reads
// both off the raw body, as on every job-creating route.
function buildBody() {
  return z
    .object({
      mode: z.enum(LONG_IMAGE_MODES as unknown as [string, ...string[]]).optional(),
      resolution: z.enum(declaredValues("resolution")).optional(),
      length: z.enum(declaredValues("length")).optional(),
      prompt: z.string().max(LONG_IMAGE_PROMPT_MAX),
      productImageUrls: z.array(safeUrlSchema.nullable()).max(LONG_IMAGE_MAX_PRODUCT_IMAGES).optional(),
      styleImageUrl: safeUrlSchema.optional(),
      subjectImageUrl: safeUrlSchema.optional(),
      userId: z.string().uuid().optional(),
    })
    .superRefine((b, ctx) => {
      // The provider refuses a request that carries the other mode's fields: so does the route, before anything is held.
      const mode = b.mode ?? "webpage"
      if (mode === "webpage" && (b.productImageUrls ?? []).some((u) => u !== null)) {
        ctx.addIssue({ code: "custom", path: ["productImageUrls"], message: "productImageUrls is for a product page (mode \"ecommerce\"); a webpage design takes styleImageUrl and subjectImageUrl" })
      }
      if (mode === "ecommerce") {
        for (const key of ["styleImageUrl", "subjectImageUrl"] as const) {
          if (b[key] !== undefined) ctx.addIssue({ code: "custom", path: [key], message: `${key} is for a webpage design (mode "webpage"); a product page takes productImageUrls` })
        }
      }
    })
}

let body: ReturnType<typeof buildBody> | undefined

/** POST /v1/long-image's body (built on first use: a unit module runs no code while it loads). */
export function longImageBody(): ReturnType<typeof buildBody> {
  body ??= buildBody()
  return body
}

/**
 * Validate FIRST, so a malformed request hears the 400 that names its problem
 * rather than a 402: the body, then the run itself (an empty prompt, a product
 * page with no product picture).
 */
async function validateLongImage(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const parsed = longImageBody().safeParse(req.body)
  if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  const problem = longImageProblem(longImageRun(parsed.data))
  if (problem) return reply.status(400).send({ error: { code: "validation_error", message: problem } })
  return undefined
}

/**
 * A retry with the Idempotency-Key of a run already started gets that run back
 * (200 `{ jobId, deduped: true }`), however long after the first request: a
 * run outlives the guard's own short lookup, and past it the retry would be
 * judged again by the balance and the request policies, which the first run's
 * own charge can make refuse it. The credit guard runs this as its
 * `beforePricing` step, before the price and every credit check. A quote never
 * carries that key. Only a Long Image run answers here.
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
  body: longImageBody,
  pricing: {
    prechecks: [validateLongImage],
    // The row a run is charged, from its settings and pictures — the route, the workflow payload and the estimates read the same rule.
    modelResolver: (req) => longImageRunCreditId(descriptor.type, longImageRun(req.body as Record<string, unknown> | undefined)),
    opts: { beforePricing: answerKeyedRetry },
  },
}
