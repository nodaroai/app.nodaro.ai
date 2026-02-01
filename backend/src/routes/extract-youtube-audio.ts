import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const extractYouTubeAudioBody = z.object({
  youtubeUrl: z.string().url().refine(
    (url) => {
      try {
        const parsed = new URL(url)
        return parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtu.be")
      } catch {
        return false
      }
    },
    { message: "Must be a valid YouTube URL" },
  ),
})

export async function extractYouTubeAudioRoutes(app: FastifyInstance) {
  app.post("/v1/extract-youtube-audio", async (req, reply) => {
    const parsed = extractYouTubeAudioBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { youtubeUrl } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: "fb48d4d5-cd33-4599-816a-3262e4908522", // TODO: get from auth
        status: "pending",
        input_data: { youtubeUrl, type: "extract-youtube-audio" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("extract-youtube-audio", {
      jobId: job.id,
      youtubeUrl,
    })

    return { jobId: job.id }
  })
}
