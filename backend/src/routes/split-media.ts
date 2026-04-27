import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"

const splitMediaBody = z.object({
  videoUrl: safeUrlSchema.optional(),
  audioUrl: safeUrlSchema.optional(),
  chunkDuration: z.number().min(1),
  audioFormat: z.enum(["mp3", "wav", "aac"]).optional().default("mp3"),
  userId: z.string().uuid().optional(),
}).refine((d) => d.videoUrl || d.audioUrl, {
  message: "At least one of videoUrl or audioUrl is required",
})

export async function splitMediaRoutes(app: FastifyInstance) {
  app.post("/v1/split-media", { preHandler: creditGuard(() => "split-media") }, async (req, reply) => {
    const parsed = splitMediaBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
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

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "split-media"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("split-media", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
