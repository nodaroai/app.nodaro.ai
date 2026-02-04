import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const resizeVideoBody = z.object({
  videoUrl: z.string().url(),
  targetAspect: z.enum(["1:1", "16:9", "9:16", "4:5"]),
  method: z.enum(["crop", "pad", "stretch"]).optional().default("pad"),
  padColor: z.string().optional().default("#000000"),
  userId: z.string().uuid().optional(),
})

export async function resizeVideoRoutes(app: FastifyInstance) {
  app.post("/v1/resize-video", async (req, reply) => {
    const parsed = resizeVideoBody.safeParse(req.body)
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
        input_data: { ...restData, type: "resize-video" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    await videoQueue.add("resize-video", { jobId: job.id, ...restData })
    return { jobId: job.id }
  })
}
