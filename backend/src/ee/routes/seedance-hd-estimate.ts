import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { isSeedanceDraftCapable, SEEDANCE_DRAFT_MODELS } from "@nodaro/shared/model-catalog"
import { openApiRegistry } from "../../lib/openapi-registry.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { rateLimitAddressKey } from "../../lib/client-address.js"
import { probeAndCheckRefVideoDurations, probeRefVideoDurations } from "../../lib/ref-video-probe.js"
import { resolveSeedanceDraftFinalize } from "../../lib/seedance-draft-finalize.js"
import { mayUseChildJobAsSource } from "../../lib/job-submission-context.js"
import { handlePriceNotConfigured } from "../lib/credit-guard-impl.js"
import {
  seedanceDraftFinalizeChargedCredits,
  seedanceDraftFinalizeMinimumCredits,
} from "../billing/seedance-draft-finalize-credits.js"
import { plannedSeedanceDraftFinalizePlan } from "../billing/seedance2-ref-video-quote.js"
import { ignoringUnknownTaskType, seedanceRefEstimateBody } from "./seedance-ref-estimate.js"

const ROUTE = "/v1/credits/seedance-hd-estimate"

/** A named draft — the body this route has always taken, parsed exactly as before. */
const namedDraftBody = z.object({
  /** The draft's job id. */
  sourceJobId: z.string().min(1).max(64).optional(),
  /** The draft's provider task id — what a workflow edge carries. */
  taskId: z.string().min(1).max(256).optional(),
})

/**
 * A draft that does not exist yet: the request its own run will send, in the
 * fields `POST /v1/credits/seedance-ref-estimate` takes (the editor sends the
 * draft's quote request as it is). Read only when no draft is named.
 */
const plannedDraftBody = seedanceRefEstimateBody
  .pick({ provider: true, resolution: true, duration: true, referenceTaskType: true, unknownReferenceVideos: true })
  .extend({
    /** A planned draft is always a draft; `true` may be sent (the draft's own quote request carries it). */
    draft: z.literal(true).optional(),
    /** The reference clips the draft's run will send, in order; omitted = none. */
    referenceVideoUrls: seedanceRefEstimateBody.shape.referenceVideoUrls.optional(),
  })

/** The documented body: a named draft, or (with none named) a planned one. */
const estimateBody = namedDraftBody.extend({ plannedDraft: plannedDraftBody.optional() })

type PlannedDraftBody = z.infer<typeof plannedDraftBody>

const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

/** Whether a request asks the planned-draft quote: a `plannedDraft` and no draft named (a named draft wins). */
function asksPlannedDraft(body: unknown, named: { sourceJobId?: unknown; taskId?: unknown } = record(body) ?? {}): boolean {
  return !named.sourceJobId && !named.taskId && record(body)?.plannedDraft !== undefined
}

/**
 * A planned-draft quote measures up to the model's reference clips, so it is
 * limited like the reference-video quote (60 a minute). After the auth hook,
 * per account; every other request is allow-listed — not counted and given no
 * rate-limit headers, exactly as before.
 */
const PLANNED_DRAFT_LIMIT = {
  rateLimit: {
    max: 60,
    timeWindow: "1 minute",
    hook: "preHandler" as const,
    keyGenerator: (req: FastifyRequest) => (req.userId ? `seedance-hd-plan:user:${req.userId}` : `seedance-hd-plan:ip:${rateLimitAddressKey(req)}`),
    allowList: (req: FastifyRequest) => !asksPlannedDraft(req.body),
  },
}

/**
 * The finalize of a planned draft, priced at the length the draft's run
 * reserves for (`plannedSeedanceDraftFinalizePlan`) through the finalize's own
 * pricing — what the server's workflow estimate quotes for the same draft.
 * Runs the draft's own clip gate first: a clip its run would refuse is refused
 * here with the same `400 video_too_long`.
 */
