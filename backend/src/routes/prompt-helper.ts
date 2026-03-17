import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { getAnthropicClient } from "../lib/anthropic.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildPromptHelperSystem } from "../prompts/prompt-helper-system.js"

const promptHelperBody = z.object({
  nodeType: z.string(),
  prompt: z.string().max(5000),
  provider: z.string().optional(),
  model: z.string().optional(),
  style: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().optional(),
  additionalContext: z.string().max(1000).optional(),
})

export async function promptHelperRoutes(app: FastifyInstance) {
  app.post(
    "/v1/prompt-helper/enhance",
    {
      preHandler: creditGuard(() => "prompt-helper"),
    },
    async (req, reply) => {
      const parsed = promptHelperBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { nodeType, prompt, provider, model, style, aspectRatio, duration, additionalContext } = parsed.data
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

      const modelIdentifier = "prompt-helper"

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "prompt-helper",
            nodeType,
            prompt,
            provider,
            style,
          },
        })
        .select("id")
        .single()

      if (jobError) {
        return reply.status(500).send({
          error: { code: "internal_error", message: jobError.message },
        })
      }

      const reservation = await reserveCreditsForJob(
        req,
        reply,
        job.id,
        modelIdentifier,
      )
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const anthropic = getAnthropicClient()

        const systemPrompt = buildPromptHelperSystem({
          nodeType,
          provider,
          model,
          style,
          aspectRatio,
          duration,
        })

        let userMessage = `Please enhance this prompt:\n\n${prompt}`
        if (additionalContext) {
          userMessage += `\n\nAdditional context from the user: ${additionalContext}`
        }

        const response = await anthropic.messages.create({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 1024,
          temperature: 0.7,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        })

        const textBlock = response.content.find((b) => b.type === "text")
        const enhancedPrompt = textBlock?.text?.trim() ?? ""

        try {
          await supabase
            .from("jobs")
            .update({
              status: "completed",
              output_data: { enhancedPrompt, usage: response.usage },
            })
            .eq("id", job.id)

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
          }
        } catch (postErr) {
          console.error("[prompt-helper] Post-API error:", postErr)
        }

        return reply.send({ jobId: job.id, enhancedPrompt })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Prompt enhancement failed"

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
}
