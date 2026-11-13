/**
 * POST /v1/video-overlay — timed image and video layers over a video, rendered locally
 * by the video worker (`ffmpegHandlers["video-overlay"]`). The handler shape of
 * fade-video.ts. Everything a schema cannot express is the shared validator's
 * (`validateVideoOverlayRequest`), and the shared normaliser
 * (`expandVideoOverlayPresets`) owns every default — so validation runs before
 * the job insert and the credit reservation: a bad body costs nothing.
 *
 * The price (`videoOverlayCreditId` in @nodaro/shared): an image-only run is
 * the flat `video-overlay` row and its base is never measured. A run with a
 * video layer is charged the `video-overlay:video` row per started 5 s of the
 * output — the base's length, measured by the preHandler before the guard
 * prices it (lib/video-overlay-length.ts, the rule the workflow run stamps by).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  OVERLAY_ANCHORS,
} from "@nodaro/shared/media"
import {
  VIDEO_OVERLAY_BOUNDS,
  VIDEO_OVERLAY_CORNERS,
  VIDEO_OVERLAY_FITS,
  VIDEO_OVERLAY_LAYOUT_IDS,
  VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH,
  VIDEO_OVERLAY_MAX_LAYERS,
  VIDEO_OVERLAY_MAX_TIME_SEC,
  VIDEO_OVERLAY_OUTPUT_ASPECTS,
  VIDEO_OVERLAY_PRESET_IDS,
  VIDEO_OVERLAY_VOLUME_BOUNDS,
  expandVideoOverlayPresets,
  formatVideoOverlayError,
  validateVideoOverlayRequest,
  videoOverlayHasVideoLayer,
  videoOverlayLayerLabel,
} from "@nodaro/shared/video"
import { videoOverlayCreditId } from "@nodaro/shared/credits"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { measureVideoOverlayBase, videoOverlayBaseCredits } from "../lib/video-overlay-length.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"

const B = VIDEO_OVERLAY_BOUNDS
const seconds = z.number().finite().min(0).max(VIDEO_OVERLAY_MAX_TIME_SEC)

/** The six box fields, every one optional — a layer's box and the base's (`baseBox`) alike. */
const boxFields = {
  anchor: z.enum(OVERLAY_ANCHORS).optional(),
  x: z.number().min(B.x[0]).max(B.x[1]).optional(),
  y: z.number().min(B.y[0]).max(B.y[1]).optional(),
  width: z.number().min(B.width[0]).max(B.width[1]).optional(),
  height: z.number().min(B.height[0]).max(B.height[1]).optional(),
  fit: z.enum(VIDEO_OVERLAY_FITS).optional(),
}

/**
 * One layer. Every box / look field is optional with NO `.default()`: the
 * shared normaliser in the transform below owns the defaults, and it must see
 * the RAW layer — a schema default would read as an explicit box field and
 * silently clear a preset tag (spec §3.3). The source is `imageUrl` or
 * `videoUrl`, each optional here: "exactly one" is the shared validator's
 * rule (`layer_two_sources`, `layer_without_image`), as `sound` on an image
 * layer is (`sound_without_video`). `slot` is pass-through only: the
 * canvas single-node run POSTs here, and `z.object` strips unknown keys. It is
 * the layer's 1-based position on the node — the "Layer N" label and the
 * default render order — and has NO upper bound: removing a layer never
 * re-numbers the rest, so a 24-layer node with layers 1–4 removed runs its 20
 * layers at slots 5–24 on the DAG path, and this route must accept the same
 * request. The limit is the layer COUNT (`.max` on `layers` below).
 */
export const videoOverlayLayerSchema = z.object({
  imageUrl: safeUrlSchema.optional(),
  videoUrl: safeUrlSchema.optional(),
  sound: z
    .object({ volume: z.number().min(VIDEO_OVERLAY_VOLUME_BOUNDS[0]).max(VIDEO_OVERLAY_VOLUME_BOUNDS[1]) })
    .optional(),
  start: seconds,
  end: seconds.optional(),
  preset: z.enum(VIDEO_OVERLAY_PRESET_IDS).optional(),
  corner: z.enum(VIDEO_OVERLAY_CORNERS).optional(),
  ...boxFields,
  opacity: z.number().min(B.opacity[0]).max(B.opacity[1]).optional(),
  animate: z.boolean().optional(),
  zIndex: z.number().int().min(B.zIndex[0]).max(B.zIndex[1]).optional(),
  slot: z.number().int().min(1).optional(),
  // Pass-through, like `slot`: the 1-based layer-plan entry the canvas run's request carries.
  planLayer: z.number().int().min(1).optional(),
})

