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

// Zero credits — pure local FFmpeg conversion (no provider call). The guard's
// credit check passes trivially while the storage-limit check, the admin
// kill-switch (is_enabled), and anti-double-click dedup all still apply.
const gifToVideoBody = z.object({
  gifUrl: safeUrlSchema,
  // Extend short GIFs by looping up to the target window. A GIF already below
  // the ~2s reference floor is looped regardless (the model rejects sub-floor
  // clips); this toggle governs whether an already-valid GIF is stretched into
  // the 3-8s sweet spot.
  loopToMinimum: z.boolean().default(true),
  targetDuration: z.number().min(2).max(8).default(3),
  // true → minterpolate (smooth motion). false → preserve the GIF's original
  // stepped timing (plain frame duplication).
  interpolate: z.boolean().default(true),
  alphaBackground: z.enum(["white", "black"]).default("white"),
  userId: z.string().uuid().optional(),
})

export async function gifToVideoRoutes(app: FastifyInstance) {
  app.post("/v1/gif-to-video", { preHandler: creditGuard(() => "gif-to-video") }, async (req, reply) => {
    const parsed = gifToVideoBody.safeParse(req.body)
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

    const modelIdentifier = "gif-to-video"
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(parsed.data, "gif-to-video"),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits (0 for this node — creates the usage-log row only).
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("gif-to-video", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
