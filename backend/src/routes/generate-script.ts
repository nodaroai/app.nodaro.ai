import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { SCRIPT_PROVIDERS } from "../../../packages/shared/src/model-constants.js"
import { LLM_MODEL_IDS, buildLlmCreditIdentifier, resolveLlmCreditId } from "../../../packages/shared/src/llm-models.js"

const generateScriptBody = z.object({
  prompt: z.string().min(1).max(10000),
  sceneCount: z.number().int().min(1).max(20).optional(),
  tone: z.string().max(200).optional(),
  targetDuration: z.number().int().min(5).max(600).optional(),
  provider: z.enum(SCRIPT_PROVIDERS).optional(),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
})

export async function generateScriptRoutes(app: FastifyInstance) {
  app.post("/v1/generate-script", { preHandler: creditGuard((req) => resolveLlmCreditId("generate-script", req.body)) }, async (req, reply) => {
    const parsed = generateScriptBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt, sceneCount, tone, targetDuration, provider, llmModel } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = buildLlmCreditIdentifier("generate-script", llmModel)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { prompt, sceneCount, tone, targetDuration, provider, llmModel, type: "generate-script" },
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
      llmModel,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
