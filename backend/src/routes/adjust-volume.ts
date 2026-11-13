import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"

const adjustVolumeBody = z.object({
  audioUrl: safeUrlSchema.optional(),
  videoUrl: safeUrlSchema.optional(),
  volume: z.number().min(0).max(200).optional().default(100),
  normalize: z.boolean().optional().default(false),
  fadeIn: z.number().min(0).max(10).optional().default(0),
  fadeOut: z.number().min(0).max(10).optional().default(0),
  userId: z.string().uuid().optional(),
}).refine((data) => data.audioUrl || data.videoUrl, {
  message: "Either audioUrl or videoUrl is required",
})

export async function adjustVolumeRoutes(app: FastifyInstance) {
  app.post("/v1/adjust-volume", { preHandler: creditGuard(() => "adjust-volume") }, async (req, reply) => {
    const parsed = adjustVolumeBody.safeParse(req.body)
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

    const modelIdentifier = "adjust-volume"

    // Determine input type for the job
    const inputType = restData.videoUrl ? "video" : "audio"

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "adjust-volume"), inputType },
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("adjust-volume", { jobId: job.id, ...restData, inputType, usageLogId }))
    if (reply.sent) return
    return { jobId: job.id }
  })
}
