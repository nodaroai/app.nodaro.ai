import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"

const soraStoryboardBody = z.object({
  shots: z.array(z.object({
    scene: z.string().min(1).max(10000),
    duration: z.number().min(1).max(10),
  })).min(1).max(10),
  nFrames: z.enum(["10", "15", "25"]).default("10"),
  imageUrls: z.array(safeUrlSchema).max(5).optional(),
  aspectRatio: z.enum(["portrait", "landscape"]).default("landscape"),
  characterIdList: z.array(z.string()).max(5).optional(),
  userId: z.string().uuid().optional(),
})

export async function soraStoryboardRoutes(app: FastifyInstance) {
  app.post("/v1/sora-storyboard", {
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      const nFrames = (body?.nFrames as string) ?? "10"
      return nFrames === "10" ? "sora-storyboard" : `sora-storyboard:${nFrames}`
    }),
  }, async (req, reply) => {
    const parsed = soraStoryboardBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { shots, nFrames, imageUrls, aspectRatio, characterIdList } = parsed.data
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
        input_data: {
          type: "sora-storyboard",
          shots,
          nFrames,
          imageUrls,
          aspectRatio,
          characterIdList,
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const modelId = nFrames === "10" ? "sora-storyboard" : `sora-storyboard:${nFrames}`
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelId)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("sora-storyboard", {
      jobId: job.id,
      shots,
      nFrames,
      imageUrls,
      aspectRatio,
      characterIdList,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
