import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../billing/credits.js"
import { getAnthropicClient, CLAUDE_MODEL } from "../lib/anthropic.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const imageToTextBody = z.object({
  imageUrl: z.string().url(),
  detailLevel: z
    .enum(["brief", "detailed", "structured"])
    .default("detailed"),
  customPrompt: z.string().max(2000).optional(),
  userId: z.string().uuid().optional(),
})

const SYSTEM_PROMPTS: Record<string, string> = {
  brief:
    "You are an image description assistant. Describe the image in 1-2 concise sentences. Focus on the most important visual elements.",
  detailed:
    "You are an image description assistant. Provide a comprehensive description of the image including subjects, setting, colors, lighting, mood, composition, and notable details. Write in flowing prose, 3-6 sentences.",
  structured:
    "You are an image description assistant. Describe the image using these labeled sections:\n- Subject: Main subject(s)\n- Setting: Environment/background\n- Colors: Dominant colors and palette\n- Lighting: Light quality and direction\n- Mood: Overall atmosphere\n- Details: Notable secondary elements\n\nKeep each section to 1-2 sentences.",
}

export async function imageToTextRoutes(app: FastifyInstance) {
  app.post(
    "/v1/image-to-text/describe",
    {
      preHandler: creditGuard(() => "image-to-text"),
    },
    async (req, reply) => {
      const parsed = imageToTextBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "validation_error",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        })
      }

      const { imageUrl, detailLevel, customPrompt } = parsed.data
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

      const modelIdentifier = "image-to-text"

      // Create a job record for audit trail
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          user_id: userId,
          status: "pending",
          input_data: {
            type: "image-to-text",
            imageUrl,
            detailLevel,
            customPrompt,
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
        const anthropic = getAnthropicClient()
        const systemPrompt = customPrompt || SYSTEM_PROMPTS[detailLevel]

        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "url", url: imageUrl },
                },
                {
                  type: "text",
                  text: "Describe this image.",
                },
              ],
            },
          ],
        })

        const textBlock = response.content.find((b) => b.type === "text")
        const generatedText = textBlock?.text ?? ""

        // Finalize job and credits
        try {
          await supabase
            .from("jobs")
            .update({
              status: "completed",
              output_data: {
                generatedText,
                detailLevel,
                usage: response.usage,
              },
            })
            .eq("id", job.id)

          if (usageLogId) {
            await CreditsService.commitCredits(usageLogId)
          }
        } catch (postErr) {
          console.error("[image-to-text] Post-API error:", postErr)
        }

        return reply.send({ jobId: job.id, generatedText })
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
