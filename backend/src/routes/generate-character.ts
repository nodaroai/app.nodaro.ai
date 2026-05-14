import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { buildPortraitPrompt } from "../lib/character-prompts.js"
import { formatZodError } from "../lib/zod-error.js"

const generateCharacterBody = z
  .object({
    // Legacy fields preserved
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    userPrompt: z.string().max(8000).optional(),
    gender: z.string().max(50).optional(),
    style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
    baseOutfit: z.string().max(1000).optional(),
    sourceImageUrl: safeUrlSchema.optional(),
    provider: z.string().optional().default("nano-banana"),
    userId: z.string().uuid().optional(),
    // Character Studio auto-attach: when set, the worker writes the resulting
    // image URL to `characters.source_image_url` on this row after generation
    // succeeds. Lets the studio survive page closes mid-generation.
    attachToCharacterId: z.string().uuid().optional(),

    // Character Studio Identity Foundation (v2):
    seedPrompt: z.string().max(2000).optional(),
    referencePhotos: z
      .array(
        z.object({
          url: safeUrlSchema,
          kind: z.enum([
            "front",
            "sideLeft",
            "sideRight",
            "threeQuarterLeft",
            "threeQuarterRight",
            "fullBody",
            "other",
          ]),
        }),
      )
      .max(20)
      .optional(),
    count: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional().default(1),
  })
  .refine(
    (data) =>
      (data.seedPrompt !== undefined && data.seedPrompt.trim().length > 0) ||
      (data.referencePhotos !== undefined && data.referencePhotos.length > 0) ||
      (data.description !== undefined && data.description.trim().length > 0),
    { message: "Provide seedPrompt, referencePhotos, or description" },
  )

export async function generateCharacterRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-character",
    { preHandler: creditGuard((req) => extractProvider(req.body, "nano-banana")) },
    async (req, reply) => {
      const parsed = generateCharacterBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const data = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const modelIdentifier = data.provider

      // Build portrait prompt — v2 path prefers seedPrompt with studio scaffolding;
      // legacy path falls back to userPrompt → description → name.
      const promptText = data.seedPrompt
        ? buildPortraitPrompt({ seedPrompt: data.seedPrompt })
        : (data.userPrompt ?? data.description ?? data.name)

      const mcpClient = extractMcpClient(req.body)
      const inputData = buildJobInputData(parsed.data, "generate-character")
      const workflowId = extractWorkflowId(req.body)

      // Insert N jobs (always at least 1). `force_private: true` is unconditional
      // per the Character Studio privacy-by-default rule — generated character
      // assets must never leak to the public gallery, regardless of what the
      // user requests in the body.
      const jobIds: string[] = []
      for (let i = 0; i < data.count; i++) {
        const { data: job, error } = await supabase
          .from("jobs")
          .insert({
            workflow_id: workflowId,
            force_private: true,
            user_id: userId,
            status: "pending",
            input_data: { ...inputData, prompt: promptText },
            ...(mcpClient ? { mcp_client: mcpClient } : {}),
          })
          .select("id")
          .single()

        if (error || !job) {
          return reply.status(500).send({
            error: { code: "internal_error", message: error?.message ?? "Failed to create job" },
          })
        }
        jobIds.push(job.id)
      }

      // Reserve credits per job — each portrait pays separately.
      for (const jobId of jobIds) {
        const reservation = await reserveCreditsForJob(req, reply, jobId, modelIdentifier)
        if (reply.sent) return
        const usageLogId = reservation?.usageLogId

        await videoQueue.add("generate-character", {
          jobId,
          prompt: promptText,
          sourceImageUrl: data.sourceImageUrl,
          provider: data.provider,
          attachToCharacterId: data.attachToCharacterId,
          usageLogId,
        })
      }

      return { jobId: jobIds[0], jobIds }
    },
  )
}
