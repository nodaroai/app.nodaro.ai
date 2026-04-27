import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"

const forcedAlignmentBody = z.object({
  audioUrl: safeUrlSchema,
  transcript: z.string().min(1).max(50000),
  userPrompt: z.string().max(8000).optional(),
  userId: z.string().uuid().optional(),
})

export async function forcedAlignmentRoutes(app: FastifyInstance) {
  app.post("/v1/forced-alignment", {
    preHandler: creditGuard(() => "elevenlabs-forced-alignment"),
  }, async (req, reply) => {
    const parsed = forcedAlignmentBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { audioUrl, transcript } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "forced-alignment"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-forced-alignment")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("forced-alignment", {
      jobId: job.id,
      audioUrl,
      transcript,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
