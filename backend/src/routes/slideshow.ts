import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { resolveSlideshowTransition } from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import {
  STILL_RESOLUTIONS,
  STILL_ASPECT_RATIOS,
  STILL_FPS_OPTIONS,
  STILL_FITS,
} from "../providers/video/still-segment.js"
import { SLIDESHOW_MOTIONS } from "../providers/video/slideshow-timing.js"

// Enums come from the shared segment builder / timing planner — validation
// cannot drift from what the worker renders. The audio is OPTIONAL: wired,
// it IS the total length (never cropped); unwired, the output is silent at
// N × perImageDuration. `transition` accepts either the combine-videos xfade
// vocabulary or a transition PARAMETER-node pick — resolved to the xfade
// vocabulary here, before the queue, so the worker only sees clean ids.
const slideshowBody = z.object({
  imageUrls: z.array(safeUrlSchema).max(100, { message: "Slideshow caps at 100 images — trim the set upstream; rendering more would take hours rather than fail fast." }),
  audioUrl: safeUrlSchema.optional(),
  imageDurations: z.array(z.number().min(0.1).max(600).nullable()).max(100).optional(),
  perImageDuration: z.number().min(0.5).max(60).default(3),
  transition: z.string().max(64).default("cut"),
  transitionDuration: z.number().min(0).max(5).default(0.5),
  motion: z.enum(SLIDESHOW_MOTIONS).default("none"),
  intensity: z.number().int().min(1).max(10).default(3),
  resolution: z.enum(STILL_RESOLUTIONS).default("1080p"),
  aspectRatio: z.enum(STILL_ASPECT_RATIOS).default("16:9"),
  fps: z.literal(STILL_FPS_OPTIONS).default(30),
  fit: z.enum(STILL_FITS).default("cover"),
  padColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
  userId: z.string().uuid().optional(),
})

export async function slideshowRoutes(app: FastifyInstance) {
  // Zero credits — same wiring as still-to-video: the "slideshow" pricing row
  // is 0, so the credit check passes trivially while storage limits, the
  // admin kill-switch, and dedup still apply.
  app.post("/v1/slideshow", { preHandler: creditGuard(() => "slideshow") }, async (req, reply) => {
    const parsed = slideshowBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    // The limits are product guidance, not just bounds — say what to do instead.
    if (parsed.data.imageUrls.length < 2) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message:
            "Slideshow needs at least 2 images. For a single still, use Still to Video — same output, no list needed.",
        },
      })
    }
    if (
      parsed.data.imageDurations &&
      parsed.data.imageDurations.length !== parsed.data.imageUrls.length
    ) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: "imageDurations must have one entry per image (use null for auto rows).",
        },
      })
    }

    const { userId: _bodyUserId, ...restData } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = "slideshow"
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(parsed.data, "slideshow"),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("slideshow", {
      jobId: job.id,
      ...restData,
      transition: resolveSlideshowTransition(restData.transition),
      usageLogId,
    })
    return { jobId: job.id }
  })
}
