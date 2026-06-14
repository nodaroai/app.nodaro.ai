import type { FastifyInstance } from "fastify"
import { z } from "zod"
import {
  getPickerAnalyzer,
  buildLlmCreditIdentifier,
  resolveLlmCreditId,
  getLlmModel,
  LLM_FEATURE_DEFAULTS,
  LLM_MODEL_IDS,
} from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { prefetchAsBase64 } from "../lib/anthropic-image.js"
import { callStructuredLlm } from "../lib/structured-llm.js"
import type { LlmContentBlock } from "../lib/llm-client.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { markProviderCallStart } from "../lib/reconcile/persistence.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"

const describeToPickerBody = z.object({
  imageUrl: safeUrlSchema,
  targetPicker: z.enum(["person"]),
  instructions: z.string().max(2000).optional(),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
})

function buildSystemPrompt(legend: string, instructions?: string): string {
  return [
    "You are analyzing the primary subject of an image to fill a structured character picker.",
    "Call the emit tool exactly once. For each dimension, choose the closest-matching option id(s) from the allowed list.",
    "Fill as many dimensions as possible; OMIT a dimension only when it is not visible or not determinable from the image.",
    "Never exceed a dimension's stated maximum number of choices. Only use ids from the lists below.",
    instructions ? `Additional guidance: ${instructions}` : "",
    "",
    "DIMENSIONS AND ALLOWED VALUES:",
    legend,
  ].filter(Boolean).join("\n")
}

export async function describeToPickerRoutes(app: FastifyInstance) {
  app.post(
    "/v1/describe-to-picker",
    { preHandler: creditGuard((req) => resolveLlmCreditId("describe-to-picker", req.body)) },
    async (req, reply) => {
      const parsed = describeToPickerBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const { imageUrl, targetPicker, instructions } = parsed.data
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      if (!config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({ error: { code: "provider_unavailable", message: "Anthropic API key required for structured picker analysis" } })
      }

      const llmModelId = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["describe-to-picker"]
      const model = getLlmModel(llmModelId)
      if (!model || model.vendor !== "anthropic" || !model.directFallbackModel) {
        return reply.status(400).send({ error: { code: "validation_error", message: "describe-to-picker requires an Anthropic vision model" } })
      }
      const modelIdentifier = buildLlmCreditIdentifier("describe-to-picker", llmModelId)

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "describe-to-picker"),
        })
        .select("id")
        .single()
      if (jobError) {
        return reply.status(500).send({ error: { code: "internal_error", message: jobError.message } })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      void reservation

      await markProviderCallStart(job.id, "anthropic-sync")

      try {
        const { spec, schema, legend } = getPickerAnalyzer(targetPicker)
        const imageBlock = await prefetchAsBase64(imageUrl)
        const content: LlmContentBlock[] = [imageBlock, { type: "text", text: "Analyze the subject and emit the picker JSON." }]

        const { output, inputTokens, outputTokens } = await callStructuredLlm({
          schema,
          modelId: model.directFallbackModel,
          toolName: spec.toolName,
          system: buildSystemPrompt(legend, instructions),
          content,
        })

        await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: { json: output, targetPicker, usage: { inputTokens, outputTokens } },
          })
          .eq("id", job.id)
        await commitReservedCreditsForJob(job.id)

        return reply.send({ jobId: job.id, pickerJson: output })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Picker analysis failed"
        await supabase.from("jobs").update({ status: "failed", output_data: { error: message } }).eq("id", job.id)
        await refundReservedCreditsForJob(job.id)
        return reply.status(502).send({ error: { code: "llm_error", message } })
      }
    },
  )
}
