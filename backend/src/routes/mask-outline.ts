/**
 * Mask Outline Route — INTERNAL ONLY (decided 2026-11-01).
 *
 * A clip (already filled: a trend's stored face mask), the mask it was filled
 * from (white = covered) and outlines (a colour and boxes over the mask's
 * frames each) → the same clip with a coloured ring just outside each
 * outline's masked regions, frame for frame (services/mask-outline/): a
 * region is an outline's when its bounding-box CENTRE lies in one of that
 * outline's boxes on that frame (Mask Erase's test); one two outlines claim
 * is left undrawn. The Cast Swap engine's trend face mask reaches it as a
 * CHILD job of its own (`tk.http.workerRequest` with a parent job) for a
 * trend's role outlines; nothing else may — a browser, an API key, an app
 * token, MCP and every other internal hop are refused 403 before the clip is
 * probed or anything is reserved (`createsChildJob`, as Mask Erase). Always
 * private.
 *
 * Local compute, no provider. Priced per started 5 seconds of the clip (the
 * `mask-outline` row is one unit, the video-utility unit), measured by the
 * preHandler, billed to the caller like the engine's other children.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { CAST_SWAP_FACE_MASK_MARK_LIMITS, ROLE_OUTLINE_PALETTE } from "@nodaro/render-rules"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { dropClientMeasureFields, requestMeasure, setRequestMeasure } from "../lib/request-measure.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { createsChildJob } from "../lib/job-submission-context.js"
import { maskEraseBoxSchema } from "../lib/cast-swap-face-masking.js"
import { maskOutlineBaseCredits, measureMaskOutlineLength } from "../lib/mask-outline-length.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { probeRefusalStatus } from "../providers/video/probe-guard.js"

const MAX_BOXES = CAST_SWAP_FACE_MASK_MARK_LIMITS.maxMarks
/** One outline per role of the palette (a trend's person slots). */
const MAX_OUTLINES = ROLE_OUTLINE_PALETTE.length

/** One outline: its colour (`#RRGGBB`) and its boxes (`MaskEraseBox`, frames of the mask). */
const outlineSchema = z.strictObject({
  colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "A colour is #RRGGBB."),
  boxes: z.array(maskEraseBoxSchema).min(1).max(MAX_BOXES),
})

/**
 * The request: `videoUrl` (the clip the rings go on), `maskUrl` (the mask it
 * was filled from), `outlines` (1–6, at most 50 boxes in all). `forcePrivate`
 * is what every child sends; the job is private whatever it says.
 */
export const maskOutlineBody = z
  .object({
    videoUrl: safeUrlSchema,
    maskUrl: safeUrlSchema,
    outlines: z.array(outlineSchema).min(1).max(MAX_OUTLINES),
    forcePrivate: z.literal(true).optional(),
  })
  .refine((b) => b.outlines.reduce((n, o) => n + o.boxes.length, 0) <= MAX_BOXES, {
    path: ["outlines"],
    message: `At most ${MAX_BOXES} boxes in all.`,
  })

const INTERNAL_ONLY = { error: { code: "forbidden", message: "Mask Outline is an internal step of the platform's own jobs." } }

/** The door: only a worker-side child request (see the header). First, so a refused caller costs nothing. */
async function internalChildOnly(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!createsChildJob(req)) return void reply.code(403).send(INTERNAL_ONLY)
}

/** The body field the units were once stashed under: a client's copy is dropped, never read. */
const UNITS_FIELD = "__maskOutlineUnits"
/** The request measure the units are kept under (server-side only, `lib/request-measure.ts`). */
const MEASURE = "maskOutlineUnits"

/**
 * Measures the clip before the credit guard prices it (the URL validated
 * first, so nothing unsafe is probed), refuses one that cannot be read or is
 * too long (400, before anything is reserved), and keeps the unit count on
 * the server-side request — never the body, whose field of the old stash name
 * is dropped first.
 */
async function measurePreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  dropClientMeasureFields(req.body, [UNITS_FIELD])
  const body = (req.body ?? {}) as Record<string, unknown>
  const url = safeUrlSchema.safeParse(body.videoUrl)
  if (!url.success) return // the handler's Zod parse answers it
  const measured = await measureMaskOutlineLength(url.data)
  if (!measured.ok) return void reply.code(probeRefusalStatus(measured.code)).send({ error: { code: measured.code, message: measured.message } })
  setRequestMeasure(req, MEASURE, measured.units)
}

/** The units the preHandler measured; 1 when it measured nothing (a body the handler's parse refuses). */
const measuredUnits = (req: FastifyRequest): number => {
  const u = requestMeasure<number>(req, MEASURE)
  return typeof u === "number" && u >= 1 ? u : 1
}

export async function maskOutlineRoutes(app: FastifyInstance) {
  app.post("/v1/mask-outline", {
    preHandler: [
      internalChildOnly,
      measurePreHandler,
      // BASE credits = the one-unit row × the measured units; creditGuard applies the markup.
      creditGuard(() => "mask-outline", { computeCredits: async (_body, req) => maskOutlineBaseCredits(measuredUnits(req)) }),
    ],
  }, async (req, reply) => {
    const billedUnits = requestMeasure<number>(req, MEASURE)
    const parsed = maskOutlineBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const { forcePrivate: _private, ...body } = parsed.data
    const { data: job, error } = await insertJob(req, {
      // Private by default: the rings are an intermediate of the parent's make.
      force_private: true,
      user_id: userId,
      status: "pending",
      input_data: { ...buildJobInputData(body, "mask-outline"), billedUnits },
    })
    if (error || !job) return sendInternalError(reply, req, error, "Failed to create job")
    const reservation = await reserveCreditsForJob(req, reply, job.id, "mask-outline")
    if (reply.sent) return
    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("mask-outline", { jobId: job.id, ...body, usageLogId: reservation?.usageLogId }))
    if (reply.sent) return
    return reply.status(202).send({ jobId: job.id })
  })
}
