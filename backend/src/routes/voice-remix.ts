import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const voiceRemixBody = z.object({
  text: z.string().min(1).max(5000),
  voiceDescription: z.string().min(1).max(1000),
  userId: z.string().uuid().optional(),
})

export async function voiceRemixRoutes(app: FastifyInstance) {
  app.post("/v1/voice-remix", {
    preHandler: creditGuard(() => "elevenlabs-voice-remix"),
  }, async (req, reply) => {
    const parsed = voiceRemixBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { text, voiceDescription } = parsed.data
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
        input_data: { text, voiceDescription, type: "voice-remix" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-voice-remix")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("voice-remix", {
      jobId: job.id,
      text,
      voiceDescription,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
