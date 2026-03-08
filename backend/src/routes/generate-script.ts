import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"
import { SCRIPT_PROVIDERS } from "../../../packages/shared/src/model-constants.js"

const generateScriptBody = z.object({
  prompt: z.string().min(1).max(10000),
  sceneCount: z.number().int().min(1).max(20).optional(),
  tone: z.string().max(200).optional(),
  targetDuration: z.number().int().min(5).max(600).optional(),
  provider: z.enum(SCRIPT_PROVIDERS).optional(),
  userId: z.string().uuid().optional(),
})

export async function generateScriptRoutes(app: FastifyInstance) {
  app.post("/v1/generate-script", { preHandler: creditGuard((req) => { const body = req.body as Record<string, unknown>; return (body?.provider as string) ?? "gemini" }) }, async (req, reply) => {
    const parsed = generateScriptBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt, sceneCount, tone, targetDuration, provider } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Determine model identifier for credit check (default to gemini)
    const modelIdentifier = provider ?? "gemini"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        user_id: userId,
        status: "pending",
        input_data: { prompt, sceneCount, tone, targetDuration, provider, type: "generate-script" },
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

    await videoQueue.add("generate-script", {
      jobId: job.id,
      prompt,
      sceneCount,
      tone,
      targetDuration,
      provider,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
