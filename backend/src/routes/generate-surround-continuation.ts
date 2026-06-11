import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import {
  CHARACTER_ASPECT_OPTIONS,
  LOCATION_ATTACH_COLUMNS,
  SURROUND_DIRECTIONS,
  DEFAULT_CARRIED_FRACTION,
  buildSurroundFillPrompt,
} from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

/**
 * Surround continuation — platform-owned seamless 360° ring-view generation.
 *
 * Studio's Location 360° look-around builds each ring view (45°, 90°, …) as an
 * i2i continuation of the previous view. The platform OWNS the whole pipeline:
 * it builds the half-carry composite server-side (carry the reference's trailing
 * half into the new frame's leading half per `direction`, gray the rest), paints
 * the gray region, then color-harmonizes the painted half to the carried half so
 * there's no tonal seam down the center (the documented Nano-Banana-Pro
 * warm-regrade bug). The result attaches to the location's `angles` bucket.
 *
 * The i2i anchor is the EXPLICIT `referenceImageUrl` (the previous ring view) —
 * NOT the location's establishing shot — so the location gate here only verifies
 * ownership/existence, it does not require `source_image_url`.
 */
const generateSurroundContinuationBody = z.object({
  // The previous ring view (or the establishing shot for the first ring). The
  // composite carries this image's trailing half; the model paints the rest.
  referenceImageUrl: safeUrlSchema,
  direction: z.enum(SURROUND_DIRECTIONS),
  // Ring angle (45, 90, …) — metadata stored on the result; the studio also
  // encodes it in `attachName` ("Surround 45°").
  degrees: z.number().min(0).max(360).optional(),
  // Fraction of the frame carried from the reference (0.5 = half, studio default).
  carriedFraction: z.number().min(0.1).max(0.9).optional().default(DEFAULT_CARRIED_FRACTION),
  // Optional free-form scene hint woven into the fill prompt.
  userPrompt: z.string().max(8000).optional(),
  provider: z.string().optional().default("nano-banana"),
  // Studio pins "16:9" so every ring view matches the establishing shot's frame.
  aspectRatio: z.enum(CHARACTER_ASPECT_OPTIONS).optional(),
  userId: z.string().uuid().optional(),
  // Auto-attach to the location's angles bucket on completion (same mechanism as
  // generate-location-asset). All three required together for the worker to attach.
  attachToLocationId: z.string().uuid().optional(),
  attachToColumn: z.enum(LOCATION_ATTACH_COLUMNS).optional(),
  attachName: z.string().min(1).max(200).optional(),
})

export async function generateSurroundContinuationRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-surround-continuation",
    { preHandler: creditGuard((req) => extractProvider(req.body, "nano-banana")) },
    async (req, reply) => {
      const parsed = generateSurroundContinuationBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const {
        referenceImageUrl,
        direction,
        degrees,
        carriedFraction,
        userPrompt,
        attachToLocationId,
        attachToColumn,
        attachName,
      } = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "userId is required" },
        })
      }

      // Location ownership gate (cheap, BEFORE credit reservation). Unlike
      // generate-location-asset we do NOT require `source_image_url` — the i2i
      // anchor is the explicit `referenceImageUrl`, not the establishing shot.
      if (attachToLocationId) {
        const { data: locRow } = await supabase
          .from("locations")
          .select("id")
          .eq("id", attachToLocationId)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .single()
        if (!locRow) {
          return reply.status(404).send({
            error: { code: "not_found", message: "Location not found" },
          })
        }
      }

      const modelIdentifier = parsed.data.provider
      const prompt = buildSurroundFillPrompt(direction, userPrompt)

      const mcpClient = extractMcpClient(req.body)
      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: { ...buildJobInputData(parsed.data, "generate-surround-continuation"), prompt },
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("generate-surround-continuation", {
        jobId: job.id,
        prompt,
        referenceImageUrl,
        direction,
        degrees,
        carriedFraction,
        provider: parsed.data.provider,
        aspectRatio: parsed.data.aspectRatio,
        usageLogId,
        attachToLocationId,
        attachToColumn,
        attachName,
      })

      return { jobId: job.id }
    },
  )
}
