import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const mergeVideoAudioBody = z.object({
  videoUrl: z.string().url(),
  audioUrl: z.string().url(),
  voiceoverVolume: z.number().min(0).max(200).optional().default(100),
  backgroundVolume: z.number().min(0).max(200).optional().default(30),
  keepOriginalAudio: z.boolean().optional().default(true),
})

export async function mergeVideoAudioRoutes(app: FastifyInstance) {
  app.post("/v1/merge-video-audio", async (req, reply) => {
    const parsed = mergeVideoAudioBody.safeParse(req.body)
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
        input_data: { ...parsed.data, type: "merge-video-audio" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    await videoQueue.add("merge-video-audio", { jobId: job.id, ...parsed.data })
    return { jobId: job.id }
  })
}
