import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { rateLimiter } from "../middleware/rate-limit.js"

const aiRateLimit = rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: "ai-3d" })
import { CreditsService } from "../ee/billing/credits.js"
import { THREE_D_TITLE_SYSTEM_PROMPT } from "../prompts/three-d-title-system.js"
import { validateThreeDTitlePlan } from "../lib/three-d-title-validator.js"
import { extractJsonFromAIResponse } from "../lib/json-utils.js"
import { llmComplete } from "../lib/llm-client.js"
import { LLM_MODEL_IDS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { ASPECT_DIMENSIONS } from "../lib/aspect-dimensions.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"

const generateBody = z.object({
  prompt: z.string().min(1).max(2000),
  userPrompt: z.string().max(8000).optional(),
  fps: z.number().min(15).max(60).default(30),
  aspectRatio: z.string().optional(),
  width: z.number().min(100).max(3840).optional(),
  height: z.number().min(100).max(3840).optional(),
  durationSeconds: z.number().min(1).max(60),
  backgroundColor: z.string().optional(),
  backgroundMediaUrl: safeUrlSchema.optional(),
  userId: z.string().uuid(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
})

export async function threeDTitleAIRoutes(app: FastifyInstance) {
  app.post(
    "/v1/3d-title/generate",
    {
      preHandler: [aiRateLimit, creditGuard((req) => resolveLlmCreditId("3d-title", req.body))],
      config: { requestTimeout: 60000 } as Record<string, unknown>,
    },
    async (req, reply) => {
      req.raw.setTimeout(60000)
      reply.raw.setTimeout(60000)

      const parsed = generateBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { prompt, fps, durationSeconds, backgroundMediaUrl } = parsed.data
      const userId = req.userId

      if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "LLM API key not configured",
          },
        })
      }

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["3d-title"]

      // Resolve dimensions from aspectRatio or explicit width/height
      let width = parsed.data.width ?? 1920
      let height = parsed.data.height ?? 1080
      if (parsed.data.aspectRatio && ASPECT_DIMENSIONS[parsed.data.aspectRatio]) {
        const dims = ASPECT_DIMENSIONS[parsed.data.aspectRatio]
        width = dims.width
        height = dims.height
      }

      const backgroundColor = parsed.data.backgroundColor ?? "#000000"
      const durationInFrames = Math.round(durationSeconds * fps)

      // Create job record
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: { ...buildJobInputData(parsed.data, "3d-title"), width, height, backgroundColor },
        })
        .select("id")
        .single()

      if (jobError) {
        return reply.status(500).send({
          error: { code: "internal_error", message: jobError.message },
        })
      }

      // Reserve credits
      const modelIdentifier = buildLlmCreditIdentifier("3d-title", llmModel)
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const bgSection = backgroundMediaUrl
          ? `\n- Background media: ${backgroundMediaUrl}`
          : ""

        const userMessage = `Create an animated 3D title scene:
- FPS: ${fps}
- Resolution: ${width}x${height}
- Duration: ${durationSeconds} seconds (${durationInFrames} frames)
- Background color: ${backgroundColor}${bgSection}

Title prompt: ${prompt}`

        console.log(`[3d-title-ai] Generating for job ${job.id}, ${durationSeconds}s`)

        const response = await llmComplete({
          modelId: llmModel,
          system: THREE_D_TITLE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
          maxTokens: 3072,
          temperature: 0.4,
        })

        const rawText = response.text

        // Parse JSON from response
        let rawJson: unknown
        try {
          rawJson = JSON.parse(extractJsonFromAIResponse(rawText))
        } catch {
          console.error(`[3d-title-ai] Failed to parse JSON for job ${job.id}`)
          throw new Error("AI returned invalid JSON. Please try again with a different prompt.")
        }

        // Validate and auto-fix
        const validation = validateThreeDTitlePlan(
          rawJson,
          fps,
          durationInFrames,
          width,
          height,
          backgroundMediaUrl,
        )

        if (validation.autoFixed.length > 0) {
          console.log(`[3d-title-ai] Auto-fixed ${validation.autoFixed.length} issues for job ${job.id}`)
        }

        const titlePlan = validation.plan ?? rawJson

        // Finalize job
        await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: {
              titlePlan,
              validationErrors: validation.errors,
              autoFixes: validation.autoFixed,
              usage: response.usage,
            },
            provider_cost: response.providerCost ?? null,
          })
          .eq("id", job.id)

        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        console.log(`[3d-title-ai] Job ${job.id} completed, tokens: ${response.usage?.outputTokens}`)

        return reply.send({
          jobId: job.id,
          titlePlan,
          validationErrors: validation.errors,
          autoFixes: validation.autoFixed,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : "3D title plan generation failed"
        console.error(`[3d-title-ai] Error for job ${job.id}:`, message)

        await supabase
          .from("jobs") // tenant-scope-ignore: job.id is server-generated in this request
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
