import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const generateCharacterBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  gender: z.string().max(50).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  baseOutfit: z.string().max(1000).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  userId: z.string().uuid().optional(),
})

export async function generateCharacterRoutes(app: FastifyInstance) {
  app.post("/v1/generate-character", { preHandler: creditGuard(() => "nano-banana") }, async (req, reply) => {
    const parsed = generateCharacterBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { name, description, gender, style, baseOutfit, sourceImageUrl, userId } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    // Model identifier for credit check (hardcoded to nano-banana)
    const modelIdentifier = "nano-banana"

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
        workflow_id: extractWorkflowId(req.body),
        user_id: userId,
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

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("generate-character", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      provider: "nano-banana",
      usageLogId,
    })

    return { jobId: job.id }
  })
}
