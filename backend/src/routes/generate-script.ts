import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { LLM_ADVANCED_SHAPE, advancedModeError } from "../lib/llm-advanced-mode.js"
import { resolveScriptModelId } from "../providers/script/script-generator.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { SCRIPT_PROVIDERS, LLM_MODEL_IDS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_TEXT_INPUT_MAX, SCRIPT_SCENE_COUNT_RANGE, SCRIPT_TARGET_DURATION_RANGE, SCRIPT_TONE_MAX_LENGTH, SCRIPT_STYLE_GUIDE_MAX_LENGTH } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

const generateScriptBody = z.object({
  // LLM_TEXT_INPUT_MAX (100K) — same rationale as llm-chat: LLM input, huge
  // context, so the old flat 10000 falsely blocked long source material.
  prompt: z.string().min(1).max(LLM_TEXT_INPUT_MAX),
  userPrompt: z.string().max(LLM_TEXT_INPUT_MAX).optional(),
  // Limits shared with readScriptSettings, which clamps a workflow run's values
  // into these same ranges before they reach the worker.
  sceneCount: z.number().int().min(SCRIPT_SCENE_COUNT_RANGE.min).max(SCRIPT_SCENE_COUNT_RANGE.max).optional(),
  tone: z.string().max(SCRIPT_TONE_MAX_LENGTH).optional(),
  targetDuration: z.number().int().min(SCRIPT_TARGET_DURATION_RANGE.min).max(SCRIPT_TARGET_DURATION_RANGE.max).optional(),
  styleGuide: z.string().max(SCRIPT_STYLE_GUIDE_MAX_LENGTH).optional(),
  provider: z.enum(SCRIPT_PROVIDERS).optional(),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  reasoningEffort: z.enum(LLM_REASONING_EFFORTS).optional(),
  ...LLM_ADVANCED_SHAPE,
})

export async function generateScriptRoutes(app: FastifyInstance) {
  app.post("/v1/generate-script", { preHandler: creditGuard((req) => resolveLlmCreditId("generate-script", req.body)) }, async (req, reply) => {
    const parsed = generateScriptBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { prompt, sceneCount, tone, targetDuration, styleGuide, provider, llmModel, reasoningEffort } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Same resolution the worker uses — validating against a different model than
// the one that runs is how an accepted request turns into a lane-pin failure.
    const advancedError = advancedModeError(parsed.data, resolveScriptModelId(provider, llmModel))
    if (advancedError) return reply.status(400).send({ error: advancedError })
    const modelIdentifier = buildLlmCreditIdentifier("generate-script", llmModel, reasoningEffort, parsed.data.advancedMode)
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "generate-script"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

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
      styleGuide,
      provider,
      llmModel,
      reasoningEffort,
      // Advanced mode has to ride the queue payload: the LLM call happens in
      // the worker, not here, so dropping it would make orchestrated runs
      // silently differ from what the user configured.
      advanced: { advancedMode: parsed.data.advancedMode, temperature: parsed.data.temperature, maxTokens: parsed.data.maxTokens },
      usageLogId,
    })

    return { jobId: job.id }
  })
}
