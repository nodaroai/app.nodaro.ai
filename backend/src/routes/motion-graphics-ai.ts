import type { FastifyInstance } from "fastify"
import { z } from "zod"
import Anthropic from "@anthropic-ai/sdk"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { MOTION_GRAPHICS_SYSTEM_PROMPT } from "../prompts/motion-graphics-system.js"
import { validateMotionGraphicsPlan } from "../lib/motion-graphics-validator.js"
import { extractJsonFromAIResponse } from "../lib/json-utils.js"

let _anthropic: Anthropic | null = null
function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
  }
  return _anthropic
}

const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
}

const generateBody = z.object({
  prompt: z.string().min(1).max(2000),
  fps: z.number().min(15).max(60).default(30),
  aspectRatio: z.string().optional(),
  width: z.number().min(100).max(3840).optional(),
  height: z.number().min(100).max(3840).optional(),
  durationSeconds: z.number().min(1).max(60),
  backgroundColor: z.string().optional(),
  userId: z.string().uuid(),
})

export async function motionGraphicsAIRoutes(app: FastifyInstance) {
  app.post(
    "/v1/motion-graphics/generate",
    {
      preHandler: creditGuard(() => "motion-graphics"),
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

      const { prompt, fps, durationSeconds, userId } = parsed.data

      if (!config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "Anthropic API key not configured",
          },
        })
      }

      // Resolve dimensions from aspectRatio or explicit width/height
      let width = parsed.data.width ?? 1920
      let height = parsed.data.height ?? 1080
      if (parsed.data.aspectRatio && ASPECT_DIMENSIONS[parsed.data.aspectRatio]) {
        const dims = ASPECT_DIMENSIONS[parsed.data.aspectRatio]
        width = dims.width
        height = dims.height
      }

      const backgroundColor = parsed.data.backgroundColor ?? "#00000000"
      const durationInFrames = Math.round(durationSeconds * fps)

      // Create job record
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: null,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "motion-graphics",
            prompt,
            fps,
            width,
            height,
            durationSeconds,
            backgroundColor,
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
      const reservation = await reserveCreditsForJob(req, reply, job.id, "motion-graphics")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const anthropic = getAnthropicClient()

        const userMessage = `Create motion graphics:
- FPS: ${fps}
- Resolution: ${width}x${height}
- Duration: ${durationSeconds} seconds (${durationInFrames} frames)
- Background color: ${backgroundColor}

Prompt: ${prompt}`

        console.log(`[motion-graphics-ai] Generating for job ${job.id}, ${durationSeconds}s`)

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 2048,
          temperature: 0.3,
          system: MOTION_GRAPHICS_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        })

        const textBlock = response.content.find((b) => b.type === "text")
        const rawText = textBlock?.text ?? ""

        // Parse JSON from response
        let rawJson: unknown
        try {
          rawJson = JSON.parse(extractJsonFromAIResponse(rawText))
        } catch {
          console.error(`[motion-graphics-ai] Failed to parse JSON for job ${job.id}`)
          throw new Error("AI returned invalid JSON. Please try again with a different prompt.")
        }

        // Validate and auto-fix
        const validation = validateMotionGraphicsPlan(rawJson, fps, durationInFrames)

        if (validation.autoFixed.length > 0) {
          console.log(`[motion-graphics-ai] Auto-fixed ${validation.autoFixed.length} issues for job ${job.id}`)
        }

        const motionPlan = validation.plan ?? rawJson

        // Finalize job
        await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: {
              motionPlan,
              validationErrors: validation.errors,
              autoFixes: validation.autoFixed,
              usage: response.usage,
            },
          })
          .eq("id", job.id)

        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        console.log(`[motion-graphics-ai] Job ${job.id} completed, tokens: ${response.usage.output_tokens}`)

        return reply.send({
          jobId: job.id,
          motionPlan,
          validationErrors: validation.errors,
          autoFixes: validation.autoFixed,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Motion graphics plan generation failed"
        console.error(`[motion-graphics-ai] Error for job ${job.id}:`, message)

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
