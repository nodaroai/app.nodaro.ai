import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const generateObjectBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.enum(["furniture", "vehicle", "weapon", "food", "clothing", "electronics", "nature", "tool", "other"]).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  sourceImageUrl: z.string().url().optional(),
})

export async function generateObjectRoutes(app: FastifyInstance) {
  app.post("/v1/generate-object", async (req, reply) => {
    const parsed = generateObjectBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { name, description, category, style, sourceImageUrl } = parsed.data

    // Build single front view object prompt
    const categoryDesc = category ?? "object"
    const descPart = description ? `, ${description}` : ""
    const styleDesc = style ?? "realistic"
    const prompt = [
      `Single ${categoryDesc} ${name}${descPart},`,
      `${styleDesc} art style, front view,`,
      "4k, highly detailed, white/plain background, no text, no labels, no watermarks, product photography style.",
    ].join(" ")

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: "fb48d4d5-cd33-4599-816a-3262e4908522", // TODO: get from auth
        status: "pending",
        input_data: {
          prompt,
          sourceImageUrl,
          type: "generate-object",
          objectData: { name, description, category, style },
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("generate-object", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      provider: "nano-banana",
    })

    return { jobId: job.id }
  })
}
