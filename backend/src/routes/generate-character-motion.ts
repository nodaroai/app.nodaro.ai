import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { buildMotionPrompt, CHARACTER_MOTION_PROVIDERS } from "@nodaro/shared"

export const generateCharacterMotionBody = z.object({
  motionPrompt: z.string().min(1).max(2000),
  sourceImageUrl: safeUrlSchema,
  provider: z.enum(CHARACTER_MOTION_PROVIDERS).optional().default("kling"),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  gender: z.string().max(50).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  baseOutfit: z.string().max(1000).optional(),
  userId: z.string().uuid().optional(),
  // Character Studio auto-attach: target column is implicit ("motions"); just
  // pass the character DB id + display name.
  attachToCharacterId: z.string().uuid().optional(),
  attachName: z.string().min(1).max(200).optional(),
})

export async function generateCharacterMotionRoutes(app: FastifyInstance) {
  app.post("/v1/generate-character-motion", { preHandler: creditGuard((req) => extractProvider(req.body, "kling")) }, async (req, reply) => {
    const parsed = generateCharacterMotionBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    const modelIdentifier = parsed.data.provider ?? "kling"

    const prompt = buildMotionPrompt(parsed.data)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: { ...buildJobInputData(parsed.data, "generate-character-motion"), prompt },
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

    await videoQueue.add("generate-character-motion", {
      jobId: job.id,
      prompt,
      sourceImageUrl: parsed.data.sourceImageUrl,
      provider: parsed.data.provider ?? "kling",
      attachToCharacterId: parsed.data.attachToCharacterId,
      attachName: parsed.data.attachName,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
