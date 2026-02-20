import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const imageToImageBody = z.object({
  imageUrl: safeUrlSchema,
  prompt: z.string().min(1).max(2000),
  provider: z.enum(["nano-banana", "nano-banana-pro", "flux-i2i", "flux-pro-i2i", "grok-i2i", "gpt-image-i2i"]).optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(13).optional(),
})

export async function imageToImageRoutes(app: FastifyInstance) {
  app.post("/v1/image-to-image", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "nano-banana" }) }, async (req, reply) => {
    const parsed = imageToImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, prompt, provider, referenceImageUrls } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = provider ?? "nano-banana"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: { imageUrl, prompt, provider, referenceImageUrls, type: "image-to-image" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("image-to-image", {
      jobId: job.id,
      imageUrl,
      referenceImageUrls,
      prompt,
      provider: modelIdentifier,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
