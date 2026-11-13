import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"

// Keyless, ffmpeg-only: one `silencedetect` pass over the source's audio proxy.
// `audioUrl` accepts an audio OR a video source — the worker reads the shared
// 16 kHz audio proxy either way. Defaults mirror the node's config panel and
// the provider's SILENCE_DETECT_DEFAULTS.
const silenceDetectBody = z.object({
  audioUrl: safeUrlSchema,
  // dBFS threshold; always at or below 0. -35 is a good podcast default.
  thresholdDb: z.number().min(-90).max(0).optional().default(-35),
  // Minimum silence length to report (ms).
  minSilenceMs: z.number().int().min(1).max(600_000).optional().default(700),
  // Padding kept around speech (ms) — shrinks each reported range inward.
  padMs: z.number().int().min(0).max(60_000).optional().default(120),
  userId: z.string().uuid().optional(),
})

export async function silenceDetectRoutes(app: FastifyInstance) {
  app.post("/v1/silence-detect", { preHandler: creditGuard(() => "silence-detect") }, async (req, reply) => {
    const parsed = silenceDetectBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { userId: _bodyUserId, ...restData } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = "silence-detect"
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(parsed.data, "silence-detect"),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("silence-detect", { jobId: job.id, ...restData, usageLogId }))
    if (reply.sent) return
    return { jobId: job.id }
  })
}
