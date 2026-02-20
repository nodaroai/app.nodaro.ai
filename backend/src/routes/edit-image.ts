import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const editImageBody = z.object({
  imageUrl: z.string().url(),
  prompt: z.string().max(2000).optional(),
  provider: z.enum(["recraft-upscale", "recraft-remove-bg", "nano-banana-edit"]).optional(),
})

export async function editImageRoutes(app: FastifyInstance) {
  app.post("/v1/edit-image", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "recraft-upscale" }) }, async (req, reply) => {
    const parsed = editImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, prompt, provider } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Validate that nano-banana-edit has a prompt
    if (provider === "nano-banana-edit" && !prompt) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: "Prompt is required for nano-banana-edit provider",
        },
      })
    }

    const modelIdentifier = provider ?? "recraft-upscale"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
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

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("edit-image", {
      jobId: job.id,
      imageUrl,
      prompt,
      provider,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
