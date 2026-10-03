/**
 * POST /v1/video-overlay — timed image layers over a video, rendered locally
 * by the video worker (`ffmpegHandlers["video-overlay"]`). The handler shape of
 * fade-video.ts. Everything a schema cannot express is the shared validator's
 * (`validateVideoOverlayRequest`), and the shared normaliser
 * (`expandVideoOverlayPresets`) owns every default — so validation runs before
 * the job insert and the credit reservation: a bad body costs nothing.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import {
  OVERLAY_ANCHORS,
  VIDEO_OVERLAY_BOUNDS,
  VIDEO_OVERLAY_CORNERS,
  VIDEO_OVERLAY_FITS,
  VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH,
  VIDEO_OVERLAY_MAX_LAYERS,
  VIDEO_OVERLAY_MAX_TIME_SEC,
  VIDEO_OVERLAY_OUTPUT_ASPECTS,
  VIDEO_OVERLAY_PRESET_IDS,
  expandVideoOverlayPresets,
  formatVideoOverlayError,
  validateVideoOverlayRequest,
  videoOverlayLayerLabel,
} from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

const B = VIDEO_OVERLAY_BOUNDS
const seconds = z.number().finite().min(0).max(VIDEO_OVERLAY_MAX_TIME_SEC)

/**
 * One layer. Every box / look field is optional with NO `.default()`: the
 * shared normaliser in the transform below owns the defaults, and it must see
 * the RAW layer — a schema default would read as an explicit box field and
 * silently clear a preset tag (spec §3.3). `slot` is pass-through only: the
 * canvas single-node run POSTs here, and `z.object` strips unknown keys. It is
 * the layer's 1-based position on the node — the "Layer N" label and the
 * default render order — and has NO upper bound: removing a layer never
 * re-numbers the rest, so a 24-layer node with layers 1–4 removed runs its 20
 * layers at slots 5–24 on the DAG path, and this route must accept the same
 * request. The limit is the layer COUNT (`.max` on `layers` below).
 */
export const videoOverlayLayerSchema = z.object({
  imageUrl: safeUrlSchema,
  start: seconds,
  end: seconds.optional(),
  preset: z.enum(VIDEO_OVERLAY_PRESET_IDS).optional(),
  corner: z.enum(VIDEO_OVERLAY_CORNERS).optional(),
  anchor: z.enum(OVERLAY_ANCHORS).optional(),
  x: z.number().min(B.x[0]).max(B.x[1]).optional(),
  y: z.number().min(B.y[0]).max(B.y[1]).optional(),
  width: z.number().min(B.width[0]).max(B.width[1]).optional(),
  height: z.number().min(B.height[0]).max(B.height[1]).optional(),
  fit: z.enum(VIDEO_OVERLAY_FITS).optional(),
  opacity: z.number().min(B.opacity[0]).max(B.opacity[1]).optional(),
  animate: z.boolean().optional(),
  zIndex: z.number().int().min(B.zIndex[0]).max(B.zIndex[1]).optional(),
  slot: z.number().int().min(1).optional(),
})

/** An image URL whose PATH ends in .svg — the cheap early refusal; the worker's byte sniff is the invariant. */
function hasSvgPath(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".svg")
  } catch {
    return false
  }
}

export const videoOverlayBody = z
  .object({
    videoUrl: safeUrlSchema,
    layers: z
      .array(videoOverlayLayerSchema)
      .min(1, "At least 1 layer is required")
      .max(VIDEO_OVERLAY_MAX_LAYERS, `At most ${VIDEO_OVERLAY_MAX_LAYERS} layers`),
    outputAspect: z.enum(VIDEO_OVERLAY_OUTPUT_ASPECTS).optional(),
    baseFit: z.enum(VIDEO_OVERLAY_FITS).optional(),
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB color").optional(),
    /**
     * The canvas's result-freshness key (`videoOverlayCompositionKey`, computed
     * over the node's STORED settings — this body is the expanded request, so
     * the route could not recompute it). Opaque and bounded: queued with the
     * job and echoed by the worker into output_data, so a single-node Run that
     * finishes after a page reload still reads fresh on the node. Never read
     * for anything else.
     */
    resultCompositionKey: z.string().min(1).max(VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH).optional(),
    userId: z.string().uuid().optional(),
  })
  .superRefine((body, ctx) => {
    // zod 4 runs this after non-aborting field issues too (a bound, the array
    // size): the schema's own finding is the answer then — one issue, not two.
    if (ctx.issues.length > 0) return
    // ROOT path: formatZodError prints the validator's own `layers[i]:` /
    // `Layer <slot>:` label once — never a second `layers.2.end:` prefix.
    const verdict = validateVideoOverlayRequest(body)
    if (!verdict.ok) {
      ctx.addIssue({ code: "custom", path: [], message: formatVideoOverlayError(verdict) })
      return
    }
    const svg = body.layers.findIndex((l) => hasSvgPath(l.imageUrl))
    if (svg >= 0) {
      const label = videoOverlayLayerLabel({ layer: svg, slot: body.layers[svg]!.slot })
      ctx.addIssue({ code: "custom", path: [], message: `${label}: SVG images are not supported by Video Overlay yet — rasterise it with Image Overlay first` })
    }
  })
  .transform((body) => ({ ...body, layers: expandVideoOverlayPresets(body.layers) }))

export type VideoOverlayBody = z.infer<typeof videoOverlayBody>

/** Local compute at a flat price — a burst limiter keeps one user from parking
 *  the shared ffmpeg slots behind a queue of 20-layer renders (decision D4). */
const videoOverlayRateLimit = rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: "video-overlay" })

export async function videoOverlayRoutes(app: FastifyInstance) {
  app.post(
    "/v1/video-overlay",
    { preHandler: [videoOverlayRateLimit, creditGuard(() => "video-overlay")] },
    async (req, reply) => {
      const parsed = videoOverlayBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { userId: _bodyUserId, ...restData } = parsed.data
      // The freshness key rides the queue payload only (the worker echoes it
      // into output_data); the recorded config keeps no copy of the opaque blob.
      const { resultCompositionKey: _key, ...config } = parsed.data
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(config, "video-overlay"),
      })
      if (error) {
        return sendInternalError(reply, req, error, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, "video-overlay")
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      await videoQueue.add("video-overlay", { jobId: job.id, ...restData, usageLogId })
      return { jobId: job.id }
    },
  )
}
