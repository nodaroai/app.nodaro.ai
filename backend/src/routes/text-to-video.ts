import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const textToVideoBody = z.object({
  prompt: z.string().min(1).max(2000),
  provider: z.enum(["veo", "veo3", "kling", "runway", "pika", "sora", "minimax"]).optional(),
  userId: z.string().uuid().optional(),
})

export async function textToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-video", async (req, reply) => {
    const parsed = textToVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt, provider, userId } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { prompt, provider, type: "text-to-video" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("text-to-video", {
      jobId: job.id,
      prompt,
      provider,
    })

    return { jobId: job.id }
  })
}
