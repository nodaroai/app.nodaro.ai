/**
 * Cropping one frame of a trend's original into a picture: "Take from the
 * original" in the trend builder, for a slot's default picture (Full depth).
 * Registered by `adminTrendsRoutes` (admin-trends.ts), so it shares its
 * `requireAdmin` door and its edition gate.
 *
 *   POST /v1/admin/trends/:id/frame-crop   { timeSec, box: { x, y, w, h } } → { data: { url, width?, height? } }
 *
 * The frame is taken from the SAVED draft's original clip (`source.videoUrl`,
 * never its display copy), at `timeSec` (inside the clip), and `box` is in
 * pixels of that frame as shown (the display copy's size: rotation applied).
 * The crop is stored in the trend's storage (lib/trends/frame-crop.ts) and its
 * address returned; the draft is not written (the builder puts the address in
 * the slot's `defaultImages` and saves). An internal tool: no credits, and a
 * rate limit per admin, since each call downloads the original and runs
 * ffmpeg. Each crop writes an `admin_actions` row.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { z } from "zod"
import { requireAdmin } from "../middleware/require-admin.js"
import { FrameCropError, frameCropBody, frameCropProblem, storeFrameCrop } from "../lib/trends/frame-crop.js"
import { TrendMediaError, isTransientMediaFailure } from "../lib/trends/media.js"
import { unavailableOrInternal } from "../lib/trends/run-helpers.js"
import type { TrendRow, TrendVersionData } from "../lib/trends/types.js"
import { audit } from "./admin-trends-lifecycle.js"

/** Each crop downloads the original and runs ffmpeg twice: a few a minute is all a builder needs. */
const FRAME_CROP_LIMIT = { rateLimit: { max: 20, timeWindow: "1 minute" } }

export interface TrendFrameCropDeps {
  /** The trend `:id`, its draft and the draft's revision, or null after replying. */
  loadDraft: (req: FastifyRequest, reply: FastifyReply) => Promise<{ trend: TrendRow; draft: TrendVersionData; revision: string } | null>
  badRequest: (reply: FastifyReply, error: z.ZodError) => unknown
}

function err(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } })
}

export function registerTrendFrameCropRoutes(app: FastifyInstance, deps: TrendFrameCropDeps): void {
  app.post("/v1/admin/trends/:id/frame-crop", { preHandler: requireAdmin, config: FRAME_CROP_LIMIT }, async (req, reply) => {
    const body = frameCropBody.safeParse(req.body)
    if (!body.success) return deps.badRequest(reply, body.error)
    try {
      const loaded = await deps.loadDraft(req, reply)
      if (!loaded) return reply
      const { trend, draft } = loaded
      const problem = frameCropProblem(draft.source, body.data)
      if (problem) return err(reply, problem.status, problem.code, problem.message)
      const stored = await storeFrameCrop(trend.id, draft.source!.videoUrl, body.data)
      await audit(req, "crop_trend_frame", "trend", trend.id, {
        slug: trend.slug,
        fromUrl: draft.source!.videoUrl,
        timeSec: body.data.timeSec,
        box: body.data.box,
        url: stored.url,
      })
      return { data: stored }
    } catch (e) {
      if (e instanceof FrameCropError) return err(reply, e.problem.status, e.problem.code, e.problem.message)
      if (e instanceof TrendMediaError) {
        req.log.warn({ err: e.cause ?? e }, "admin-trends: a frame of the original could not be cropped")
        return err(reply, 400, e.code, e.message)
      }
      if (isTransientMediaFailure(e)) {
        req.log.warn({ err: e }, "admin-trends: the frame crop's media step was stopped, not refused")
        return err(reply, 503, "media_busy", "The frame could not be cropped right now. Try again in a moment.")
      }
      return unavailableOrInternal(reply, req, e, "Failed to crop the frame")
    }
  })
}
