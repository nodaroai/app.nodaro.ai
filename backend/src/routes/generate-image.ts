import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const generateImageBody = z.object({
  prompt: z.string().min(1).max(2000),
  referenceImageUrl: z.string().url().optional(),
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

    const { prompt, referenceImageUrl } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: "fb48d4d5-cd33-4599-816a-3262e4908522", // TODO: get from auth
        status: "pending",
        input_data: { prompt, referenceImageUrl, type: "generate-image" },
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
      referenceImageUrl,
    })

    return { jobId: job.id }
  })
}
