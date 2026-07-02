import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { assembleNarratedVideoCredits } from "../providers/video/narrated-block-fit.js"

const body = z.object({
  blocks: z.array(z.object({
    videoUrl: safeUrlSchema,
    audioUrl: safeUrlSchema.optional(),
  })).min(1, "At least 1 block required").max(60, "At most 60 blocks"),
  voiceVolume: z.number().min(0).max(200).optional().default(100),
  clipAudioVolume: z.number().min(0).max(200).optional().default(40),
  maxSlowdown: z.number().min(1).max(2).optional().default(1.5),
  trimStartFrames: z.number().int().min(0).max(120).optional().default(0),
  trimEndFrames: z.number().int().min(0).max(120).optional().default(0),
  userId: z.string().uuid().optional(),
})

/** BASE credits (pre-markup): 3 + ceil(N/6). Read block count before Zod defaults. */
function estimateCredits(raw: unknown): number {
  const blocks = (raw as Record<string, unknown> | undefined)?.blocks
  const n = Array.isArray(blocks) ? blocks.length : 0
  return assembleNarratedVideoCredits(Math.max(1, Math.min(60, n)))
}

export async function assembleNarratedVideoRoutes(app: FastifyInstance) {
  app.post(
    "/v1/assemble-narrated-video",
    { preHandler: creditGuard(() => "assemble-narrated-video", { computeCredits: (b) => estimateCredits(b) }) },
    async (req, reply) => {
      const parsed = body.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      }
      const { blocks, voiceVolume, clipAudioVolume, maxSlowdown, trimStartFrames, trimEndFrames } = parsed.data
      const userId = req.userId
      if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })

      const mcpClient = extractMcpClient(req.body)
      const { data: job, error } = await supabase.from("jobs").insert({
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "assemble-narrated-video"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      }).select("id").single()
      if (error) return reply.status(500).send({ error: { code: "internal_error", message: error.message } })

      const reservation = await reserveCreditsForJob(req, reply, job.id, "assemble-narrated-video")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("assemble-narrated-video", {
        jobId: job.id, blocks, voiceVolume, clipAudioVolume, maxSlowdown, trimStartFrames, trimEndFrames, usageLogId,
      })
      return { jobId: job.id }
    },
  )
}
