import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { createSSEStream } from "../lib/sse.js"
import { llmComplete, llmStream } from "../lib/llm-client.js"
import type { LlmContentBlock } from "../lib/llm-client.js"
import { LLM_MODEL_IDS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "../../../packages/shared/src/llm-models.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"

const llmChatBody = z.object({
  systemPrompt: z.string().max(10000),
  userInput: z.string().min(1).max(10000),
  referenceImageUrls: z.array(z.string().url()).max(5).optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).max(16384).default(2048),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
})

function buildUserContent(userInput: string, referenceImageUrls?: string[]): string | LlmContentBlock[] {
  if (!referenceImageUrls?.length) return userInput
  return [
    ...referenceImageUrls.map((url) => ({ type: "image" as const, url })),
    { type: "text" as const, text: userInput },
  ]
}

export async function llmChatRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // POST /v1/llm-chat/generate  (Synchronous — used by backend orchestrator)
  // ---------------------------------------------------------------------------

  app.post(
    "/v1/llm-chat/generate",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("llm-chat", req.body)),
      config: { requestTimeout: 120000 } as Record<string, unknown>,
    },
    async (req, reply) => {
      req.raw.setTimeout(120000)
      reply.raw.setTimeout(120000)

      const parsed = llmChatBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { systemPrompt, userInput, referenceImageUrls, temperature, maxTokens } = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "LLM API key not configured",
          },
        })
      }

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["llm-chat"]
      const modelIdentifier = buildLlmCreditIdentifier("llm-chat", llmModel)

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "llm-chat",
            systemPrompt,
            userInput,
            llmModel,
            temperature,
            maxTokens,
          },
        })
        .select("id")
        .single()

      if (jobError) {
        return reply.status(500).send({
          error: { code: "internal_error", message: jobError.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const response = await llmComplete({
          modelId: llmModel,
          system: systemPrompt,
          messages: [{ role: "user", content: buildUserContent(userInput, referenceImageUrls) }],
          maxTokens,
          temperature,
        })

        const generatedText = response.text

        try {
          await supabase
            .from("jobs")
            .update({
              status: "completed",
              output_data: { generatedText, model: llmModel, usage: response.usage },
              provider_cost: response.providerCost ?? null,
            })
            .eq("id", job.id)

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
          }
        } catch {
          // Best-effort job finalization — credit commit failure is non-fatal
        }

        return reply.send({ jobId: job.id, generatedText })
      } catch (err) {
        const message = err instanceof Error ? err.message : "LLM API call failed"

        await supabase
          .from("jobs")
          .update({ status: "failed", output_data: { error: message } })
          .eq("id", job.id)

        if (usageLogId) {
          await CreditsService.refundCredits(usageLogId)
        }

        return reply.status(502).send({
          error: { code: "llm_error", message },
        })
      }
    },
  )

  // ---------------------------------------------------------------------------
  // POST /v1/llm-chat/generate-stream  (SSE streaming — used by frontend)
  // ---------------------------------------------------------------------------

  app.post(
    "/v1/llm-chat/generate-stream",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("llm-chat", req.body)),
      config: { requestTimeout: 120000 } as Record<string, unknown>,
    },
    async (req, reply) => {
      req.raw.setTimeout(120000)
      reply.raw.setTimeout(120000)

      const parsed = llmChatBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { systemPrompt, userInput, referenceImageUrls, temperature, maxTokens } = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "LLM API key not configured",
          },
        })
      }

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["llm-chat"]
      const modelIdentifier = buildLlmCreditIdentifier("llm-chat", llmModel)

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "llm-chat-stream",
            systemPrompt,
            userInput,
            llmModel,
            temperature,
            maxTokens,
          },
        })
        .select("id")
        .single()

      if (jobError) {
        return reply.status(500).send({
          error: { code: "internal_error", message: jobError.message },
        })
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      const sse = createSSEStream(req, reply)

      sse.sendEvent({
        type: "metadata",
        data: { jobId: job.id, model: llmModel, maxTokens },
      })

      const abortController = new AbortController()
      req.raw.once("close", () => abortController.abort())

      let fullText = ""

      try {
        const finalResponse = await llmStream(
          {
            modelId: llmModel,
            system: systemPrompt,
            messages: [{ role: "user", content: buildUserContent(userInput, referenceImageUrls) }],
            maxTokens,
            temperature,
          },
          (delta) => {
            if (sse.isClosed) return
            fullText += delta
            sse.sendEvent({ type: "token", data: delta })
          },
          abortController.signal,
        )

        await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: {
              generatedText: fullText,
              model: llmModel,
              usage: finalResponse.usage,
            },
            provider_cost: finalResponse.providerCost ?? null,
          })
          .eq("id", job.id)

        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        if (!sse.isClosed) {
          sse.sendEvent({
            type: "done",
            data: {
              jobId: job.id,
              generatedText: fullText,
              usage: finalResponse.usage,
            },
          })
          sse.close()
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "LLM API stream failed"

        await supabase
          .from("jobs")
          .update({ status: "failed", output_data: { error: message } })
          .eq("id", job.id)

        if (usageLogId) {
          await CreditsService.refundCredits(usageLogId)
        }

        if (!sse.isClosed) {
          sse.sendEvent({
            type: "error",
            data: { code: "llm_error", message },
          })
          sse.close()
        }
      }
    },
  )
}
