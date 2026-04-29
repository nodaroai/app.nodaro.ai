import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"

const combineVideosBody = z.object({
  videoUrls: z.array(safeUrlSchema).min(2, "At least 2 video URLs required"),
  transition: z.enum(["cut", "fade", "dissolve", "dip-to-black", "dip-to-white"]).optional().default("cut"),
  transitionDuration: z.number().min(0).max(5).optional().default(0.5),
  audioMode: z.enum(["keep", "crossfade", "remove"]).optional().default("crossfade"),
  trimStartFrames: z.number().int().min(0).max(120).optional().default(0),
  trimEndFrames: z.number().int().min(0).max(120).optional().default(0),
  userId: z.string().uuid().optional(),
})

export async function combineVideosRoutes(app: FastifyInstance) {
  app.post("/v1/combine-videos", { preHandler: creditGuard(() => "combine-videos") }, async (req, reply) => {
    const parsed = combineVideosBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { videoUrls, transition, transitionDuration, audioMode, trimStartFrames, trimEndFrames } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = "combine-videos"

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "combine-videos"),
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

    await videoQueue.add("combine-videos", {
      jobId: job.id,
      videoUrls,
      transition,
      transitionDuration,
      audioMode,
      trimStartFrames,
      trimEndFrames,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
