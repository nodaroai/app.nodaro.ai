import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const mixAudioBody = z.object({
  audioUrls: z.array(z.string().url()).min(2),
  userId: z.string().uuid().optional(),
})

export async function mixAudioRoutes(app: FastifyInstance) {
  app.post("/v1/mix-audio", async (req, reply) => {
    const parsed = mixAudioBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }

    const { userId, ...restData } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { ...restData, type: "mix-audio" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    await videoQueue.add("mix-audio", { jobId: job.id, ...restData })
    return { jobId: job.id }
  })
}
