import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const generateCharacterBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  gender: z.string().max(50).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  baseOutfit: z.string().max(1000).optional(),
  sourceImageUrl: z.string().url().optional(),
})

export async function generateCharacterRoutes(app: FastifyInstance) {
  app.post("/v1/generate-character", async (req, reply) => {
    const parsed = generateCharacterBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { name, description, gender, style, baseOutfit, sourceImageUrl } = parsed.data

    // Build single front portrait prompt
    const charDesc = [name, gender, description].filter(Boolean).join(", ")
    const outfitDesc = baseOutfit ? `, wearing ${baseOutfit}` : ""
    const styleDesc = style ?? "realistic"
    const prompt = [
      `${charDesc}${outfitDesc},`,
      `${styleDesc} style, front view, looking at camera,`,
      "full body portrait, 4k, highly detailed, clean background.",
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
          type: "generate-character",
          characterData: { name, description, gender, style, baseOutfit },
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("generate-character", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      provider: "nano-banana",
    })

    return { jobId: job.id }
  })
}
