import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { billsReferenceVideoSeconds, SEEDANCE_2_5_REF_LIMITS } from "@nodaro/shared/models"
import { openApiRegistry } from "../../lib/openapi-registry.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { probeAndCheckRefVideoDurations, probeRefVideoDurations } from "../../lib/ref-video-probe.js"
import { handlePriceNotConfigured } from "../lib/credit-guard-impl.js"
import { seedance2RefVideoChargedQuote } from "../billing/seedance2-ref-video-quote.js"

const ROUTE = "/v1/credits/seedance-ref-estimate"
const MAX_CLIPS = SEEDANCE_2_5_REF_LIMITS.videos

const estimateBody = z.object({
  /** A Seedance 2 model (seedance-2, seedance-2-fast, seedance-2-mini, seedance-2-5). */
  provider: z.string().min(1).max(64),
  /** The run's resolution; omitted = the model's default, as the run sends it. */
  resolution: z.string().min(1).max(16).optional(),
  /** Output seconds; -1 = Auto (priced at the model's longest clip). Omitted = the model's default. */
  duration: z.union([z.number(), z.string().max(8)]).optional(),
  /** Seedance 2.5 Draft: priced at 480p. */
  draft: z.boolean().optional(),
  /** The reference clips the run will send, in order. */
  referenceVideoUrls: z.array(z.string().url().max(2048)).max(MAX_CLIPS),
  /** Wired reference clips whose URL is not known yet (their upstream has not produced them). */
  unknownReferenceVideos: z.number().int().min(0).max(MAX_CLIPS).optional(),
})

/**
 * Read-only price of a Seedance 2 run with reference video(s) — nothing is
 * created or reserved.
 *
 * The provider bills `unit × (input + output)` seconds, so the price follows
 * the reference clips' real lengths. This runs the run's own duration gate
 * (`probeAndCheckRefVideoDurations` — the same probe, the same 400
 * `video_too_long`) and prices the probed lengths through the reservation's own
 * arithmetic (`seedance2RefVideoChargedQuote`), so `credits` equals what a run
 * of the same request reserves. Clips not produced yet (`unknownReferenceVideos`)
 * are quoted at the provider's worst case with the shortest clip as `min`, and
 * `exact: false` — never a figure below the reservation.
 */
export function registerSeedanceRefEstimate(app: FastifyInstance): void {
  openApiRegistry.registerPath({
    method: "post", path: ROUTE,
    description:
      "Credits for a Seedance 2 generation with reference video(s), without creating a job. " +
      "The reference clips are probed and priced exactly as the run's reservation prices them (input + output seconds). " +
      "Clips not produced yet (unknownReferenceVideos) are quoted at the provider's worst case (exact: false; min = the shortest clip).",
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: estimateBody } } } },
    responses: {
      200: { description: "Credit estimate", content: { "application/json": { schema: z.object({
        data: z.object({ credits: z.number(), min: z.number(), exact: z.boolean() }),
      }) } } },
    },
  })

  // The path is written out (not ROUTE) so route-path-parity's static scan
  // sees the registration the frontend's estimateSeedanceRefCredits calls.
  app.post("/v1/credits/seedance-ref-estimate", {
    // Every request may ffprobe up to MAX_CLIPS remote files and costs nothing.
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = estimateBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const { provider, resolution, duration, draft, referenceVideoUrls } = parsed.data
    const unknownClips = parsed.data.unknownReferenceVideos ?? 0
    if (!billsReferenceVideoSeconds(provider)) {
      return reply.status(400).send({ error: { code: "validation_error", message: `"${provider}" is not a model whose price follows its reference clips (Seedance 2, Kling 4.0).` } })
    }
    if (referenceVideoUrls.length + unknownClips === 0) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Name at least one reference video (referenceVideoUrls or unknownReferenceVideos)." } })
    }

    try {
      // The run's own gate: the same probe, the same refusal.
      const check = await probeAndCheckRefVideoDurations({ provider, referenceVideoUrls })
      if (!check.ok) {
        return reply.status(400).send({ error: { code: "video_too_long", message: check.message } })
      }
      // A provider with no declared bound is not probed by the gate; the
      // reservation probes it itself — so does the estimate.
      const durationsSec = check.durationsSec ?? (await probeRefVideoDurations({ provider, referenceVideoUrls }))
      return { data: await seedance2RefVideoChargedQuote({ provider, resolution, duration, draft, durationsSec, unknownClips }) }
    } catch (err) {
      if (handlePriceNotConfigured(err, reply, ROUTE)) return reply
      return sendInternalError(reply, req, err, "Failed to estimate the reference-video credits")
    }
  })
}
