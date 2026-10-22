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
import { VIDEO_MASK_LIMITS, VIDEO_MASK_PROVIDERS, DEFAULT_VIDEO_MASK_PROVIDER } from "@nodaro/shared/media"
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

const zoneMargin = z.number().min(VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MIN).max(VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MAX).optional().default(0)

export const videoMaskBody = z.object({
  videoUrl: safeUrlSchema,
  prompt: z.string().trim().min(1).max(VIDEO_MASK_LIMITS.PROMPT_MAX_LENGTH),
  threshold: z.number().min(VIDEO_MASK_LIMITS.THRESHOLD_MIN).max(VIDEO_MASK_LIMITS.THRESHOLD_MAX).optional().default(VIDEO_MASK_LIMITS.THRESHOLD_DEFAULT),
  provider: z.enum(VIDEO_MASK_PROVIDERS).optional().default(DEFAULT_VIDEO_MASK_PROVIDER),
  // Hold the last mask where the subject is lost (VIDEO_MASK_LIMITS.HOLD_EMPTY_BELOW_FRACTION); off = the model's mask.
  holdLastMask: z.boolean().optional().default(false),
  // Drop regions shorter than this % of the frame height (0 = off); applied before holdLastMask.
  minSubjectHeightPct: z.number().min(VIDEO_MASK_LIMITS.MIN_SUBJECT_HEIGHT_PCT_MIN).max(VIDEO_MASK_LIMITS.MIN_SUBJECT_HEIGHT_PCT_MAX).optional().default(0),
  // Drop regions taller than this % of the frame height (0 = off); with both set, keep min ≤ h ≤ max.
  maxSubjectHeightPct: z.number().min(VIDEO_MASK_LIMITS.MAX_SUBJECT_HEIGHT_PCT_MIN).max(VIDEO_MASK_LIMITS.MAX_SUBJECT_HEIGHT_PCT_MAX).optional().default(0),
  // Keep only regions whose bounding-box centre is inside these margins (% of the frame, 0–49 each; a margin
  // left out is 0). null / omitted / all 0 = off. Applied after the size cut, before holdLastMask.
  zone: z.object({ leftPct: zoneMargin, rightPct: zoneMargin, topPct: zoneMargin, bottomPct: zoneMargin }).nullable().optional().default(null),
  // Segment each shot on its own: the clip's scene cuts become chunk boundaries (the model starts afresh after
  // every cut and finds the subjects of the new shot), and holdLastMask never carries a mask across a cut.
  perShot: z.boolean().optional().default(false),
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
    // Both size cuts set: the band must not be empty (checked after the parse, so the schema stays an object).
    const { minSubjectHeightPct: lo, maxSubjectHeightPct: hi } = parsed.data
    if (lo > 0 && hi > 0 && lo > hi) {
      const message = `minSubjectHeightPct (${lo}) is above maxSubjectHeightPct (${hi}) — no subject could be kept`
      return reply.status(400).send({
        error: { code: "validation_error", message, issues: [{ path: "minSubjectHeightPct", message }] },
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
