import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const loopVideoBody = z.object({
  videoUrl: z.string().url(),
  mode: z.enum(["repeat", "duration"]),
  repeatCount: z.number().int().min(2).max(20).optional(),
  targetDuration: z.number().min(1).max(300).optional(),
  userId: z.string().uuid().optional(),
})

export async function loopVideoRoutes(app: FastifyInstance) {
  app.post("/v1/loop-video", { preHandler: creditGuard(() => "ffmpeg") }, async (req, reply) => {
    const parsed = loopVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }

    const { userId, ...restData } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    const modelIdentifier = "ffmpeg"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: { ...restData, type: "loop-video" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("loop-video", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
