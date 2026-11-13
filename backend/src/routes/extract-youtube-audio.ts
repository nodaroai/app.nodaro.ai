import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema, isAllowedSocialVideoUrl, YOUTUBE_HOSTS } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isImportRefusal, requireImportAllowed } from "../lib/import-gate.js"
import { importJobFields, importViaOf } from "../lib/import-via.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"

const extractYouTubeAudioBody = z.object({
  youtubeUrl: safeUrlSchema.refine(
    (url) => isAllowedSocialVideoUrl(url, YOUTUBE_HOSTS),
    { message: "Must be a valid YouTube URL" },
  ),
  userId: z.string().uuid().optional(),
  // The content rights confirmation this import is made under
  // (`POST /v1/content-rights/confirm`): checked here, spent by the worker
  // right before the fetch. Optional until `content_rights_required` is on.
  confirmationId: z.string().uuid().optional(),
})

export async function extractYouTubeAudioRoutes(app: FastifyInstance) {
  app.post("/v1/extract-youtube-audio", async (req, reply) => {
    const parsed = extractYouTubeAudioBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { youtubeUrl, confirmationId } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // The site's policy and the rights check (reads) answer here, before any
    // job row exists; the worker spends the confirmation when it fetches.
    const importVia = importViaOf(req)
    try {
      await requireImportAllowed(youtubeUrl, { userId, confirmationId, lane: "route", requestId: req.id, via: importVia })
    } catch (e) {
      if (isImportRefusal(e)) return reply.status(403).send({ error: { code: e.code, message: e.message } })
      throw e
    }

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "extract-youtube-audio"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("extract-youtube-audio", {
      jobId: job.id,
      youtubeUrl,
      ...(confirmationId ? { confirmationId } : {}),
      // The way in (and the connected app), for the worker's spend (`importRightsOf`): a key's or an agent's job stands on a standing authorization.
      ...importJobFields(req),
    }))
    if (reply.sent) return

    return { jobId: job.id }
  })
}
