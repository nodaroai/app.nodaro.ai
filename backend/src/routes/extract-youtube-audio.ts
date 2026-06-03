import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema, isAllowedSocialVideoUrl, YOUTUBE_HOSTS } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"

const extractYouTubeAudioBody = z.object({
  youtubeUrl: safeUrlSchema.refine(
    (url) => isAllowedSocialVideoUrl(url, YOUTUBE_HOSTS),
    { message: "Must be a valid YouTube URL" },
  ),
  userId: z.string().uuid().optional(),
})

export async function extractYouTubeAudioRoutes(app: FastifyInstance) {
  app.post("/v1/extract-youtube-audio", async (req, reply) => {
    const parsed = extractYouTubeAudioBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { youtubeUrl } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "extract-youtube-audio"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("extract-youtube-audio", {
      jobId: job.id,
      youtubeUrl,
    })

    return { jobId: job.id }
  })
}
