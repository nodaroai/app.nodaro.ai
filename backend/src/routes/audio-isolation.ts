import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const audioIsolationBody = z.object({
  audioUrl: safeUrlSchema,
  userId: z.string().uuid().optional(),
})

export async function audioIsolationRoutes(app: FastifyInstance) {
  app.post("/v1/audio-isolation", {
    preHandler: creditGuard(() => "elevenlabs-isolation"),
  }, async (req, reply) => {
    const parsed = audioIsolationBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { audioUrl } = parsed.data
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
        user_id: userId,
        status: "pending",
        input_data: { audioUrl, type: "audio-isolation" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-isolation")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("audio-isolation", {
      jobId: job.id,
      audioUrl,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
