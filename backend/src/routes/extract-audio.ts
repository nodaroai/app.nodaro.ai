import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const extractAudioBody = z.object({
  videoUrl: z.string().url(),
  audioFormat: z.enum(["mp3", "wav", "aac"]).optional().default("mp3"),
  outputSilentVideo: z.boolean().optional().default(false),
})

export async function extractAudioRoutes(app: FastifyInstance) {
  app.post("/v1/extract-audio", async (req, reply) => {
    const parsed = extractAudioBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: "fb48d4d5-cd33-4599-816a-3262e4908522",
        status: "pending",
        input_data: { ...parsed.data, type: "extract-audio" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    await videoQueue.add("extract-audio", { jobId: job.id, ...parsed.data })
    return { jobId: job.id }
  })
}
