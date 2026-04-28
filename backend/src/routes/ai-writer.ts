import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { createSSEStream } from "../lib/sse.js"
import { llmComplete, llmStream } from "../lib/llm-client.js"
import { LLM_MODEL_IDS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"

const aiWriterBody = z.object({
  systemPrompt: z.string().max(10000),
  userInput: z.string().min(1).max(10000),
  userPrompt: z.string().max(8000).optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).max(16384).default(4096),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
})

export async function aiWriterRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // POST /v1/ai-writer/generate  (Legacy synchronous endpoint)
  // ---------------------------------------------------------------------------

  app.post(
    "/v1/ai-writer/generate",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("ai-writer", req.body)),
      config: { requestTimeout: 120000 } as Record<string, unknown>,
    },
    async (req, reply) => {
      // Set timeouts at every layer to prevent premature connection close
      req.raw.setTimeout(120000)
      reply.raw.setTimeout(120000)

      const parsed = aiWriterBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { systemPrompt, userInput, temperature, maxTokens } =
        parsed.data
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

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["ai-writer"]
      const modelIdentifier = buildLlmCreditIdentifier("ai-writer", llmModel)

      // Create a job record for audit trail
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "ai-writer"),
        })
        .select("id")
        .single()

      if (jobError) {
        return reply.status(500).send({
          error: { code: "internal_error", message: jobError.message },
        })
      }

      // Reserve credits
      const reservation = await reserveCreditsForJob(
        req,
        reply,
        job.id,
        modelIdentifier,
      )
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const response = await llmComplete({
          modelId: llmModel,
          system: systemPrompt,
          messages: [{ role: "user", content: userInput }],
          maxTokens,
          temperature,
        })

        const generatedText = response.text

        // Finalize job and credits
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
        } catch (postErr) {
          console.error("[ai-writer] Post-API error:", postErr)
        }

        return reply.send({ jobId: job.id, generatedText })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Claude API call failed"

        console.error("[ai-writer] Error details:", JSON.stringify(err, null, 2))

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
  // POST /v1/ai-writer/generate-stream  (SSE streaming version)
  // ---------------------------------------------------------------------------

  app.post(
    "/v1/ai-writer/generate-stream",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("ai-writer", req.body)),
      config: { requestTimeout: 120000 } as Record<string, unknown>,
    },
    async (req, reply) => {
      req.raw.setTimeout(120000)
      reply.raw.setTimeout(120000)

      const parsed = aiWriterBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { systemPrompt, userInput, temperature, maxTokens } =
        parsed.data
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

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["ai-writer"]
      const modelIdentifier = buildLlmCreditIdentifier("ai-writer", llmModel)

      // Create job record
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "ai-writer-stream"),
        })
        .select("id")
        .single()

      if (jobError) {
        return reply.status(500).send({
          error: { code: "internal_error", message: jobError.message },
        })
      }

      // Reserve credits
      const reservation = await reserveCreditsForJob(
        req,
        reply,
        job.id,
        modelIdentifier,
      )
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      // Open SSE stream -- from here on, errors go through the stream
      const sse = await createSSEStream(req, reply)

      sse.sendEvent({
        type: "metadata",
        data: { jobId: job.id, model: llmModel, maxTokens },
      })

      // Abort upstream LLM stream when client disconnects
      const abortController = new AbortController()
      req.raw.on("close", () => abortController.abort())

      let fullText = ""

      try {
        const finalResponse = await llmStream(
          {
            modelId: llmModel,
            system: systemPrompt,
            messages: [{ role: "user", content: userInput }],
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

        if (sse.isClosed) {
          // Still finalize job and credits even if client disconnected
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
          return
        }

        // Finalize job
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

        // Commit credits
        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        sse.sendEvent({
          type: "done",
          data: {
            jobId: job.id,
            generatedText: fullText,
            usage: finalResponse.usage,
          },
        })
        sse.close()
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Claude API stream failed"

        console.error("[ai-writer-stream] Error:", message)

        // Mark job as failed
        await supabase
          .from("jobs")
          .update({ status: "failed", output_data: { error: message } })
          .eq("id", job.id)

        // Refund credits
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
