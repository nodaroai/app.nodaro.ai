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

const splitMediaBody = z.object({
  videoUrl: safeUrlSchema.optional(),
  audioUrl: safeUrlSchema.optional(),
  /** The longest a part may be, in seconds: every part is at most this long. */
  chunkDuration: z.number().min(1),
  /** The shortest a part may be, in seconds (default 4, never above chunkDuration). */
  minPartDuration: z.number().min(0).optional(),
  audioFormat: z.enum(["mp3", "wav", "aac"]).optional().default("mp3"),
  userId: z.string().uuid().optional(),
}).refine((d) => d.videoUrl || d.audioUrl, {
  message: "At least one of videoUrl or audioUrl is required",
}).refine((d) => d.minPartDuration === undefined || d.minPartDuration <= d.chunkDuration, {
  message: "minPartDuration must not be longer than chunkDuration",
  path: ["minPartDuration"],
})

export async function splitMediaRoutes(app: FastifyInstance) {
  app.post("/v1/split-media", { preHandler: creditGuard(() => "split-media") }, async (req, reply) => {
    const parsed = splitMediaBody.safeParse(req.body)
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

    const modelIdentifier = "split-media"

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "split-media"),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("split-media", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