/** An image URL whose PATH ends in .svg — the cheap early refusal; the worker's byte sniff is the invariant. A layer with no image (a video layer) has none. */
function hasSvgPath(url: string | undefined): boolean {
  if (url === undefined) return false
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
     * Where the base sits, in a layer's box vocabulary and bounds. Partial on
     * purpose: the shared validator asks for an anchor and a width
     * (`incomplete_box`) and an `outputAspect` (`base_box_needs_aspect`).
     */
    baseBox: z.object(boxFields).optional(),
    /** A named layout; what it needs (an aspect, a video layer, no `baseBox` on a stack) is the validator's. The worker expands it. */
    layout: z.enum(VIDEO_OVERLAY_LAYOUT_IDS).optional(),
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
      const label = videoOverlayLayerLabel({ layer: svg, slot: body.layers[svg]!.slot, planLayer: body.layers[svg]!.planLayer })
      ctx.addIssue({ code: "custom", path: [], message: `${label}: SVG images are not supported by Video Overlay yet — rasterise it with Image Overlay first` })
    }
  })
  .transform((body) => ({ ...body, layers: expandVideoOverlayPresets(body.layers) }))

export type VideoOverlayBody = z.infer<typeof videoOverlayBody>

/** Local compute — a burst limiter keeps one user from parking the shared
 *  ffmpeg slots behind a queue of 20-layer renders (decision D4). */
const videoOverlayRateLimit = rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: "video-overlay" })

/**
 * The units the preHandler MEASURED, per request — server state the client
 * cannot reach (never a body key: a body is the client's, and an image-only
 * body carrying one would be priced off the video row).
 */
const measuredUnits = new WeakMap<FastifyRequest, number>()

/**
 * Measures the base of a run with a video layer before the credit guard prices
 * it, and keeps its units for the guard. Only a body the schema accepts is
 * measured (so nothing unsafe is probed, and the handler answers any other with
 * its one validation finding); an image-only body never is. A base that cannot
 * be read, one past the cap, or a length that leaves nothing to draw
 * (`videoOverlayRefusalAtLength`) is a 400 before anything is reserved.
 */
async function measureBasePreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = videoOverlayBody.safeParse(req.body)
  if (!parsed.success || !videoOverlayHasVideoLayer(parsed.data.layers)) return
  const measured = await measureVideoOverlayBase(parsed.data)
  if (!measured.ok) {
    return void reply.code(400).send({ error: { code: measured.code, message: measured.message } })
  }
  measuredUnits.set(req, measured.units)
}

/** The units the preHandler measured for this request; undefined for an image-only (or unmeasured) request. */
const unitsOf = (req: FastifyRequest): number | undefined => measuredUnits.get(req)

/** The row a request is charged from: the video row once its base is measured, else the flat image row. */
const creditIdOf = (req: FastifyRequest): string => videoOverlayCreditId(unitsOf(req) !== undefined)

export async function videoOverlayRoutes(app: FastifyInstance) {
  app.post(
    "/v1/video-overlay",
    {
      preHandler: [
        videoOverlayRateLimit,
        measureBasePreHandler,
        // A run with a video layer: BASE credits = the one-unit row × the measured units; creditGuard applies the markup.
        // An image-only run: no override — the flat row prices it, as before.
        creditGuard(creditIdOf, {
          computeCredits: async (_body, req) => {
            const units = unitsOf(req)
            return units === undefined ? undefined : videoOverlayBaseCredits(units)
          },
        }),
      ],
    },
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
      const billedUnits = unitsOf(req)
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
        // A run with a video layer records the units it is charged; an image-only run records exactly what it did before.
        input_data: billedUnits === undefined ? buildJobInputData(config, "video-overlay") : { ...buildJobInputData(config, "video-overlay"), billedUnits },
      })
      if (error) {
        return sendInternalError(reply, req, error, "Failed to create job")
      }

      const reservation = await reserveCreditsForJob(req, reply, job.id, creditIdOf(req))
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      // A run with a video layer carries the units it was charged for (the server's own measurement, never a
      // body field — the schema strips those): the worker refuses a base that has grown past them since.
      await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("video-overlay", { jobId: job.id, ...restData, ...(billedUnits === undefined ? {} : { billedUnits }), usageLogId }))
      if (reply.sent) return
      return { jobId: job.id }
    },
  )
}
