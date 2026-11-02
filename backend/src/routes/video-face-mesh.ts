/**
 * Video Face Mesh Route — INTERNAL ONLY (decided 2026-10-31).
 *
 * A clip (where the faces are FOUND) and, optionally, the clip the lines go on
 * (`drawOnUrl`: the masked or depth clip) and a mask (`maskUrl`: only faces
 * centred inside it are drawn) → the drawn clip, frame for frame
 * (services/face-mesh/draw-face-mesh.ts): a thin wireframe and darker eye and
 * lip outlines (or, by `parts`, only the eye and lip outlines, or only the lip
 * outline), each a tone of the picture under it — gray, or, on a coloured
 * depth map (`colormap` + `depthUrl`), a colour of that map — so the video
 * model still sees where the mouth and the eyes are under a mask. Nodaro Motion's face masking reaches it as a
 * CHILD job of its own (`tk.http.workerRequest` with a parent job); nothing
 * else may — a browser, an API key, an app token, MCP and every other
 * internal hop are refused 403 before the clip is probed or anything is
 * reserved (`createsChildJob`, as Mask Erase). Always private.
 *
 * Local compute, no provider. Priced by the clip's length (`video-face-mesh:<n>s`,
 * `measureVideoFaceMeshLength`), measured by the preHandler, billed to the
 * caller like the engine's other children.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { VIDEO_DEPTH_COLORMAPS, VIDEO_FACE_MESH_LIMITS, VIDEO_FACE_MESH_PARTS, videoFaceMeshCreditIds } from "@nodaro/shared/media"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { createsChildJob } from "../lib/job-submission-context.js"
import { measureVideoFaceMeshLength } from "../lib/video-face-mesh-length.js"

const L = VIDEO_FACE_MESH_LIMITS
const facePct = z.number().min(L.FACE_HEIGHT_PCT_MIN).max(L.FACE_HEIGHT_PCT_MAX).optional().default(0)
const margin = z.number().min(L.ZONE_MARGIN_PCT_MIN).max(L.ZONE_MARGIN_PCT_MAX).optional().default(0)

/**
 * The request (`VideoFaceMeshRequest` in `@nodaro/shared`). `drawOnUrl` left
 * out = the lines go on `videoUrl` itself. A zone left out, `null` or all 0 =
 * no margins. `colormap` other than grayscale needs `depthUrl` (the colour of
 * a line is read from the gray depth); a `depthUrl` with no `colormap` is
 * grayscale. `parts` left out (or `"full"`) draws the whole mesh, as before;
 * `"features"` only the eye and lip outlines, `"mouth"` only the lip outline.
 * Never defaulted: a body without it is stored and queued exactly as before.
 * `forcePrivate` is what every child sends; the job is private whatever it
 * says.
 */
export const videoFaceMeshBody = z
  .object({
    videoUrl: safeUrlSchema,
    drawOnUrl: safeUrlSchema.optional(),
    maskUrl: safeUrlSchema.optional(),
    minFaceHeightPct: facePct,
    maxFaceHeightPct: facePct,
    zone: z.object({ leftPct: margin, rightPct: margin, topPct: margin, bottomPct: margin }).nullable().optional().default(null),
    colormap: z.enum(VIDEO_DEPTH_COLORMAPS).optional(),
    depthUrl: safeUrlSchema.optional(),
    parts: z.enum(VIDEO_FACE_MESH_PARTS).optional(),
    forcePrivate: z.literal(true).optional(),
  })
  .refine((b) => b.colormap === undefined || b.colormap === "grayscale" || b.depthUrl !== undefined, {
    path: ["depthUrl"],
    message: "a colormap other than grayscale needs depthUrl (the grayscale depth render of the clip): a line's colour is read from it",
  })
  .refine((b) => !(b.minFaceHeightPct > 0 && b.maxFaceHeightPct > 0 && b.minFaceHeightPct > b.maxFaceHeightPct), {
    path: ["maxFaceHeightPct"],
    message: "maxFaceHeightPct must be at least minFaceHeightPct (or 0 for no cap): no face could be drawn",
  })

const INTERNAL_ONLY = { error: { code: "forbidden", message: "Video Face Mesh is an internal step of the platform's own jobs." } }

/** The door: only a worker-side child request (see the header). First, so a refused caller costs nothing. */
async function internalChildOnly(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!createsChildJob(req)) return void reply.code(403).send(INTERNAL_ONLY)
}

const STASH = "__videoFaceMesh"
type Stash = { billedSec: number; creditId: string }
const stashOf = (body: unknown): Stash | undefined => (body as Record<string, unknown> | undefined)?.[STASH] as Stash | undefined
/** The ceiling row: only ever read for a body the preHandler already refused. */
const CEILING_ROW = videoFaceMeshCreditIds().at(-1)!

/**
 * Measures the clip the faces are found in before the credit guard prices it
 * (the URL validated first, so nothing unsafe is probed), refuses one that
 * cannot be read or is past the cap (400, before anything is reserved), and
 * stashes the price row.
 */
async function measurePreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const url = safeUrlSchema.safeParse(body.videoUrl)
  if (!url.success) return // the handler's Zod parse answers it
  const measured = await measureVideoFaceMeshLength(url.data)
  if (!measured.ok) return void reply.code(400).send({ error: { code: measured.code, message: measured.message } })
  body[STASH] = { billedSec: measured.billedSec, creditId: measured.creditId } satisfies Stash
}

export async function videoFaceMeshRoutes(app: FastifyInstance) {
  // The literal path (`VIDEO_FACE_MESH_PATH` in @nodaro/shared): the route scans read it from the source.
  app.post("/v1/video-face-mesh", {
    preHandler: [internalChildOnly, measurePreHandler, creditGuard((req) => stashOf(req.body)?.creditId ?? CEILING_ROW)],
  }, async (req, reply) => {
    const { [STASH]: _stash, ...raw } = (req.body ?? {}) as Record<string, unknown>
    const parsed = videoFaceMeshBody.safeParse(raw)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const stash = stashOf(req.body)
    if (!stash) {
      // Unreachable while measurePreHandler runs first; an invariant, not a user error.
      return sendInternalError(reply, req, new Error("video-face-mesh: length stash missing"), "Failed to create job")
    }
    const { forcePrivate: _private, ...body } = parsed.data
    const { data: job, error } = await insertJob(req, {
      // Private by default: the lines are an intermediate of the parent's run.
      force_private: true,
      user_id: userId,
      status: "pending",
      input_data: { ...buildJobInputData(body, "video-face-mesh"), billedSec: stash.billedSec, bucketKey: stash.creditId },
    })
    if (error || !job) return sendInternalError(reply, req, error, "Failed to create job")
    const reservation = await reserveCreditsForJob(req, reply, job.id, stash.creditId)
    if (reply.sent) return
    await videoQueue.add("video-face-mesh", { jobId: job.id, ...body, usageLogId: reservation?.usageLogId })
    return reply.status(202).send({ jobId: job.id })
  })
}
