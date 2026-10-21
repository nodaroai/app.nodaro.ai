/**
 * Mask Composite Route
 *
 * A foreground video over a background video through a mask video (white =
 * foreground). Local ffmpeg (providers/video/mask-composite.ts) — no provider,
 * runs keyless in every edition. Priced per started 5 seconds of the result
 * (the leading video's length — the foreground, or the background when `fill`
 * is pixelate / blur — measured by the preHandler with the rule the workflow
 * run shares — lib/mask-composite-length.ts).
 *
 * `fill`: `video` (default) needs `foregroundUrl`; `pixelate` / `blur` fill the
 * masked area from the background itself, so `foregroundUrl` is optional and,
 * when sent, ignored (dropped before the job is written or queued). With no
 * foreground, the result always carries the background's sound (`audioSource` is ignored)
 * (`maskCompositeEffectiveAudioSource`, applied by the worker) — not a 400, so
 * the defaults keep working.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  MASK_COMPOSITE_AUDIO_SOURCES,
  MASK_COMPOSITE_BACKGROUND_FITS,
  MASK_COMPOSITE_BOUNDS,
  MASK_COMPOSITE_DEFAULTS,
  MASK_COMPOSITE_FILLS,
  maskCompositeUsesForeground,
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
import { maskCompositeBaseCredits, maskCompositeLeadOf, measureMaskCompositeLength } from "../lib/mask-composite-length.js"

const b = MASK_COMPOSITE_BOUNDS
const d = MASK_COMPOSITE_DEFAULTS

export const maskCompositeBody = z.object({
  // Required by the video fill (checked after the parse, in the handler); unused by pixelate / blur.
  foregroundUrl: safeUrlSchema.optional(),
  backgroundUrl: safeUrlSchema,
  maskUrl: safeUrlSchema,
  invertMask: z.boolean().optional().default(d.invertMask),
  feather: z.number().int().min(b.FEATHER_MIN).max(b.FEATHER_MAX).optional().default(d.feather),
  grow: z.number().int().min(b.GROW_MIN).max(b.GROW_MAX).optional().default(d.grow),
  // Inside the mask: opacity × foreground + (1 − opacity) × background.
  opacity: z.number().min(b.OPACITY_MIN).max(b.OPACITY_MAX).optional().default(d.opacity),
  fill: z.enum(MASK_COMPOSITE_FILLS).optional().default(d.fill),
  // Both relative to the frame's width (MASK_COMPOSITE_BOUNDS): the same look at any resolution.
  pixelSizePct: z.number().min(b.PIXEL_SIZE_PCT_MIN).max(b.PIXEL_SIZE_PCT_MAX).optional().default(d.pixelSizePct),
  blurStrengthPct: z.number().min(b.BLUR_STRENGTH_PCT_MIN).max(b.BLUR_STRENGTH_PCT_MAX).optional().default(d.blurStrengthPct),
  backgroundFit: z.enum(MASK_COMPOSITE_BACKGROUND_FITS).optional().default(d.backgroundFit),
  audioSource: z.enum(MASK_COMPOSITE_AUDIO_SOURCES).optional().default(d.audioSource),
})

/**
 * Measures the leading video before the credit guard prices it — the
 * foreground, or the background when `fill` is pixelate / blur (the URL is
 * validated first, so nothing unsafe is probed) — refuses one that can't be
 * read or is over the cap (400, before anything is reserved), and stashes the
 * unit count on the body for the guard.
 */
async function measureLeadPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const { lead, url: raw } = maskCompositeLeadOf(body)
  const url = safeUrlSchema.safeParse(raw)
  if (!url.success) return // the handler's Zod parse (or its foreground check) answers it with a validation_error
  const measured = await measureMaskCompositeLength(url.data, lead)
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
      measureLeadPreHandler,
      // BASE credits = the one-unit row × the measured units; creditGuard applies the markup.
      creditGuard(() => "mask-composite", { computeCredits: async (body) => maskCompositeBaseCredits(stashedUnits(body)) }),
    ],
  }, async (req, reply) => {
    const { __maskCompositeUnits: billedUnits, ...raw } = (req.body ?? {}) as Record<string, unknown>
    // Pixelate / blur never read a foreground: one sent is ignored outright —
    // dropped before the parse, so even a malformed value is no reason to refuse.
    const { foregroundUrl: _unused, ...withoutForeground } = raw
    const toParse = maskCompositeLeadOf(raw).lead === "background" ? withoutForeground : raw
    const parsed = maskCompositeBody.safeParse(toParse)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    // The video fill composites a foreground: it stays required exactly as before.
    const usesForeground = maskCompositeUsesForeground(parsed.data.fill)
    if (usesForeground && !parsed.data.foregroundUrl) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: "foregroundUrl: Required when fill is \"video\"",
          issues: [{ path: "foregroundUrl", message: "Required when fill is \"video\"" }],
        },
      })
    }
    const body = parsed.data
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
      input_data: { ...buildJobInputData(body, "mask-composite"), billedUnits },
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })
    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }
    const reservation = await reserveCreditsForJob(req, reply, job.id, "mask-composite")
    if (reply.sent) return
    await videoQueue.add("mask-composite", { jobId: job.id, ...body, usageLogId: reservation?.usageLogId })
    return { jobId: job.id }
  })
}