async function plannedDraftQuote(planned: PlannedDraftBody): Promise<{ ok: true; credits: number } | { ok: false; status: 400; code: string; message: string }> {
  const { provider } = planned
  if (!isSeedanceDraftCapable(provider)) {
    return { ok: false, status: 400, code: "validation_error", message: `Seedance 2.5 HD finalizes a draft made by ${SEEDANCE_DRAFT_MODELS.join(", ")}; plannedDraft.provider "${provider}" makes none.` }
  }
  const referenceVideoUrls = planned.referenceVideoUrls ?? []
  let durationsSec: readonly number[] = []
  if (referenceVideoUrls.length > 0) {
    const check = await probeAndCheckRefVideoDurations({ provider, referenceVideoUrls })
    if (!check.ok) return { ok: false, status: 400, code: "video_too_long", message: check.message }
    durationsSec = check.durationsSec ?? (await probeRefVideoDurations({ provider, referenceVideoUrls }))
  }
  const plan = plannedSeedanceDraftFinalizePlan({
    provider,
    resolution: planned.resolution,
    duration: planned.duration,
    referenceTaskType: planned.referenceTaskType,
    durationsSec,
    unknownClips: planned.unknownReferenceVideos ?? 0,
  })
  return { ok: true, credits: await seedanceDraftFinalizeChargedCredits(plan) }
}

/**
 * Read-only price of a Seedance 2.5 HD (from draft) finalize — nothing is
 * created or reserved.
 *
 * With a draft named, it runs the finalize's own gate
 * (`resolveSeedanceDraftFinalize` — ownership, draft flag, completion, the
 * draft's billable length) and prices the plan the way the reservation does
 * (`seedanceDraftFinalizeChargedCredits`), so the number equals what a run of
 * that draft reserves; a draft the run would refuse is refused here with the
 * same coded 4xx. With none named and a `plannedDraft` (the request of a
 * draft not made yet), the finalize of that draft at the length its run
 * reserves for — the most such a finalize can be charged, and what the
 * server's workflow estimate quotes for it. With neither, the lowest price any
 * draft can finalize for (`minimum: true`) — the "from N" the editor shows
 * before a draft is wired.
 */
export function registerSeedanceHdEstimate(app: FastifyInstance): void {
  openApiRegistry.registerPath({
    method: "post", path: ROUTE,
    description:
      "Credits to finalize a Seedance 2.5 draft at 1080p (Video Upscale, provider seedance-2-5-hd), without creating a job. " +
      "Name the draft by sourceJobId or taskId for its exact price. With none named, send plannedDraft (the request of a draft not made yet: " +
      "its provider, resolution, duration, referenceTaskType, referenceVideoUrls and unknownReferenceVideos) for the finalize of that draft at the length its run reserves for; " +
      "send neither for the lowest price any draft can finalize for (minimum: true).",
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: estimateBody } } } },
    responses: {
      200: { description: "Credit estimate", content: { "application/json": { schema: z.object({
        data: z.object({ credits: z.number(), minimum: z.boolean() }),
      }) } } },
    },
  })

  // The path is written out (not ROUTE) so route-path-parity's static scan
  // sees the registration the frontend's estimateSeedanceHdCredits calls.
  app.post("/v1/credits/seedance-hd-estimate", { config: PLANNED_DRAFT_LIMIT }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = namedDraftBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const { sourceJobId, taskId } = parsed.data

    try {
      if (!sourceJobId && !taskId) {
        if (asksPlannedDraft(req.body, parsed.data)) {
          const planned = plannedDraftBody.safeParse(ignoringUnknownTaskType(record(req.body)?.plannedDraft))
          if (!planned.success) {
            return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(planned.error) } })
          }
          const quote = await plannedDraftQuote(planned.data)
          if (!quote.ok) return reply.status(quote.status).send({ error: { code: quote.code, message: quote.message } })
          return { data: { credits: quote.credits, minimum: false } }
        }
        return { data: { credits: await seedanceDraftFinalizeMinimumCredits(), minimum: true } }
      }
      const resolved = await resolveSeedanceDraftFinalize({ userId: req.userId, taskId, sourceJobId, allowChildSource: mayUseChildJobAsSource(req) })
      if (!resolved.ok) {
        return reply.status(resolved.status).send({ error: { code: resolved.code, message: resolved.message } })
      }
      return { data: { credits: await seedanceDraftFinalizeChargedCredits(resolved), minimum: false } }
    } catch (err) {
      if (handlePriceNotConfigured(err, reply, ROUTE)) return reply
      return sendInternalError(reply, req, err, "Failed to estimate the finalize credits")
    }
  })
}
