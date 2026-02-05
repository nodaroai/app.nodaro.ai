import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const videoToVideoBody = z.object({
  videoUrl: z.string().url(),
  prompt: z.string().max(2000).optional(),
  // V2V ONLY works on KIE.ai - Replicate models don't support video input
  // Only Wan 2.6 and Kling 2.6 Motion Control support actual V2V
  provider: z.enum(["wan", "kling-2.6"]).optional(),
  userId: z.string().uuid().optional(),
})

export async function videoToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/video-to-video", async (req, reply) => {
    const parsed = videoToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { videoUrl, prompt, provider, userId } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { videoUrl, prompt, provider, type: "video-to-video" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("video-to-video", {
      jobId: job.id,
      videoUrl,
      prompt,
      provider,
    })

    return { jobId: job.id }
  })
}
