import type { FastifyInstance } from "fastify"
import { z } from "zod"
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
  STILL_MOTIONS,
  STILL_RESOLUTIONS,
  STILL_ASPECT_RATIOS,
  STILL_FPS_OPTIONS,
  STILL_FITS,
} from "../providers/video/still-segment.js"

// Enums come from the still-segment builder — the route's validation cannot
// drift from what the worker can actually render. No duration field by
// design: the output duration IS the audio's duration (ffprobe + -shortest).
const stillToVideoBody = z.object({
  imageUrl: safeUrlSchema,
  audioUrl: safeUrlSchema,
  motion: z.enum(STILL_MOTIONS).default("none"),
  intensity: z.number().int().min(1).max(10).default(3),
  resolution: z.enum(STILL_RESOLUTIONS).default("1080p"),
  aspectRatio: z.enum(STILL_ASPECT_RATIOS).default("16:9"),
  fps: z.literal(STILL_FPS_OPTIONS).default(30),
  fit: z.enum(STILL_FITS).default("cover"),
  padColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
  userId: z.string().uuid().optional(),
})

export async function stillToVideoRoutes(app: FastifyInstance) {
  // Zero credits — the "still-to-video" pricing row is 0, so the guard's
  // credit check passes trivially while the storage-limit check, the admin
  // kill-switch (is_enabled), and anti-double-click dedup all still apply.
  app.post("/v1/still-to-video", { preHandler: creditGuard(() => "still-to-video") }, async (req, reply) => {
    const parsed = stillToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { userId: _bodyUserId, ...restData } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = "still-to-video"
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(parsed.data, "still-to-video"),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits (0 for this node — creates the usage-log row only)
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("still-to-video", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
