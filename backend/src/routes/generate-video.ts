import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const generateVideoBody = z.object({
  imageUrl: z.string().url(),                      // Start frame image
  endFrameUrl: z.string().url().optional(),        // Optional end frame (for supported providers)
  audioUrl: z.string().url().optional(),           // Optional audio track to merge after generation
  prompt: z.string().max(2000).optional(),
  // Replicate providers + KIE-only providers
  provider: z.enum([
    // Available on both Replicate and KIE
    "veo3", "veo3.1", "kling", "minimax",
    // Replicate only
    "veo", "runway", "pika", "sora",
    // KIE only
    "kling-turbo", "grok-i2v", "sora2", "sora2-pro", "wan"
  ]).optional(),
  generateAudio: z.boolean().optional(),
  duration: z.number().int().min(1).max(60).optional(),
  userId: z.string().uuid().optional(),
})

export async function generateVideoRoutes(app: FastifyInstance) {
  app.post("/v1/generate-video", async (req, reply) => {
    const parsed = generateVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, userId } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { imageUrl, endFrameUrl, audioUrl, prompt, provider, generateAudio, duration, type: "image-to-video" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("image-to-video", {
      jobId: job.id,
      imageUrl,
      endFrameUrl,
      audioUrl,
      prompt,
      provider,
      generateAudio,
      duration,
    })

    return { jobId: job.id }
  })
}
