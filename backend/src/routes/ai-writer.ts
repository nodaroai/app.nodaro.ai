import type { FastifyInstance } from "fastify"
import { z } from "zod"
import Anthropic from "@anthropic-ai/sdk"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"

const aiWriterBody = z.object({
  systemPrompt: z.string().max(10000),
  userInput: z.string().min(1).max(10000),
  provider: z.enum(["claude"]).default("claude"),
  model: z.string().default("claude-sonnet-4-5-20250929"),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).max(8192).default(2048),
  userId: z.string().uuid().optional(),
})

export async function aiWriterRoutes(app: FastifyInstance) {
  app.post(
    "/v1/ai-writer/generate",
    {
      preHandler: creditGuard(() => "ai-writer"),
    },
    async (req, reply) => {
      const parsed = aiWriterBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { systemPrompt, userInput, model, temperature, maxTokens, userId } =
        parsed.data

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "userId is required" },
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
          workflow_id: null,
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

      // Reserve credits
      const reservation = await reserveCreditsForJob(
        req,
        reply,
        job.id,
        modelIdentifier
      )
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      // Call Anthropic Claude API synchronously
      try {
        const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

        const response = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages: [{ role: "user", content: userInput }],
        })

        // Extract text from response
        const textBlock = response.content.find((b) => b.type === "text")
        const generatedText = textBlock?.text ?? ""

        // Mark job as completed
        await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: { generatedText, model, usage: response.usage },
          })
          .eq("id", job.id)

        // Commit credits
        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        return { jobId: job.id, generatedText }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Claude API call failed"

        // Mark job as failed
        await supabase
          .from("jobs")
          .update({ status: "failed", output_data: { error: message } })
          .eq("id", job.id)

        // Refund credits
        if (usageLogId) {
          await CreditsService.refundCredits(usageLogId)
        }

        return reply.status(502).send({
          error: { code: "llm_error", message },
        })
      }
    }
  )
}
