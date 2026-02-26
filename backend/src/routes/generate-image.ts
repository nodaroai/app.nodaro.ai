import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId } from "../lib/request-helpers.js"

const generateImageBody = z.object({
  prompt: z.string().min(1).max(2000),
  referenceImageUrls: z.array(safeUrlSchema).max(14).optional(),
  characterDescriptions: z.array(z.string().max(500)).max(10).optional(),
  provider: z.enum([
    // Replicate providers
    "nano-banana",
    "flux",
    // KIE.ai text-to-image providers
    "nano-banana-pro",
    "grok",
    "gpt-image",
    "imagen4",
    "imagen4-fast",
    "imagen4-ultra",
    "ideogram",
    "qwen",
    "seedream",
    "flux-flex",
    "z-image",
    // KIE.ai image-to-image providers
    "flux-i2i",
    "flux-pro-i2i",
    "grok-i2i",
    "gpt-image-i2i",
    "ideogram-edit",
    "ideogram-remix",
    "ideogram-reframe",
    "qwen-i2i",
    "qwen-edit",
    "seedream-edit",
  ]).optional(),
  aspectRatio: z.enum([
    "1:1", "16:9", "9:16", "4:3", "3:4",
    "3:2", "2:3", "5:4", "4:5", "21:9",
  ]).optional(),
  resolution: z.enum(["1K", "2K", "4K"]).optional(),
  quality: z.enum(["medium", "high", "basic"]).optional(),
  negativePrompt: z.string().max(5000).optional(),
  userId: z.string().uuid().optional(),
})

/**
 * Build composite model identifier for variable credit pricing.
 * Appends the setting that affects pricing (quality or resolution) to the provider name.
 * Only appends for models/settings that differ from the cheapest default.
 *
 * Examples: "gpt-image:high", "flux:2K", "nano-banana-pro:4K", "flux-flex:2K"
 */
function buildCreditModelIdentifier(provider: string, quality?: string, resolution?: string): string {
  // GPT Image: quality affects cost (medium=default/cheap, high=expensive)
  if ((provider === "gpt-image" || provider === "gpt-image-i2i") && quality === "high") {
    return `${provider}:high`
  }
  // Flux Pro: resolution affects cost (1K=default/cheap, 2K=expensive)
  if ((provider === "flux" || provider === "flux-pro-i2i") && resolution === "2K") {
    return `${provider}:2K`
  }
  // Flux Flex: resolution affects cost (1K=default/cheap, 2K=expensive)
  if ((provider === "flux-flex" || provider === "flux-i2i") && resolution === "2K") {
    return `${provider}:2K`
  }
  // Nano Banana Pro: resolution affects cost (1K/2K=default/cheap, 4K=expensive)
  if (provider === "nano-banana-pro" && resolution === "4K") {
    return `${provider}:4K`
  }
  return provider
}

export async function generateImageRoutes(app: FastifyInstance) {
  app.post("/v1/generate-image", { preHandler: creditGuard((req) => {
    const body = req.body as Record<string, unknown>
    const provider = (body?.provider as string) ?? "nano-banana"
    const quality = body?.quality as string | undefined
    const resolution = body?.resolution as string | undefined
    return buildCreditModelIdentifier(provider, quality, resolution)
  }) }, async (req, reply) => {
    const parsed = generateImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt: rawPrompt, referenceImageUrls, characterDescriptions, provider, aspectRatio, resolution, quality, negativePrompt, userId } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    // Determine model identifier for credit reservation (composite for variable pricing)
    const modelIdentifier = buildCreditModelIdentifier(provider ?? "nano-banana", quality, resolution)

    // Append character descriptions to prompt
    const descSuffix = (characterDescriptions ?? []).map((d) => d).join(" ")
    const prompt = descSuffix ? `${rawPrompt}\n${descSuffix}` : rawPrompt

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        user_id: userId,
        status: "pending",
        input_data: { prompt, referenceImageUrls, provider, type: "generate-image" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("generate-image", {
      jobId: job.id,
      prompt,
      referenceImageUrls,
      provider,
      aspectRatio,
      resolution,
      quality,
      negativePrompt,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
