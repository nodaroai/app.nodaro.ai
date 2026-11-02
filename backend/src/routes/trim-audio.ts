import type { FastifyInstance } from "fastify"
import { sendInternalError } from "../lib/http-errors.js"
import { insertJob } from "../lib/insert-job.js"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { isAllowedSocialVideoUrl } from "../lib/url-validator.js"
import { isImportRefusal, requireImportAllowed } from "../lib/import-gate.js"
import { importJobFields, importViaOf } from "../lib/import-via.js"

const trimAudioBody = z.object({
  videoUrl: safeUrlSchema,
  audioFormat: z.enum(["mp3", "wav", "aac"]).optional().default("mp3"),
  startTime: z.number().min(0).optional(),
  endTime: z.number().min(0).optional(),
  userId: z.string().uuid().optional(),
  // The content rights confirmation a SOCIAL link is imported under
  // (`POST /v1/content-rights/confirm`): checked here, spent by the worker
  // right before the fetch. Optional until `content_rights_required` is on;
  // a direct file needs none.
  confirmationId: z.string().uuid().optional(),
})

export async function trimAudioRoutes(app: FastifyInstance) {
  app.post("/v1/trim-audio", { preHandler: creditGuard(() => "trim-audio") }, async (req, reply) => {
    const parsed = trimAudioBody.safeParse(req.body)
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

    // A social link is an import of a link: the site's policy and the rights
    // check (reads) answer here, before any job row exists; the worker spends
    // the confirmation when it fetches.
    const importVia = importViaOf(req)
    if (isAllowedSocialVideoUrl(restData.videoUrl)) {
      try {
        await requireImportAllowed(restData.videoUrl, { userId, confirmationId: restData.confirmationId, lane: "route", requestId: req.id, via: importVia })
      } catch (e) {
        if (isImportRefusal(e)) return reply.status(403).send({ error: { code: e.code, message: e.message } })
        throw e
      }
    }

    const modelIdentifier = "trim-audio"
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "trim-audio"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to trim audio")
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("trim-audio", { jobId: job.id, ...restData, usageLogId, ...importJobFields(req) })
    return { jobId: job.id }
  })
}
