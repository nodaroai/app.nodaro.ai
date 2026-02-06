import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const imageToImageBody = z.object({
  imageUrl: z.string().url(),
  prompt: z.string().min(1).max(2000),
  provider: z.enum(["nano-banana", "nano-banana-pro", "flux-i2i", "flux-pro-i2i", "grok-i2i", "gpt-image-i2i"]).optional(),
  userId: z.string().uuid().optional(),
  referenceImageUrls: z.array(z.string().url()).max(13).optional(),
})

export async function imageToImageRoutes(app: FastifyInstance) {
  app.post("/v1/image-to-image", async (req, reply) => {
    const parsed = imageToImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, prompt, provider, userId, referenceImageUrls } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

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

    await videoQueue.add("image-to-image", {
      jobId: job.id,
      imageUrl,
      referenceImageUrls,
      prompt,
      provider: provider ?? "nano-banana",
    })

    return { jobId: job.id }
  })
}
