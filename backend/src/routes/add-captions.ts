import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const addCaptionsBody = z.object({
  videoUrl: z.string().url(),
  text: z.string().min(1),
  style: z.enum(["subtitle", "word-highlight", "karaoke"]).optional().default("subtitle"),
  position: z.enum(["bottom", "top", "center"]).optional().default("bottom"),
  fontSize: z.number().min(12).max(72).optional().default(24),
  color: z.string().optional().default("white"),
  backgroundColor: z.string().optional(),
  userId: z.string().uuid().optional(),
})

export async function addCaptionsRoutes(app: FastifyInstance) {
  app.post("/v1/add-captions", async (req, reply) => {
    const parsed = addCaptionsBody.safeParse(req.body)
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
        input_data: { ...restData, type: "add-captions" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    await videoQueue.add("add-captions", { jobId: job.id, ...restData })
    return { jobId: job.id }
  })
}
