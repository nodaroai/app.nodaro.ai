import type { FastifyInstance } from "fastify"
import { z } from "zod"
import Anthropic from "@anthropic-ai/sdk"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { AFTER_EFFECTS_SYSTEM_PROMPT } from "../prompts/after-effects-system.js"
import { validateAfterEffectsPlan } from "../lib/after-effects-validator.js"

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
  inputVideoUrl: z.string().url(),
  fps: z.number().min(15).max(60).default(30),
  width: z.number().min(100).max(3840).optional(),
  height: z.number().min(100).max(3840).optional(),
  aspectRatio: z.string().default("16:9"),
  durationSeconds: z.number().min(1).max(300),
  userId: z.string().uuid(),
})

export async function afterEffectsAIRoutes(app: FastifyInstance) {
  app.post(
    "/v1/after-effects/generate",
    {
      preHandler: creditGuard(() => "after-effects"),
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

      const { prompt, inputVideoUrl, fps, aspectRatio, durationSeconds, userId } = parsed.data

      if (!config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "Anthropic API key not configured",
          },
        })
      }

      const dimensions = ASPECT_DIMENSIONS[aspectRatio] ?? ASPECT_DIMENSIONS["16:9"]
      const width = parsed.data.width ?? dimensions.width
      const height = parsed.data.height ?? dimensions.height
      const durationInFrames = Math.round(durationSeconds * fps)

      // Create job record
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: null,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "after-effects",
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
      const reservation = await reserveCreditsForJob(req, reply, job.id, "after-effects")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const anthropic = getAnthropicClient()

        const userMessage = `Apply post-processing effects to this video:
- Source video: ${inputVideoUrl}
- FPS: ${fps}
- Resolution: ${width}x${height} (${aspectRatio})
- Duration: ${durationSeconds} seconds (${durationInFrames} frames)

Effect style: ${prompt}`

        console.log(`[after-effects-ai] Generating for job ${job.id}, ${durationSeconds}s video`)

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 2048,
          temperature: 0.3,
          system: AFTER_EFFECTS_SYSTEM_PROMPT,
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
          console.error(`[after-effects-ai] Failed to parse JSON for job ${job.id}`)
          throw new Error("AI returned invalid JSON. Please try again with a different prompt.")
        }

        // Validate and auto-fix
        let validation = validateAfterEffectsPlan(rawJson, inputVideoUrl, fps, durationInFrames)

        if (validation.autoFixed.length > 0) {
          console.log(`[after-effects-ai] Auto-fixed ${validation.autoFixed.length} issues for job ${job.id}`)
        }

        let effectPlan = validation.plan

        // If validation fails, try to salvage by filtering to valid effect types only
        if (!validation.valid) {
          const obj = (typeof rawJson === "object" && rawJson !== null ? { ...rawJson as Record<string, unknown> } : {}) as Record<string, unknown>
          const validTypes = new Set(["color-grade", "vignette", "film-grain", "noise-overlay", "letterbox", "motion-blur", "animated-blur"])
          const filteredEffects = (obj.effects as Array<Record<string, unknown>>)?.filter(
            (e) => validTypes.has(e.type as string),
          ) ?? []
          if (filteredEffects.length > 0) {
            obj.effects = filteredEffects
            const retry = validateAfterEffectsPlan(obj, inputVideoUrl, fps, durationInFrames)
            if (retry.valid) {
              effectPlan = retry.plan
              validation = retry
              console.log(`[after-effects-ai] Salvaged plan for job ${job.id} by filtering invalid effects`)
            } else {
              throw new Error("AI returned an invalid effect plan. Please try a different prompt.")
            }
          } else {
            throw new Error("AI returned an invalid effect plan. Please try a different prompt.")
          }
        }

        // Finalize job
        await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: {
              effectPlan,
              validationErrors: validation.errors,
              autoFixes: validation.autoFixed,
              usage: response.usage,
            },
          })
          .eq("id", job.id)

        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        console.log(`[after-effects-ai] Job ${job.id} completed, tokens: ${response.usage.output_tokens}`)

        return reply.send({
          jobId: job.id,
          effectPlan,
          validationErrors: validation.errors,
          autoFixes: validation.autoFixed,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : "After effects plan generation failed"
        console.error(`[after-effects-ai] Error for job ${job.id}:`, message)

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
