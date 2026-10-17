import { z } from "zod"
import { safeUrlSchema } from "../../lib/url-validator.js"
import { insertJob } from "../../lib/insert-job.js"
import { videoQueue } from "../../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../../lib/request-helpers.js"
import { buildJobInputData } from "../../lib/job-input-data.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import type { UnitRoute } from "../kit.js"

const removeAudioBody = z.object({
  videoUrl: safeUrlSchema,
  userId: z.string().uuid().optional(),
})

// POST /v1/remove-audio: queue a video-queue job (worker.ts) that strips the audio track.
export const route: UnitRoute = async function removeAudioRoutes(app) {
  app.post("/v1/remove-audio", { preHandler: creditGuard(() => "remove-audio") }, async (req, reply) => {
    const parsed = removeAudioBody.safeParse(req.body)
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

    const modelIdentifier = "remove-audio"

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "remove-audio"),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("remove-audio", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
