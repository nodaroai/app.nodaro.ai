import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const videoToVideoBody = z.object({
  videoUrl: safeUrlSchema,
  prompt: z.string().max(2000).optional(),
  // V2V uses Wan 2.6 only via KIE.ai (no provider selection)
})

export async function videoToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/video-to-video", { preHandler: creditGuard(() => "wan") }, async (req, reply) => {
    const parsed = videoToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { videoUrl, prompt } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: {
          videoUrl,
          prompt,
          type: "video-to-video",
          provider: "wan/2-6-video-to-video",  // Actual KIE.ai model used
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "wan")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("video-to-video", {
      jobId: job.id,
      videoUrl,
      prompt,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
