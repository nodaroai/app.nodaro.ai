/**
 * Video Mask Route
 *
 * Text-prompted video segmentation: a clip + a subject description → a mask
 * video (white = the subject). Provider: SAM 3 on fal (providers/fal/sam3-video.ts);
 * the mask video is drawn locally from the model's per-frame RLE
 * (providers/video/video-mask.ts).
 *
 * Priced per clip length (`videoMaskCreditId` in `@nodaro/shared`), measured
 * by the preHandler with the rule the workflow run shares
 * (`measureVideoMaskLength`).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { VIDEO_MASK_LIMITS, VIDEO_MASK_PROVIDERS, DEFAULT_VIDEO_MASK_PROVIDER } from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { measureVideoMaskLength } from "../lib/video-mask-length.js"

export const videoMaskBody = z.object({
  videoUrl: safeUrlSchema,
  prompt: z.string().trim().min(1).max(VIDEO_MASK_LIMITS.PROMPT_MAX_LENGTH),
  threshold: z.number().min(VIDEO_MASK_LIMITS.THRESHOLD_MIN).max(VIDEO_MASK_LIMITS.THRESHOLD_MAX).optional().default(VIDEO_MASK_LIMITS.THRESHOLD_DEFAULT),
  provider: z.enum(VIDEO_MASK_PROVIDERS).optional().default(DEFAULT_VIDEO_MASK_PROVIDER),
})

/**
 * Measures the clip before the credit guard prices it, refuses one that can't
 * be read or is over the cap (400, before anything is reserved), and stashes
 * the price row on the body for the guard.
 */
async function measureVideoMaskPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  // The URL is validated BEFORE anything probes it: a bare path or a private
  // address never reaches ffprobe (whose answer would tell a file from none).
  const url = safeUrlSchema.safeParse(body.videoUrl)
  if (!url.success) return // the handler's Zod parse answers it with a validation_error
  const videoUrl = url.data
  const measured = await measureVideoMaskLength(videoUrl, body.provider)
  if (!measured.ok) {
    return void reply.code(400).send({ error: { code: measured.code, message: measured.message } })
  }
  body.__videoMaskBilledSec = measured.billedSec
  body.__videoMaskCreditId = measured.creditId
}

const stashedCreditId = (body: unknown): string => {
  const id = (body as Record<string, unknown> | undefined)?.__videoMaskCreditId
  return typeof id === "string" ? id : "video-mask"
}

export async function videoMaskRoutes(app: FastifyInstance) {
  app.post("/v1/video-mask", {
    preHandler: [measureVideoMaskPreHandler, creditGuard((req) => stashedCreditId(req.body))],
  }, async (req, reply) => {
    const raw = (req.body ?? {}) as Record<string, unknown>
    const { __videoMaskBilledSec: billedSec, __videoMaskCreditId: creditId, ...toParse } = raw
    const parsed = videoMaskBody.safeParse(toParse)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    const bucketKey = typeof creditId === "string" ? creditId : stashedCreditId(undefined)
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: { ...buildJobInputData(parsed.data, "video-mask"), billedSec, bucketKey },
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })
    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, bucketKey)
    if (reply.sent) return

    await videoQueue.add("video-mask", {
      jobId: job.id,
      ...parsed.data,
      usageLogId: reservation?.usageLogId,
    })
    return { jobId: job.id }
  })
}
