import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { IMAGE_GEN_PROVIDERS, T2I_TO_I2I_VARIANT } from "@nodaro/shared"
import { buildCreditModelIdentifier } from "@nodaro/shared"

/**
 * Decide whether the prompt actually addresses any reference images.
 * `buildImagePrompt` emits the "Use these references for the output image:"
 * header only when at least one `{image:N:label}` mention is present, so
 * checking for that string is a reliable signal that the user wants the
 * model to consume the attached refs (versus just having them attached).
 */
function promptAddressesReferences(prompt: string): boolean {
  return prompt.includes("Use these references for the output image:")
}

/**
 * If the user picked a T2I provider that has an i2i sibling AND the prompt
 * mentions reference images, transparently route to the i2i variant — the
 * T2I endpoint silently ignores ref URLs, while the i2i endpoint actually
 * uses them.
 */
function resolveEffectiveProvider(
  provider: string | undefined,
  prompt: string,
  referenceImageUrls: string[] | undefined,
): string | undefined {
  if (!provider) return provider
  if (!referenceImageUrls?.length) return provider
  if (!promptAddressesReferences(prompt)) return provider
  return T2I_TO_I2I_VARIANT[provider] ?? provider
}

const generateImageBody = z.object({
  prompt: z.string().min(1).max(2000),
  userPrompt: z.string().max(8000).optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(14).optional(),
  characterDescriptions: z.array(z.string().max(500)).max(10).optional(),
  provider: z.enum(IMAGE_GEN_PROVIDERS).optional(),
  // "auto" is gpt-image-2 specific (KIE constrains it to 1K) — keeping the
  // enum permissive here and letting the per-provider config / fail-safe in
  // model-options.ts gate it on the correct providers.
  aspectRatio: z.enum([
    "auto",
    "1:1", "16:9", "9:16", "4:3", "3:4",
    "3:2", "2:3", "5:4", "4:5", "21:9",
  ]).optional(),
  resolution: z.enum(["1K", "2K", "4K"]).optional(),
  quality: z.enum(["medium", "high", "basic"]).optional(),
  negativePrompt: z.string().max(5000).optional(),
  seed: z.number().int().min(0).optional(),
  renderingSpeed: z.enum(["TURBO", "BALANCED", "QUALITY"]).optional(),
  styleType: z.string().optional(),
  expandPrompt: z.boolean().optional(),
  userId: z.string().uuid().optional(),
})

export async function generateImageRoutes(app: FastifyInstance) {
  app.post("/v1/generate-image", { preHandler: creditGuard((req) => {
    const body = req.body as Record<string, unknown>
    const rawProvider = (body?.provider as string) ?? "nano-banana"
    const prompt = (body?.prompt as string) ?? ""
    const refs = body?.referenceImageUrls as string[] | undefined
    // Mirror the auto-swap inside the route handler so credits are reserved
    // for the variant we'll actually invoke.
    const provider = resolveEffectiveProvider(rawProvider, prompt, refs) ?? rawProvider
    const quality = body?.quality as string | undefined
    const resolution = body?.resolution as string | undefined
    const renderingSpeed = body?.renderingSpeed as string | undefined
    return buildCreditModelIdentifier(provider, quality, resolution, renderingSpeed)
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

    const { prompt: rawPrompt, referenceImageUrls, characterDescriptions, provider, aspectRatio, resolution, quality, negativePrompt, seed, renderingSpeed, styleType, expandPrompt } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Append character descriptions to prompt
    const descSuffix = (characterDescriptions ?? []).map((d) => d).join(" ")
    const prompt = descSuffix ? `${rawPrompt}\n${descSuffix}` : rawPrompt

    // Auto-route T2I providers to their i2i sibling when the user actually
    // addresses reference images in the prompt. Without this, T2I models
    // silently ignore attached refs because their KIE endpoints don't accept
    // input image params.
    const effectiveProvider = resolveEffectiveProvider(provider, prompt, referenceImageUrls)

    // Determine model identifier for credit reservation (composite for variable pricing)
    const modelIdentifier = buildCreditModelIdentifier(effectiveProvider ?? "nano-banana", quality, resolution, renderingSpeed)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "generate-image"), prompt },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
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
      provider: effectiveProvider,
      aspectRatio,
      resolution,
      quality,
      negativePrompt,
      seed,
      renderingSpeed,
      styleType,
      expandPrompt,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
