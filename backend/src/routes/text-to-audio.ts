import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const textToAudioBody = z.object({
  prompt: z.string().min(1).max(2000),
  provider: z.enum(["tangoflux", "tango", "audioldm", "bark"]).optional(),
  duration: z.number().min(1).max(30).optional(),
  userId: z.string().uuid().optional(),
})

export async function textToAudioRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-audio", async (req, reply) => {
    const parsed = textToAudioBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt, provider, duration, userId } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { prompt, provider, duration, type: "text-to-audio" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("text-to-audio", {
      jobId: job.id,
      prompt,
      provider,
      duration,
    })

    return { jobId: job.id }
  })
}
