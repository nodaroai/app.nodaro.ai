/**
 * Mask Composite Route
 *
 * A foreground video over a background video through a mask video (white =
 * foreground). Local ffmpeg (providers/video/mask-composite.ts) — no provider,
 * runs keyless in every edition. Priced per started 5 seconds of the result
 * (the foreground's length, measured by the preHandler with the rule the
 * workflow run shares — lib/mask-composite-length.ts).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  MASK_COMPOSITE_AUDIO_SOURCES,
  MASK_COMPOSITE_BACKGROUND_FITS,
  MASK_COMPOSITE_BOUNDS,
  MASK_COMPOSITE_DEFAULTS,
} from "@nodaro/shared/media"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { maskCompositeBaseCredits, measureMaskCompositeLength } from "../lib/mask-composite-length.js"

const b = MASK_COMPOSITE_BOUNDS
const d = MASK_COMPOSITE_DEFAULTS

export const maskCompositeBody = z.object({
  foregroundUrl: safeUrlSchema,
  backgroundUrl: safeUrlSchema,
  maskUrl: safeUrlSchema,
  invertMask: z.boolean().optional().default(d.invertMask),
  feather: z.number().int().min(b.FEATHER_MIN).max(b.FEATHER_MAX).optional().default(d.feather),
  grow: z.number().int().min(b.GROW_MIN).max(b.GROW_MAX).optional().default(d.grow),
  // Inside the mask: opacity × foreground + (1 − opacity) × background.
  opacity: z.number().min(b.OPACITY_MIN).max(b.OPACITY_MAX).optional().default(d.opacity),
  backgroundFit: z.enum(MASK_COMPOSITE_BACKGROUND_FITS).optional().default(d.backgroundFit),
  audioSource: z.enum(MASK_COMPOSITE_AUDIO_SOURCES).optional().default(d.audioSource),
})

/**
 * Measures the foreground before the credit guard prices it (the URL is
 * validated first, so nothing unsafe is probed), refuses one that can't be read
 * or is over the cap (400, before anything is reserved), and stashes the unit
 * count on the body for the guard.
 */
async function measureForegroundPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const url = safeUrlSchema.safeParse(body.foregroundUrl)
  if (!url.success) return // the handler's Zod parse answers it with a validation_error
  const measured = await measureMaskCompositeLength(url.data)
  if (!measured.ok) {
    return void reply.code(400).send({ error: { code: measured.code, message: measured.message } })
  }
  body.__maskCompositeUnits = measured.units
}

const stashedUnits = (body: unknown): number => {
  const u = (body as Record<string, unknown> | undefined)?.__maskCompositeUnits
  return typeof u === "number" && u >= 1 ? u : 1
}

export async function maskCompositeRoutes(app: FastifyInstance) {
  app.post("/v1/mask-composite", {
    preHandler: [
      measureForegroundPreHandler,
      // BASE credits = the one-unit row × the measured units; creditGuard applies the markup.
      creditGuard(() => "mask-composite", { computeCredits: async (body) => maskCompositeBaseCredits(stashedUnits(body)) }),
    ],
  }, async (req, reply) => {
    const { __maskCompositeUnits: billedUnits, ...toParse } = (req.body ?? {}) as Record<string, unknown>
    const parsed = maskCompositeBody.safeParse(toParse)
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
      input_data: { ...buildJobInputData(parsed.data, "mask-composite"), billedUnits },
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
