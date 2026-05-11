/**
 * Face Swap Route
 *
 * Replaces the face in a video with a face from a reference image.
 * Provider: arabyai-replicate/roop_face_swap (Replicate)
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"

const faceSwapBody = z.object({
  faceImageUrl: safeUrlSchema,
  videoUrl: safeUrlSchema,
  provider: z.enum(["roop"]).default("roop"),
})

export async function faceSwapRoutes(app: FastifyInstance) {
  app.post("/v1/face-swap", {
    preHandler: creditGuard(() => "roop-face-swap"),
  }, async (req, reply) => {
    const parsed = faceSwapBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { faceImageUrl, videoUrl, provider } = parsed.data
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
        input_data: buildJobInputData(parsed.data, "face-swap"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "roop-face-swap")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("face-swap", {
      jobId: job.id,
      faceImageUrl,
      videoUrl,
      provider,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
