import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { llmComplete } from "../lib/llm-client.js"
import { LLM_MODEL_IDS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "../../../packages/shared/src/llm-models.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"

const qaCheckBody = z.object({
  content: z.string().min(1).max(50000),
  checkType: z
    .enum(["content", "quality", "consistency", "safety"])
    .default("content"),
  provider: z.enum(["claude", "gpt"]).default("claude"),
  threshold: z.number().min(0).max(1).default(0.7),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
})

const SYSTEM_PROMPTS: Record<string, string> = {
  content:
    "Evaluate whether this content is complete, coherent, and well-structured. Score from 0.0 (poor) to 1.0 (excellent).",
  quality:
    "Evaluate the overall quality of this content including clarity, grammar, and professionalism. Score from 0.0 (poor) to 1.0 (excellent).",
  consistency:
    "Evaluate whether this content is internally consistent with no contradictions or logical errors. Score from 0.0 (many issues) to 1.0 (fully consistent).",
  safety:
    "Evaluate whether this content is safe and appropriate. Check for harmful, offensive, or inappropriate material. Score from 0.0 (unsafe) to 1.0 (completely safe).",
}

export async function qaCheckRoutes(app: FastifyInstance) {
  app.post(
    "/v1/qa-check",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("qa-check", req.body)),
    },
    async (req, reply) => {
      const parsed = qaCheckBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { content, checkType, provider, threshold } = parsed.data
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

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["qa-check"]
      const modelIdentifier = buildLlmCreditIdentifier("qa-check", llmModel)

      // Create a job record for audit trail
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "qa-check",
            content,
            checkType,
            threshold,
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
        modelIdentifier,
      )
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const systemPrompt = `You are a QA evaluation assistant. ${SYSTEM_PROMPTS[checkType]}

You MUST respond with ONLY a valid JSON object in this exact format, no other text:
{"score": <number 0.0-1.0>, "approved": <true if score >= ${threshold}, false otherwise>, "reason": "<brief explanation>"}`

        const response = await llmComplete({
          modelId: llmModel,
          system: systemPrompt,
          messages: [{ role: "user", content: `Evaluate the following content:\n\n${content}` }],
          maxTokens: 1024,
        })

        const rawText = response.text

        // Parse the JSON response from Claude, with fallback
        let score = 0.5
        let approved = score >= threshold
        let reason = "Unable to parse evaluation result"

        try {
          const parsed = JSON.parse(rawText)
          score =
            typeof parsed.score === "number"
              ? Math.min(1, Math.max(0, parsed.score))
              : 0.5
          approved =
            typeof parsed.approved === "boolean"
              ? parsed.approved
              : score >= threshold
          reason =
            typeof parsed.reason === "string"
              ? parsed.reason
              : "No reason provided"
        } catch {
          // Claude didn't return valid JSON -- use fallback values
        }

        // Finalize job and credits
        try {
          await supabase
            .from("jobs")
            .update({
              status: "completed",
              output_data: {
                score,
                approved,
                reason,
                checkType,
                usage: response.usage,
              },
            })
            .eq("id", job.id)

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
          }
        } catch (postErr) {
          req.log.error(postErr, "[qa-check] Post-API error")
        }

        return reply.send({ jobId: job.id, score, approved, reason })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Claude API call failed"

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
