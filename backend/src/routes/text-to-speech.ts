import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const textToSpeechBody = z.object({
  text: z.string().min(1).max(5000),
  voice: z.string().optional(),
})

export async function textToSpeechRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-speech", async (req, reply) => {
    const parsed = textToSpeechBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { text, voice } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: "fb48d4d5-cd33-4599-816a-3262e4908522", // TODO: get from auth
        status: "pending",
        input_data: { text, voice, type: "text-to-speech" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("text-to-speech", {
      jobId: job.id,
      text,
      voice,
    })

    return { jobId: job.id }
  })
}
