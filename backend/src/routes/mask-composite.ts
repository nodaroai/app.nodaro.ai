/**
 * Mask Composite Route
 *
 * A foreground video over a background video through a mask video (white =
 * foreground). Local ffmpeg (providers/video/mask-composite.ts) — no provider,
 * runs keyless in every edition. Flat price, like Merge Video + Audio.
 */

import type { FastifyInstance } from "fastify"
import { z } from "zod"
import {
  MASK_COMPOSITE_AUDIO_SOURCES,
  MASK_COMPOSITE_BACKGROUND_FITS,
  MASK_COMPOSITE_BOUNDS,
  MASK_COMPOSITE_DEFAULTS,
} from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

const b = MASK_COMPOSITE_BOUNDS
const d = MASK_COMPOSITE_DEFAULTS

export const maskCompositeBody = z.object({
  foregroundUrl: safeUrlSchema,
  backgroundUrl: safeUrlSchema,
  maskUrl: safeUrlSchema,
  invertMask: z.boolean().optional().default(d.invertMask),
  feather: z.number().int().min(b.FEATHER_MIN).max(b.FEATHER_MAX).optional().default(d.feather),
  grow: z.number().int().min(b.GROW_MIN).max(b.GROW_MAX).optional().default(d.grow),
  backgroundFit: z.enum(MASK_COMPOSITE_BACKGROUND_FITS).optional().default(d.backgroundFit),
  audioSource: z.enum(MASK_COMPOSITE_AUDIO_SOURCES).optional().default(d.audioSource),
})

export async function maskCompositeRoutes(app: FastifyInstance) {
  app.post("/v1/mask-composite", { preHandler: creditGuard(() => "mask-composite") }, async (req, reply) => {
    const parsed = maskCompositeBody.safeParse(req.body)
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
    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: buildJobInputData(parsed.data, "mask-composite"),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })
    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }
    const reservation = await reserveCreditsForJob(req, reply, job.id, "mask-composite")
    if (reply.sent) return
    await videoQueue.add("mask-composite", { jobId: job.id, ...parsed.data, usageLogId: reservation?.usageLogId })
    return { jobId: job.id }
  })
}
