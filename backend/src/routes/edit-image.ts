import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { IMAGE_EDIT_PROVIDERS } from "@nodaro/shared"
import { buildCreditModelIdentifier } from "@nodaro/shared"

const editImageBody = z.object({
  imageUrl: safeUrlSchema,
  prompt: z.string().max(2000).optional(),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(IMAGE_EDIT_PROVIDERS).optional(),
  upscaleFactor: z.enum(["1", "2", "4"]).optional(),
  targetResolution: z.enum(["2K", "4K", "8K"]).optional(),
  aspectRatio: z.string().max(20).optional(),
  negativePrompt: z.string().max(5000).optional(),
  style: z.string().max(500).optional(),
  seed: z.number().int().min(0).optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(13).optional(),
})

export async function editImageRoutes(app: FastifyInstance) {
  app.post("/v1/edit-image", { preHandler: creditGuard((req) => {
    const body = req.body as Record<string, unknown>
    const provider = (body?.provider as string) ?? "recraft-upscale"
    const targetResolution = body?.targetResolution as string | undefined
    return buildCreditModelIdentifier(provider, undefined, undefined, undefined, targetResolution)
  }) }, async (req, reply) => {
    const parsed = editImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { imageUrl, prompt, provider, upscaleFactor, targetResolution, aspectRatio, negativePrompt, style, seed, referenceImageUrls } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Validate that nano-banana-edit has a prompt
    if (provider === "nano-banana-edit" && !prompt) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: "Prompt is required for nano-banana-edit provider",
        },
      })
    }

    const baseProvider = provider ?? "recraft-upscale"
    const modelIdentifier = buildCreditModelIdentifier(baseProvider, undefined, undefined, undefined, targetResolution)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "edit-image"),
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

    await videoQueue.add("edit-image", {
      jobId: job.id,
      imageUrl,
      prompt,
      provider,
      upscaleFactor,
      targetResolution,
      aspectRatio,
      negativePrompt,
      style,
      seed,
      referenceImageUrls,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
