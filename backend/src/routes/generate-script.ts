import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { SCRIPT_PROVIDERS, LLM_MODEL_IDS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_TEXT_INPUT_MAX } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

const generateScriptBody = z.object({
  // LLM_TEXT_INPUT_MAX (100K) — same rationale as llm-chat: LLM input, huge
  // context, so the old flat 10000 falsely blocked long source material.
  prompt: z.string().min(1).max(LLM_TEXT_INPUT_MAX),
  userPrompt: z.string().max(LLM_TEXT_INPUT_MAX).optional(),
  sceneCount: z.number().int().min(1).max(20).optional(),
  tone: z.string().max(200).optional(),
  targetDuration: z.number().int().min(5).max(600).optional(),
  provider: z.enum(SCRIPT_PROVIDERS).optional(),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
})

export async function generateScriptRoutes(app: FastifyInstance) {
  app.post("/v1/generate-script", { preHandler: creditGuard((req) => resolveLlmCreditId("generate-script", req.body)) }, async (req, reply) => {
    const parsed = generateScriptBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { prompt, sceneCount, tone, targetDuration, provider, llmModel, reasoningEffort } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = buildLlmCreditIdentifier("generate-script", llmModel, reasoningEffort)
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "generate-script"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      .select("id")
      .single()

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
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
      reasoningEffort,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
