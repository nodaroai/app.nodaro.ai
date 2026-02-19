import type { FastifyInstance } from "fastify"
import { z } from "zod"
import Anthropic from "@anthropic-ai/sdk"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { THREE_D_TITLE_SYSTEM_PROMPT } from "../prompts/three-d-title-system.js"
import { validateThreeDTitlePlan } from "../lib/three-d-title-validator.js"

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
  backgroundMediaUrl: z.string().url().optional(),
  userId: z.string().uuid(),
})

export async function threeDTitleAIRoutes(app: FastifyInstance) {
  app.post(
    "/v1/3d-title/generate",
    {
      preHandler: creditGuard(() => "3d-title"),
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

      const { prompt, fps, durationSeconds, backgroundMediaUrl, userId } = parsed.data

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

      const backgroundColor = parsed.data.backgroundColor ?? "#000000"
      const durationInFrames = Math.round(durationSeconds * fps)

      // Create job record
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: null,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "3d-title",
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
      const reservation = await reserveCreditsForJob(req, reply, job.id, "3d-title")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const anthropic = getAnthropicClient()

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

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 3072,
          temperature: 0.4,
          system: THREE_D_TITLE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        })

        const textBlock = response.content.find((b) => b.type === "text")
        const rawText = textBlock?.text ?? ""

        // Parse JSON from response
        let jsonText = rawText.trim()
        if (jsonText.startsWith("```")) {
          jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
        }

        let rawJson: unknown
        try {
          rawJson = JSON.parse(jsonText)
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
          })
          .eq("id", job.id)

        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        console.log(`[3d-title-ai] Job ${job.id} completed, tokens: ${response.usage.output_tokens}`)

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
