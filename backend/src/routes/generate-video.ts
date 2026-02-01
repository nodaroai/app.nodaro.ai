import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const generateVideoBody = z.object({
  imageUrl: z.string().url(),
  prompt: z.string().max(2000).optional(),
  provider: z.enum(["veo", "kling", "runway", "pika", "sora", "minimax"]).optional(),
  generateAudio: z.boolean().optional(),
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

    const { imageUrl, prompt, provider, generateAudio } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: "fb48d4d5-cd33-4599-816a-3262e4908522", // TODO: get from auth
        status: "pending",
        input_data: { imageUrl, prompt, provider, generateAudio, type: "image-to-video" },
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
      prompt,
      provider,
      generateAudio,
    })

    return { jobId: job.id }
  })
}
