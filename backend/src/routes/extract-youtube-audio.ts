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
  userId: z.string().uuid().optional(),
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

    const { youtubeUrl, userId } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
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
