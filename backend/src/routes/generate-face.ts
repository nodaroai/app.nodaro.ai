import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { resolveTemplate, applyTemplate } from "../config/prompt-templates.js"

const generateFaceBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  sourceImageUrl: z.string().url().optional(),
  userId: z.string().uuid().optional(),
})

export async function generateFaceRoutes(app: FastifyInstance) {
  app.post("/v1/generate-face", { preHandler: creditGuard(() => "nano-banana") }, async (req, reply) => {
    const parsed = generateFaceBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { name, description, style, sourceImageUrl, userId } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    // Model identifier for credit check
    const modelIdentifier = "nano-banana"

    // Fetch user prompt templates for face-generation
    let userTemplates: Record<string, string> = {}
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("prompt_templates")
        .eq("id", userId)
        .single()
      userTemplates = (profile?.prompt_templates as Record<string, string>) ?? {}
    } catch {
      // Ignore - use system defaults
    }

    // Build face headshot prompt using template
    const template = resolveTemplate("face-generation", userTemplates)
    const descParts = [name, description].filter(Boolean).join(", ")
    const styleDesc = style ?? "realistic"
    const prompt = applyTemplate(template, {
      description: descParts,
      style: styleDesc,
    })

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: {
          prompt,
          sourceImageUrl,
          type: "generate-face",
          faceData: { name, description, style },
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

    await videoQueue.add("generate-face", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      provider: "nano-banana",
      usageLogId,
    })

    return { jobId: job.id }
  })
}
