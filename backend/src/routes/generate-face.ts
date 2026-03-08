import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { resolveTemplate, applyTemplate } from "../config/prompt-templates.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const generateFaceBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  prompt: z.string().max(4000).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
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

    const { name, description, style, prompt: clientPrompt, sourceImageUrl } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Model identifier for credit check
    const modelIdentifier = "nano-banana"

    // Use client-provided prompt (which includes flow+user template resolution)
    // or fall back to server-side template resolution (for direct API calls)
    let prompt: string
    if (clientPrompt) {
      prompt = clientPrompt
    } else {
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

      const template = resolveTemplate("face-generation", userTemplates)
      const descParts = [name, description].filter(Boolean).join(", ")
      prompt = applyTemplate(template, {
        description: descParts,
        style: style ?? "realistic",
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
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
