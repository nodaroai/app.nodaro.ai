import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const adjustVolumeBody = z.object({
  audioUrl: z.string().url(),
  volume: z.number().min(0).max(200).optional().default(100),
  normalize: z.boolean().optional().default(false),
  fadeIn: z.number().min(0).max(10).optional().default(0),
  fadeOut: z.number().min(0).max(10).optional().default(0),
  userId: z.string().uuid().optional(),
})

export async function adjustVolumeRoutes(app: FastifyInstance) {
  app.post("/v1/adjust-volume", async (req, reply) => {
    const parsed = adjustVolumeBody.safeParse(req.body)
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
        input_data: { ...restData, type: "adjust-volume" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    await videoQueue.add("adjust-volume", { jobId: job.id, ...restData })
    return { jobId: job.id }
  })
}
