import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { createSSEStream } from "../lib/sse.js"
import { getAnthropicClient } from "../lib/anthropic.js"
import { extractWorkflowId } from "../lib/request-helpers.js"
import { AI_WRITER_PROVIDERS } from "../../../packages/shared/src/model-constants.js"

const aiWriterBody = z.object({
  systemPrompt: z.string().max(10000),
  userInput: z.string().min(1).max(10000),
  provider: z.enum(AI_WRITER_PROVIDERS).default("claude"),
  model: z.string().default("claude-sonnet-4-5-20250929"),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).max(16384).default(4096),
  userId: z.string().uuid().optional(),
})

export async function aiWriterRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // POST /v1/ai-writer/generate  (Legacy synchronous endpoint)
  // ---------------------------------------------------------------------------

  app.post(
    "/v1/ai-writer/generate",
    {
      preHandler: creditGuard(() => "ai-writer"),
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

      const { systemPrompt, userInput, model, temperature, maxTokens } =
        parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      if (!config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "Anthropic API key not configured",
          },
        })
      }

      const modelIdentifier = "ai-writer"

      // Create a job record for audit trail
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          user_id: userId,
          status: "pending",
          input_data: {
            type: "ai-writer",
            systemPrompt,
            userInput,
            model,
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

      console.log("[ai-writer] Job inserted:", job.id)

      // Reserve credits
      const reservation = await reserveCreditsForJob(
        req,
        reply,
        job.id,
        modelIdentifier,
      )
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      // Call Anthropic Claude API synchronously
      try {
        const anthropic = getAnthropicClient()

        console.log("[ai-writer] Calling Anthropic API with model:", model, "maxTokens:", maxTokens)

        const response = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages: [{ role: "user", content: userInput }],
        })

        console.log("[ai-writer] Success, output tokens:", response.usage.output_tokens, "stop_reason:", response.stop_reason)

        // Extract text from response
        const textBlock = response.content.find((b) => b.type === "text")
        const generatedText = textBlock?.text ?? ""

        // Finalize job and credits
        try {
          const { error: updateError } = await supabase
            .from("jobs")
            .update({
              status: "completed",
              output_data: { generatedText, model, usage: response.usage },
            })
            .eq("id", job.id)

          if (updateError) {
            console.error("[ai-writer] Supabase job update error:", updateError.message)
          } else {
            console.log("[ai-writer] Job marked completed")
          }

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
            console.log("[ai-writer] Credits finalized")
          }
        } catch (postErr) {
          console.error("[ai-writer] Post-API error:", postErr)
        }

        console.log("[ai-writer] Sending response, text length:", generatedText.length)
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
      preHandler: creditGuard(() => "ai-writer"),
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

      const { systemPrompt, userInput, model, temperature, maxTokens } =
        parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      if (!config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "Anthropic API key not configured",
          },
        })
      }

      const modelIdentifier = "ai-writer"

      // Create job record
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          user_id: userId,
          status: "pending",
          input_data: {
            type: "ai-writer-stream",
            systemPrompt,
            userInput,
            model,
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

      console.log("[ai-writer-stream] Job inserted:", job.id)

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
      const sse = createSSEStream(req, reply)

      sse.sendEvent({
        type: "metadata",
        data: { jobId: job.id, model, maxTokens },
      })

      const anthropic = getAnthropicClient()
      let fullText = ""

      console.log(
        "[ai-writer-stream] Starting stream, model:",
        model,
        "maxTokens:",
        maxTokens,
      )

      try {
        const stream = anthropic.messages.stream({
          model,
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages: [{ role: "user", content: userInput }],
        })

        stream.on("text", (delta) => {
          if (sse.isClosed) {
            stream.abort()
            return
          }
          fullText += delta
          sse.sendEvent({ type: "token", data: delta })
        })

        // Wait for the stream to finish
        const finalMessage = await stream.finalMessage()

        if (sse.isClosed) {
          console.log("[ai-writer-stream] Client disconnected during stream")
          // Still finalize job and credits even if client disconnected
          await supabase
            .from("jobs")
            .update({
              status: "completed",
              output_data: {
                generatedText: fullText,
                model,
                usage: finalMessage.usage,
              },
            })
            .eq("id", job.id)

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
          }
          return
        }

        console.log(
          "[ai-writer-stream] Complete, tokens:",
          finalMessage.usage.output_tokens,
        )

        // Finalize job
        const { error: updateError } = await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: {
              generatedText: fullText,
              model,
              usage: finalMessage.usage,
            },
          })
          .eq("id", job.id)

        if (updateError) {
          console.error(
            "[ai-writer-stream] Job update error:",
            updateError.message,
          )
        }

        // Commit credits
        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
          console.log("[ai-writer-stream] Credits finalized")
        }

        sse.sendEvent({
          type: "done",
          data: {
            jobId: job.id,
            generatedText: fullText,
            usage: finalMessage.usage,
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
