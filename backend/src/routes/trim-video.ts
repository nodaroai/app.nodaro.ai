import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const trimVideoBody = z.object({
  videoUrl: z.string().url(),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  userId: z.string().uuid().optional(),
})

export async function trimVideoRoutes(app: FastifyInstance) {
  app.post("/v1/trim-video", async (req, reply) => {
    const parsed = trimVideoBody.safeParse(req.body)
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
        input_data: { ...restData, type: "trim-video" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    await videoQueue.add("trim-video", { jobId: job.id, ...restData })
    return { jobId: job.id }
  })
}
