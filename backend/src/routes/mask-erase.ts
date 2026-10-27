/**
 * Mask Erase Route — INTERNAL ONLY (decided 2026-10-26).
 *
 * A mask video (white = covered) + boxes over frame ranges → the same mask
 * with every region whose bounding-box centre lies in a box, on a frame in its
 * range, dropped (providers/video/mask-erase.ts). The Cast Swap engine's trend
 * face mask reaches it as a CHILD job of its own (`tk.http.workerRequest` with
 * a parent job) for the `"erased"` marks; nothing else may — a browser, an API
 * key, an app token, MCP and every other internal hop are refused 403 before
 * the mask is probed or anything is reserved (`createsChildJob`: internal auth
 * AND a server-only parent job in this very request's scope). It is not a
 * public API surface. The trend editor's per-person mask variants reach it
 * the same way (a child of the variant's own job, admin-billed), with `keep`.
 *
 * Local ffmpeg, no provider. Priced per started 5 seconds of the mask (the
 * `mask-erase` row is one unit, the video-utility unit), measured by the
 * preHandler, billed to the caller like the engine's other children.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { CAST_SWAP_FACE_MASK_MARK_LIMITS } from "@nodaro/render-rules"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { createsChildJob } from "../lib/job-submission-context.js"
import { maskEraseBoxSchema } from "../lib/cast-swap-face-masking.js"
import { maskEraseBaseCredits, measureMaskEraseLength } from "../lib/mask-erase-length.js"

const MAX_BOXES = CAST_SWAP_FACE_MASK_MARK_LIMITS.maxMarks

/**
 * `erase`: the boxes whose centred regions are dropped. `keep` (optional):
 * boxes whose centred regions are NEVER dropped, whatever erase box they are
 * also centred in (a trend's per-person mask variant: the people a run fills).
 * `eraseAlways` (optional): boxes whose centred regions are dropped whatever
 * keep says (a trend's "Everyone" marks in a person variant). At most 50
 * boxes in all — a trend's marks, every list together.
 */
export const maskEraseBody = z
  .object({
    maskUrl: safeUrlSchema,
    erase: z.array(maskEraseBoxSchema).min(1).max(MAX_BOXES),
    keep: z.array(maskEraseBoxSchema).max(MAX_BOXES).optional(),
    eraseAlways: z.array(maskEraseBoxSchema).max(MAX_BOXES).optional(),
    forcePrivate: z.literal(true).optional(),
  })
  .refine((b) => b.erase.length + (b.keep?.length ?? 0) + (b.eraseAlways?.length ?? 0) <= MAX_BOXES, {
    path: ["keep"],
    message: `At most ${MAX_BOXES} boxes in all (erase, keep and eraseAlways together).`,
  })

const INTERNAL_ONLY = { error: { code: "forbidden", message: "Mask Erase is an internal step of the platform's own jobs." } }

/** The door: only a worker-side child request (see the header). First, so a refused caller costs nothing. */
async function internalChildOnly(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!createsChildJob(req)) return void reply.code(403).send(INTERNAL_ONLY)
}

/**
 * Measures the mask before the credit guard prices it (the URL validated
 * first, so nothing unsafe is probed), refuses one that cannot be read or is
 * too long (400, before anything is reserved), and stashes the unit count.
 */
async function measureMaskPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const url = safeUrlSchema.safeParse(body.maskUrl)
  if (!url.success) return // the handler's Zod parse answers it
  const measured = await measureMaskEraseLength(url.data)
  if (!measured.ok) return void reply.code(400).send({ error: { code: measured.code, message: measured.message } })
  body.__maskEraseUnits = measured.units
}

const stashedUnits = (body: unknown): number => {
  const u = (body as Record<string, unknown> | undefined)?.__maskEraseUnits
  return typeof u === "number" && u >= 1 ? u : 1
}

export async function maskEraseRoutes(app: FastifyInstance) {
  app.post("/v1/mask-erase", {
    preHandler: [
      internalChildOnly,
      measureMaskPreHandler,
      // BASE credits = the one-unit row × the measured units; creditGuard applies the markup.
      creditGuard(() => "mask-erase", { computeCredits: async (body) => maskEraseBaseCredits(stashedUnits(body)) }),
    ],
  }, async (req, reply) => {
    const { __maskEraseUnits: billedUnits, ...raw } = (req.body ?? {}) as Record<string, unknown>
    const parsed = maskEraseBody.safeParse(raw)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    // An empty list is no list: the job's input and queue payload stay exactly as before the lists existed.
    const { forcePrivate: _private, keep, eraseAlways, ...rest } = parsed.data
    const body = {
      ...rest,
      ...(keep && keep.length > 0 ? { keep } : {}),
      ...(eraseAlways && eraseAlways.length > 0 ? { eraseAlways } : {}),
    }
    const { data: job, error } = await insertJob(req, {
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      input_data: { ...buildJobInputData(body, "mask-erase"), billedUnits },
    })
    if (error) return sendInternalError(reply, req, error, "Failed to create job")
    const reservation = await reserveCreditsForJob(req, reply, job.id, "mask-erase")
    if (reply.sent) return
    await videoQueue.add("mask-erase", { jobId: job.id, ...body, usageLogId: reservation?.usageLogId })
    return reply.status(202).send({ jobId: job.id })
  })
}
