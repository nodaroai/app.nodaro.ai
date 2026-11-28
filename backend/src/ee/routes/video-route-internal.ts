/**
 * POST /v1/video-route/internal/admit — the door the STANDALONE orchestrator
 * uses to admit a routable video job (ee/billing/video-route-admission.ts):
 * it loads no plugin, so this process (which loaded it) decides the job's
 * route, stores it on the job and answers the hold. Internal only (the
 * internal secret's caller). Answers `{ admitted: { stamp, holdCredits } | null }`,
 * or 503 `price_not_configured` when the route gives no quote.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { routedRunPricing } from "../billing/video-route-planned.js"
import { admitRoutedVideo } from "../billing/video-route-admission.js"
import { PriceNotConfiguredError } from "../billing/credits.js"
import { sendInternalError } from "../../lib/http-errors.js"

const body = z.strictObject({ jobId: z.string().uuid(), priceId: z.string().min(1).max(200) })

export async function videoRouteInternalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/video-route/internal/plan", async (req, reply) => {
    if (req.authKind !== "internal") return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
    const parsed = z.strictObject({
      service: z.enum(["generate-video-pro", "edit-video-pro"]), provider: z.string().max(64), resolution: z.string().max(16),
      segmentDurations: z.array(z.number().positive()).max(1000), tailSec: z.number().nonnegative(),
      segmentReferenceSec: z.array(z.array(z.number().positive()).max(10)).max(1000).optional(),
      generateAudio: z.boolean().optional(), feeBase: z.number().nonnegative(), feeId: z.enum(["generate-video-pro", "edit-video-pro"]),
      anchors: z.object({ reserveBase: z.number().nonnegative(), count: z.number().int().nonnegative() }).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", message: "Invalid segment plan" } })
    try {
      return reply.header("Cache-Control", "no-store").send({ pricing: (await routedRunPricing(parsed.data)) ?? null })
    } catch (err) {
      if (err instanceof PriceNotConfiguredError) return reply.status(503).send({ error: { code: "price_not_configured", message: "No price for the segment plan" } })
      return sendInternalError(reply, req, err, "Failed to quote the segment plan")
    }
  })
  app.post("/v1/video-route/internal/admit", async (req, reply) => {
    if (req.authKind !== "internal") return reply.status(403).send({ error: { code: "forbidden", message: "Internal only" } })
    const parsed = body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", message: "jobId and priceId are required" } })
    try {
      return reply.header("Cache-Control", "no-store").send({ admitted: await admitRoutedVideo(parsed.data) })
    } catch (err) {
      if (err instanceof PriceNotConfiguredError) {
        return reply.status(503).send({ error: { code: "price_not_configured", message: "The route gave no price for this run", identifier: err.modelIdentifier } })
      }
      return sendInternalError(reply, req, err, "Failed to admit the video job")
    }
  })
}
