import type { FastifyInstance } from "fastify"
import { z } from "zod"
import Anthropic from "@anthropic-ai/sdk"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { SCENE_GRAPH_SYSTEM_PROMPT } from "../prompts/scene-graph-system.js"
import { validateSceneGraph } from "../lib/scene-graph-validator.js"

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
  assets: z.array(z.object({
    id: z.string(),
    type: z.enum(["image", "video", "audio"]),
    url: z.string(),
    label: z.string().optional(),
    durationSeconds: z.number().optional(),
  })).min(1),
  fps: z.number().min(15).max(60).default(30),
  aspectRatio: z.string().default("16:9"),
  durationSeconds: z.number().min(1).max(300).default(30),
  userId: z.string().uuid(),
})

export async function sceneGraphAIRoutes(app: FastifyInstance) {
  app.post(
    "/v1/scene-graph/generate",
    {
      preHandler: creditGuard(() => "scene-graph-ai"),
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

      const { prompt, assets, fps, aspectRatio, durationSeconds, userId } = parsed.data

      if (!config.ANTHROPIC_API_KEY) {
        return reply.status(503).send({
          error: {
            code: "provider_unavailable",
            message: "Anthropic API key not configured",
          },
        })
      }

      const dimensions = ASPECT_DIMENSIONS[aspectRatio] ?? ASPECT_DIMENSIONS["16:9"]
      const durationInFrames = Math.round(durationSeconds * fps)

      // Create job record
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: null,
          user_id: userId,
          status: "pending",
          input_data: {
            type: "scene-graph-ai",
            prompt,
            assetCount: assets.length,
            fps,
            aspectRatio,
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
      const reservation = await reserveCreditsForJob(req, reply, job.id, "scene-graph-ai")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      try {
        const anthropic = getAnthropicClient()

        // Build user message with asset list
        const assetList = assets.map((a, i) => {
          const label = a.label || `Asset ${i + 1}`
          const duration = a.durationSeconds ? ` (${a.durationSeconds}s)` : ""
          return `- ${label} [${a.type}]${duration}: ${a.url}`
        }).join("\n")

        const userMessage = `Create a video composition with these settings:
- FPS: ${fps}
- Resolution: ${dimensions.width}x${dimensions.height} (${aspectRatio})
- Total duration: ${durationSeconds} seconds (${durationInFrames} frames)

Available media assets:
${assetList}

Composition style: ${prompt}`

        console.log(`[scene-graph-ai] Generating for job ${job.id}, ${assets.length} assets, ${durationSeconds}s`)

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 4096,
          temperature: 0.3,
          system: SCENE_GRAPH_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        })

        const textBlock = response.content.find((b) => b.type === "text")
        const rawText = textBlock?.text ?? ""

        // Parse JSON from response (handle potential markdown wrapping)
        let jsonText = rawText.trim()
        if (jsonText.startsWith("```")) {
          jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
        }

        let rawJson: unknown
        try {
          rawJson = JSON.parse(jsonText)
        } catch {
          console.error(`[scene-graph-ai] Failed to parse JSON for job ${job.id}`)
          throw new Error("AI returned invalid JSON. Please try again with a different prompt.")
        }

        // Validate and auto-fix
        const assetUrls = assets.map((a) => a.url)
        const validation = validateSceneGraph(rawJson, assetUrls, durationInFrames, fps)

        if (validation.autoFixed.length > 0) {
          console.log(`[scene-graph-ai] Auto-fixed ${validation.autoFixed.length} issues for job ${job.id}`)
        }

        if (!validation.valid) {
          console.error(`[scene-graph-ai] Validation errors for job ${job.id}:`, validation.errors)
          // Still return the scene graph with warnings — let the user decide
        }

        const sceneGraph = validation.sceneGraph ?? rawJson

        // Finalize job
        await supabase
          .from("jobs")
          .update({
            status: "completed",
            output_data: {
              sceneGraph,
              validationErrors: validation.errors,
              autoFixes: validation.autoFixed,
              usage: response.usage,
            },
          })
          .eq("id", job.id)

        if (usageLogId) {
          await CreditsService.commitCredits(usageLogId)
        }

        console.log(`[scene-graph-ai] Job ${job.id} completed, tokens: ${response.usage.output_tokens}`)

        return reply.send({
          jobId: job.id,
          sceneGraph,
          validationErrors: validation.errors,
          autoFixes: validation.autoFixed,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Scene graph generation failed"
        console.error(`[scene-graph-ai] Error for job ${job.id}:`, message)

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
