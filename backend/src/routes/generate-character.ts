import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { buildCharacterPrompt } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

const generateCharacterBody = z.object({
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
})

export async function generateCharacterRoutes(app: FastifyInstance) {
  app.post("/v1/generate-character", { preHandler: creditGuard((req) => extractProvider(req.body, "nano-banana")) }, async (req, reply) => {
    const parsed = generateCharacterBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { name, description, gender, style, baseOutfit, sourceImageUrl } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = parsed.data.provider

    const prompt = buildCharacterPrompt({ name, description, gender, style, baseOutfit })

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "generate-character"), prompt },
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

    await videoQueue.add("generate-character", {
      jobId: job.id,
      prompt,
      sourceImageUrl,
      provider: parsed.data.provider,
      attachToCharacterId: parsed.data.attachToCharacterId,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
