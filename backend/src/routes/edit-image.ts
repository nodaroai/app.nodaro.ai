import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const editImageBody = z.object({
  imageUrl: z.string().url(),
  prompt: z.string().max(2000).optional(),
  provider: z.enum(["recraft-upscale", "recraft-remove-bg", "nano-banana-edit"]).optional(),
  userId: z.string().uuid().optional(),
})

export async function editImageRoutes(app: FastifyInstance) {
  app.post("/v1/edit-image", async (req, reply) => {
    const parsed = editImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, prompt, provider, userId } = parsed.data

    // Validate that nano-banana-edit has a prompt
    if (provider === "nano-banana-edit" && !prompt) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: "Prompt is required for nano-banana-edit provider",
        },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { imageUrl, prompt, provider, type: "edit-image" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("edit-image", {
      jobId: job.id,
      imageUrl,
      prompt,
      provider,
    })

    return { jobId: job.id }
  })
}
