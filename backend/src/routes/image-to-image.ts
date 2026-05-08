import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { IMAGE_I2I_PROVIDERS } from "@nodaro/shared"
import { buildCreditModelIdentifier } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

const imageToImageBody = z.object({
  imageUrl: safeUrlSchema,
  prompt: z.string().min(1).max(2000),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(IMAGE_I2I_PROVIDERS).optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(13).optional(),
  resolution: z.enum(["1K", "2K", "4K"]).optional(),
  quality: z.enum(["medium", "high", "basic"]).optional(),
  strength: z.number().min(0).max(1).optional(),
  // "auto" is gpt-image-2 specific (KIE constrains it to 1K) — kept here
  // for symmetry with generate-image; per-provider gating lives in the
  // frontend config panels' fail-safe.
  aspectRatio: z.enum([
    "auto",
    "1:1", "16:9", "9:16", "4:3", "3:4",
    "3:2", "2:3", "5:4", "4:5", "21:9",
  ]).optional(),
  negativePrompt: z.string().max(5000).optional(),
  seed: z.number().int().min(0).optional(),
  renderingSpeed: z.enum(["TURBO", "BALANCED", "QUALITY"]).optional(),
  guidanceScale: z.number().min(0).max(30).optional(),
  maskUrl: safeUrlSchema.optional(),
})

export async function imageToImageRoutes(app: FastifyInstance) {
  app.post("/v1/image-to-image", { preHandler: creditGuard((req) => {
    const body = req.body as Record<string, unknown>
    const provider = (body?.provider as string) ?? "nano-banana"
    const quality = body?.quality as string | undefined
    const resolution = body?.resolution as string | undefined
    const renderingSpeed = body?.renderingSpeed as string | undefined
    return buildCreditModelIdentifier(provider, quality, resolution, renderingSpeed)
  }) }, async (req, reply) => {
    const parsed = imageToImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { imageUrl, prompt, provider, referenceImageUrls, resolution, quality, strength, aspectRatio, negativePrompt, seed, renderingSpeed, guidanceScale, maskUrl } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = buildCreditModelIdentifier(provider ?? "nano-banana", quality, resolution, renderingSpeed)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "image-to-image"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("image-to-image", {
      jobId: job.id,
      imageUrl,
      referenceImageUrls,
      prompt,
      provider,
      resolution,
      quality,
      strength,
      aspectRatio,
      negativePrompt,
      seed,
      renderingSpeed,
      guidanceScale,
      maskUrl,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
