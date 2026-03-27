import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { llmComplete } from "../lib/llm-client.js"
import { LLM_MODEL_IDS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "../../../packages/shared/src/llm-models.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildWizardAnalyzeSystem, buildWizardGenerateSystem } from "../prompts/prompt-wizard-system.js"

const nodeContextSchema = z.object({
  connectedInputTypes: z.array(z.string()).optional(),
  referenceImageCount: z.number().optional(),
  referenceImageUrls: z.array(z.string().url()).max(10).optional(),
  hasSourceVideo: z.boolean().optional(),
}).optional()

const wizardAnalyzeBody = z.object({
  action: z.literal("analyze"),
  nodeType: z.string(),
  prompt: z.string().max(5000).optional(),
  provider: z.string().optional(),
  style: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  nodeContext: nodeContextSchema,
  userPreference: z.string().max(500).optional(),
})

const wizardSelectionSchema = z.object({
  category: z.string(),
  value: z.string(),
  isCustom: z.boolean(),
})

const wizardGenerateBody = z.object({
  action: z.literal("generate"),
  nodeType: z.string(),
  provider: z.string().optional(),
  style: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
  selections: z.array(wizardSelectionSchema).min(1),
  originalPrompt: z.string().max(5000).optional(),
  nodeContext: nodeContextSchema,
  userPreference: z.string().max(500).optional(),
})

const wizardBody = z.discriminatedUnion("action", [wizardAnalyzeBody, wizardGenerateBody])

// Response validation schemas
const wizardOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

const wizardQuestionSchema = z.object({
  category: z.string(),
  label: z.string(),
  options: z.array(wizardOptionSchema).min(1),
  selected: z.union([z.string(), z.array(z.string()), z.null()]),
  allowCustom: z.boolean(),
  multi: z.boolean().optional(),
})

const analyzeResponseSchema = z.object({
  questions: z.array(wizardQuestionSchema).min(1).max(12),
})

const generateResponseSchema = z.object({
  prompt: z.string().min(1),
  recommendedModel: z.object({
    provider: z.string(),
    field: z.string(),
    label: z.string(),
    reason: z.string(),
  }).optional(),
})

export async function promptHelperRoutes(app: FastifyInstance) {
  app.post(
    "/v1/prompt-helper/wizard",
    {
      preHandler: creditGuard((req) => resolveLlmCreditId("prompt-helper", req.body)),
    },
    async (req, reply) => {
      const parsed = wizardBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: { code: "provider_unavailable", message: "LLM API key not configured" },
        })
      }

      const body = parsed.data
      const llmModel = body.llmModel ?? LLM_FEATURE_DEFAULTS["prompt-helper"]
      const modelIdentifier = buildLlmCreditIdentifier("prompt-helper", llmModel)

      // Create job record
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: {
            type: `prompt-wizard:${body.action}`,
            nodeType: body.nodeType,
            ...(body.action === "analyze"
              ? { prompt: body.prompt }
              : { selections: body.selections, originalPrompt: body.originalPrompt }),
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
        let systemPrompt: string
        let userMessage: string

        if (body.action === "analyze") {
          systemPrompt = buildWizardAnalyzeSystem({
            nodeType: body.nodeType,
            provider: body.provider,
            style: body.style,
            aspectRatio: body.aspectRatio,
            duration: body.duration,
            nodeContext: body.nodeContext,
            userPreference: body.userPreference,
          })
          userMessage = body.prompt
            ? `Analyze this prompt idea and generate questions:\n\n${body.prompt}`
            : `Generate questions to help build a ${body.nodeType} prompt from scratch. The user has not provided any initial idea.`
        } else {
          systemPrompt = buildWizardGenerateSystem({
            nodeType: body.nodeType,
            provider: body.provider,
            style: body.style,
            aspectRatio: body.aspectRatio,
            duration: body.duration,
            selections: body.selections,
            originalPrompt: body.originalPrompt,
            nodeContext: body.nodeContext,
            userPreference: body.userPreference,
          })
          userMessage = `Build a prompt from these selections:\n\n${body.selections.map((s) => `${s.category}: ${s.value}`).join("\n")}`
          if (body.originalPrompt) {
            userMessage += `\n\nOriginal idea: ${body.originalPrompt}`
          }
        }

        // Build message content — include reference images for multimodal analysis
        const refUrls = body.action === "analyze" ? (body.nodeContext?.referenceImageUrls ?? []) : []
        let messageContent: string | Array<{ type: "text"; text: string } | { type: "image"; url: string }>

        if (refUrls.length > 0) {
          messageContent = [
            ...refUrls.map((url, i) => ({ type: "image" as const, url })),
            { type: "text" as const, text: `The above ${refUrls.length === 1 ? "image is a" : `${refUrls.length} images are`} reference image${refUrls.length > 1 ? "s" : ""} connected to this node.\n\n${userMessage}` },
          ]
        } else {
          messageContent = userMessage
        }

        const response = await llmComplete({
          modelId: llmModel,
          system: systemPrompt,
          messages: [{ role: "user", content: messageContent }],
          maxTokens: 4096,
          temperature: 0.7,
        })

        // Parse and validate JSON response
        let responseText = response.text.trim()
        // Strip markdown code fences if present
        if (responseText.startsWith("```")) {
          responseText = responseText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
        }

        let parsedResponse: unknown
        try {
          parsedResponse = JSON.parse(responseText)
        } catch {
          throw new Error("LLM returned invalid JSON")
        }

        let result: Record<string, unknown>

        if (body.action === "analyze") {
          const validated = analyzeResponseSchema.safeParse(parsedResponse)
          if (!validated.success) {
            throw new Error(`Malformed analyze response: ${validated.error.issues[0]?.message}`)
          }
          result = { jobId: job.id, questions: validated.data.questions }
        } else {
          const validated = generateResponseSchema.safeParse(parsedResponse)
          if (!validated.success) {
            throw new Error(`Malformed generate response: ${validated.error.issues[0]?.message}`)
          }
          result = {
            jobId: job.id,
            prompt: validated.data.prompt,
            ...(validated.data.recommendedModel && { recommendedModel: validated.data.recommendedModel }),
          }
        }

        // Mark job completed and commit credits
        try {
          await supabase
            .from("jobs")
            .update({ status: "completed", output_data: { ...result, usage: response.usage } })
            .eq("id", job.id)
          if (usageLogId) await CreditsService.commitCredits(usageLogId)
        } catch (postErr) {
          console.error("[prompt-wizard] Post-API error:", postErr)
        }

        return reply.send(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Prompt wizard failed"

        await supabase
          .from("jobs")
          .update({ status: "failed", output_data: { error: message } })
          .eq("id", job.id)

        if (usageLogId) await CreditsService.refundCredits(usageLogId)

        const isMalformed = message.includes("Malformed") || message.includes("invalid JSON")
        return reply.status(isMalformed ? 502 : 500).send({
          error: { code: isMalformed ? "malformed_response" : "llm_error", message },
        })
      }
    },
  )
}
