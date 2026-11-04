import { z } from "zod"
import type { UnitRoute } from "../kit.js"
import { safeUrlSchema } from "../../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../../lib/request-helpers.js"
import { extractMcpClient } from "../../lib/extract-mcp-client.js"
import { buildJobInputData } from "../../lib/job-input-data.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { insertJob } from "../../lib/insert-job.js"
import { videoQueue } from "../../lib/queue.js"

// The video, and whether to save every shot's first and last frame too. The
// caller is req.userId (auth), never the body. The clip is measured by the job
// (worker.ts), never on the request: its length (up to 30 minutes) is read
// there, and a longer clip fails and is refunded.
function shotCutsBody() {
  return z.object({
    videoUrl: safeUrlSchema,
    frames: z.boolean().optional(),
    userId: z.string().uuid().optional(),
  })
}

// POST /v1/shot-cuts: queue a video-queue job (worker.ts). Flat-priced: the
// type's own row, with or without frames.
export const route: UnitRoute = async function shotCutsRoutes(app) {
  const body = shotCutsBody()
  app.post("/v1/shot-cuts", {
    preHandler: [
      // Validate FIRST, so a malformed request hears the 400 that names its
      // problem rather than a 402.
      async (req, reply) => {
        const parsed = body.safeParse(req.body)
        if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      },
      creditGuard(() => "shot-cuts"),
    ],
  }, async (req, reply) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const { userId: _bodyUserId, ...input } = parsed.data
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(input, "shot-cuts"),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })
    if (error) return sendInternalError(reply, req, error, "Failed to create job")
    const reservation = await reserveCreditsForJob(req, reply, job.id, "shot-cuts")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    // The BullMQ job name is the node type: the video worker dispatches it to ./worker.ts.
    await videoQueue.add("shot-cuts", { jobId: job.id, videoUrl: input.videoUrl, frames: input.frames === true, usageLogId })
    return { jobId: job.id }
  })
}
