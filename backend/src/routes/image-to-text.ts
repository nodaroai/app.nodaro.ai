import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { CreditsService } from "../ee/billing/credits.js"
import { llmComplete, type LlmContentBlock } from "../lib/llm-client.js"
import { LLM_MODEL_IDS, buildLlmCreditIdentifier, resolveLlmCreditId, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"
import { safeFetch } from "../lib/safe-fetch.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"

const imageToTextBody = z.object({
  imageUrl: safeUrlSchema,
  detailLevel: z
    .enum(["brief", "detailed", "structured"])
    .default("detailed"),
  customPrompt: z.string().max(2000).optional(),
  userPrompt: z.string().max(8000).optional(),
  userId: z.string().uuid().optional(),
  llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
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
      preHandler: creditGuard((req) => resolveLlmCreditId("image-to-text", req.body)),
    },
    async (req, reply) => {
      const parsed = imageToTextBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { imageUrl, detailLevel, customPrompt } = parsed.data
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

      const llmModel = parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS["image-to-text"]
      const modelIdentifier = buildLlmCreditIdentifier("image-to-text", llmModel)

      // Create a job record for audit trail
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "image-to-text"),
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
        const systemPrompt = customPrompt || SYSTEM_PROMPTS[detailLevel]

        // Pre-fetch image to base64 — external CDNs (Instagram, etc.) often
        // block requests from LLM provider IPs, causing empty responses.
        let imageBlock: LlmContentBlock = { type: "image", url: imageUrl }
        try {
          // safeFetch: imageUrl is user-supplied (safeUrlSchema-validated),
          // but that's syntactic only. The fetched bytes are base64-encoded
          // and sent to a vision LLM which describes them back to the
          // caller — a read-oracle through text description for any internal
          // endpoint whose response decodes as an image. Use safeFetch so
          // hostnames resolving to private IPs are rejected at connect time.
          const imgResp = await safeFetch(imageUrl, { timeoutMs: 30_000 })
          if (imgResp.ok) {
            const buf = Buffer.from(await imgResp.arrayBuffer())
            const mediaType = (imgResp.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim()
            imageBlock = { type: "image_base64", mediaType, data: buf.toString("base64") }
          }
        } catch {
          // Fall back to URL — might still work for public images
        }

        const response = await llmComplete({
          modelId: llmModel,
          system: systemPrompt,
          messages: [{
            role: "user",
            content: [
              imageBlock,
              { type: "text", text: "Describe this image." },
            ],
          }],
          maxTokens: 1024,
        })

        const generatedText = response.text

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
              provider_cost: response.providerCost ?? null,
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
