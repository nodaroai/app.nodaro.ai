import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const generateMusicBody = z.object({
  prompt: z.string().min(1).max(2000),
  provider: z.enum(["musicgen", "minimax", "lyria", "bark"]).optional().default("musicgen"),
  duration: z.number().min(1).max(30).optional(),
  genre: z.string().optional(),
  mood: z.string().optional(),
  instrumental: z.boolean().optional(),
  lyrics: z.string().max(2000).optional(),
  referenceAudioUrl: z.string().url().optional(),
  modelVersion: z.string().optional(),
  userId: z.string().uuid().optional(),
})

export async function generateMusicRoutes(app: FastifyInstance) {
  app.post("/v1/generate-music", async (req, reply) => {
    const parsed = generateMusicBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt, provider, duration, genre, mood, instrumental, lyrics, referenceAudioUrl, modelVersion, userId } = parsed.data

    // Build enriched prompt with genre/mood if provided
    const parts = [prompt]
    if (genre) parts.push(genre)
    if (mood) parts.push(mood)
    if (instrumental) parts.push("instrumental, no vocals")
    const enrichedPrompt = parts.join(", ")

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { prompt: enrichedPrompt, provider, duration, lyrics, referenceAudioUrl, modelVersion, type: "generate-music" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("generate-music", {
      jobId: job.id,
      prompt: enrichedPrompt,
      provider,
      duration,
      lyrics,
      referenceAudioUrl,
      modelVersion,
    })

    return { jobId: job.id }
  })
}
