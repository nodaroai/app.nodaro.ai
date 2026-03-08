import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const resizeVideoBody = z.object({
  videoUrl: safeUrlSchema,
  targetAspect: z.enum(["1:1", "16:9", "9:16", "4:5"]),
  method: z.enum(["crop", "pad", "stretch"]).optional().default("pad"),
  padColor: z.string().optional().default("#000000"),
  userId: z.string().uuid().optional(),
})

export async function resizeVideoRoutes(app: FastifyInstance) {
  app.post("/v1/resize-video", { preHandler: creditGuard(() => "ffmpeg") }, async (req, reply) => {
    const parsed = resizeVideoBody.safeParse(req.body)
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

    // Model identifier for credit check (FFmpeg processing = 0 credits)
    const modelIdentifier = "ffmpeg"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        user_id: userId,
        status: "pending",
        input_data: { ...restData, type: "resize-video" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("resize-video", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
