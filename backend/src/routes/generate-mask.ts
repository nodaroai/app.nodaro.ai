/**
 * Generate Mask Route
 *
 * Produces a binary segmentation mask for a subject described by a text
 * prompt. Provider: adirik/grounded-sam (Replicate — Grounding DINO + SAM).
 *
 * The job result stores BOTH the original `imageUrl` (passthrough, unchanged)
 * AND the generated `maskUrl`, so a downstream Mask Painter / inpainting node
 * can consume them together.
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

const generateMaskBody = z.object({
  imageUrl: safeUrlSchema,
  prompt: z.string().min(1).max(500),
  threshold: z.number().min(0).max(1).optional().default(0.3),
})

export async function generateMaskRoutes(app: FastifyInstance) {
  app.post("/v1/generate-mask", {
    preHandler: creditGuard(() => "generate-mask"),
  }, async (req, reply) => {
    const parsed = generateMaskBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { imageUrl, prompt, threshold } = parsed.data
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
        input_data: buildJobInputData(parsed.data, "generate-mask"),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "generate-mask")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("generate-mask", {
      jobId: job.id,
      imageUrl,
      prompt,
      threshold,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
