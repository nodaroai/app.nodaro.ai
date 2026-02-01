import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const generateImageBody = z.object({
  prompt: z.string().min(1).max(2000),
})

export async function generateImageRoutes(app: FastifyInstance) {
  app.post("/v1/generate-image", async (req, reply) => {
    const parsed = generateImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: "00000000-0000-0000-0000-000000000000",
        status: "pending",
        input_data: { prompt, type: "generate-image" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("generate-image", {
      jobId: job.id,
      prompt,
    })

    return { jobId: job.id }
  })
}
