import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const generateLocationBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.enum(["indoor", "outdoor", "urban", "nature", "fantasy", "sci-fi", "historical", "futuristic", "other"]).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  sourceImageUrl: z.string().url().optional(),
})

export async function generateLocationRoutes(app: FastifyInstance) {
  app.post("/v1/generate-location", async (req, reply) => {
    const parsed = generateLocationBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { name, description, category, style, sourceImageUrl } = parsed.data

    // Build location scene prompt
    const categoryDesc = category ?? "location"
    const descPart = description ? `, ${description}` : ""
    const styleDesc = style ?? "realistic"
    const prompt = [
      `${categoryDesc} scene, ${name}${descPart},`,
      `${styleDesc} art style,`,
      "wide establishing shot, 4k, highly detailed, cinematic lighting, no people, no text, no labels, no watermarks.",
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
          type: "generate-location",
          locationData: { name, description, category, style },
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("generate-location", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      provider: "nano-banana",
    })

    return { jobId: job.id }
  })
}
