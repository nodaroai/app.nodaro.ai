import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"
import { VIDEO_TO_VIDEO_PROVIDERS } from "../../../packages/shared/src/model-constants.js"

const videoToVideoBody = z.object({
  videoUrl: safeUrlSchema,
  prompt: z.string().max(2000).optional(),
  provider: z.enum(VIDEO_TO_VIDEO_PROVIDERS).optional(),
})

export async function videoToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/video-to-video", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "wan" }) }, async (req, reply) => {
    const parsed = videoToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { videoUrl, prompt, provider } = parsed.data
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
        input_data: {
          videoUrl,
          prompt,
          type: "video-to-video",
          provider: provider ?? "wan",
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const modelIdentifier = provider ?? "wan"
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("video-to-video", {
      jobId: job.id,
      videoUrl,
      prompt,
      provider: modelIdentifier,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
