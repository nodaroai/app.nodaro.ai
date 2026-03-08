import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { rateLimiter } from "../middleware/rate-limit.js"

const aiRateLimit = rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: "ai-lo" })
import { CreditsService } from "../billing/credits.js"
import { LOTTIE_OVERLAY_SYSTEM_PROMPT } from "../prompts/lottie-overlay-system.js"
import { validateLottieOverlayPlan } from "../lib/lottie-overlay-validator.js"
import { extractJsonFromAIResponse } from "../lib/json-utils.js"
import { getAnthropicClient, CLAUDE_MODEL } from "../lib/anthropic.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const lottieAssetSchema = z.object({
  id: z.string(),
  url: safeUrlSchema,
  name: z.string(),
  durationSeconds: z.number().optional(),
})

const generateBody = z.object({
  prompt: z.string().min(1).max(2000),
  inputVideoUrl: safeUrlSchema,
  fps: z.number().min(15).max(60).default(30),
  durationSeconds: z.number().min(1).max(300),
  width: z.number().min(100).max(3840).optional(),
  height: z.number().min(100).max(3840).optional(),
  lottieAssets: z.array(lottieAssetSchema).optional(),
  userId: z.string().uuid(),
})

export async function lottieOverlayAIRoutes(app: FastifyInstance) {
  app.post(
    "/v1/lottie-overlay/generate",
    {
      preHandler: [aiRateLimit, creditGuard(() => "lottie-overlay")],
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

      const { prompt, inputVideoUrl, fps, durationSeconds, lottieAssets } = parsed.data
      const userId = req.userId

      if (!config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "Anthropic API key not configured",
          },
        })
      }

      const width = parsed.data.width ?? 1920
      const height = parsed.data.height ?? 1080
      const durationInFrames = Math.round(durationSeconds * fps)

      // Create job record
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          user_id: userId,
          status: "pending",
          input_data: {
            type: "lottie-overlay",
            prompt,
            inputVideoUrl,
            fps,
            width,
            height,
            durationSeconds,
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
      const reservation = await reserveCreditsForJob(req, reply, job.id, "lottie-overlay")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const anthropic = getAnthropicClient()

        const assetLines = lottieAssets?.map((a) =>
          `- ${a.name} (${a.url})${a.durationSeconds ? ` [${a.durationSeconds}s]` : ""}`,
        )
        const assetSection = assetLines?.length
          ? `\n\nUser-provided Lottie assets (prefer these over built-in ones):\n${assetLines.join("\n")}`
          : ""

        const userMessage = `Add Lottie animation overlays to this video:
- Source video: ${inputVideoUrl}
- FPS: ${fps}
- Resolution: ${width}x${height}
- Duration: ${durationSeconds} seconds (${durationInFrames} frames)

Overlay style: ${prompt}${assetSection}`

        console.log(`[lottie-overlay-ai] Generating for job ${job.id}, ${durationSeconds}s video`)

        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 2048,
          temperature: 0.3,
          system: LOTTIE_OVERLAY_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        })

        const textBlock = response.content.find((b) => b.type === "text")
        const rawText = textBlock?.text ?? ""

        // Parse JSON from response
        let rawJson: unknown
        try {
          rawJson = JSON.parse(extractJsonFromAIResponse(rawText))
        } catch {
          console.error(`[lottie-overlay-ai] Failed to parse JSON for job ${job.id}`)
          throw new Error("AI returned invalid JSON. Please try again with a different prompt.")
        }

        // Validate and auto-fix
        const validation = validateLottieOverlayPlan(rawJson, inputVideoUrl, fps, durationInFrames)

        if (validation.autoFixed.length > 0) {
          console.log(`[lottie-overlay-ai] Auto-fixed ${validation.autoFixed.length} issues for job ${job.id}`)
        }

        const overlayPlan = validation.plan ?? rawJson

        // Finalize job
        await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: {
              overlayPlan,
              validationErrors: validation.errors,
              autoFixes: validation.autoFixed,
              usage: response.usage,
            },
          })
          .eq("id", job.id)

        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        console.log(`[lottie-overlay-ai] Job ${job.id} completed, tokens: ${response.usage.output_tokens}`)

        return reply.send({
          jobId: job.id,
          overlayPlan,
          validationErrors: validation.errors,
          autoFixes: validation.autoFixed,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Lottie overlay plan generation failed"
        console.error(`[lottie-overlay-ai] Error for job ${job.id}:`, message)

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
