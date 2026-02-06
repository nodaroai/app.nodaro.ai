import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const lipSyncBody = z.object({
  imageUrl: z.string().url(),       // Portrait/face image
  audioUrl: z.string().url(),       // Audio to sync (speech)
  prompt: z.string().max(500).optional(),  // Optional prompt for infinitalk
  provider: z.enum(["kling-avatar", "kling-avatar-pro", "infinitalk"]).optional(),
  resolution: z.enum(["480p", "720p"]).optional(),  // For infinitalk
  userId: z.string().uuid().optional(),
})

export async function lipSyncRoutes(app: FastifyInstance) {
  app.post("/v1/lip-sync", async (req, reply) => {
    const parsed = lipSyncBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, audioUrl, prompt, provider, resolution, userId } = parsed.data

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
        input_data: { imageUrl, audioUrl, prompt, provider, resolution, type: "lip-sync" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("lip-sync", {
      jobId: job.id,
      imageUrl,
      audioUrl,
      prompt,
      provider: provider ?? "kling-avatar",
      resolution,
    })

    return { jobId: job.id }
  })
}
