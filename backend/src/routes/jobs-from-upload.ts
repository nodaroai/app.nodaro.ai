/**
 * POST /v1/jobs/from-upload — record an image the caller edited in the browser
 * (and already stored with `POST /v1/upload`) as a COMPLETED job.
 *
 * Why a job: everything that treats a picture as a result — a generation
 * session's items, job history, the owner's gallery, favorites, ratings, the
 * Studio approvals, the AI tools that take a `jobId` — reads jobs. An upload
 * is only an asset, so without this an edit can never sit next to the picture
 * it was made from.
 *
 * The invariants (decided 2026-10-20):
 *  - The file is named by its `assetId`, never a url: the caller's own upload
 *    row, a stored image, and an object the caller provably made
 *    (`judgeUrlForRecording`). The job's `imageUrl` is that object's canonical
 *    url; its pixel size is stamped by the completion funnel.
 *  - One upload is one job: the row is keyed `image-edit:<assetId>` on the
 *    race-proof idempotent insert, so a double click or a retry answers the
 *    same job (and finishes it, when the first attempt died before it did).
 *  - Always private: an upload is the caller's own content, so the row is
 *    written `is_public: false` + `force_private: true` (the worker's own rule
 *    for uploaded input — no worker runs here to apply it).
 *  - The source is linked in `input_data` (`sourceJobId` / `sourceAssetId` and
 *    a `sourceImageUrl` the SERVER reads from that source), never through
 *    `parent_job_id`: that column makes a child job — hidden from lists,
 *    cancelled with its parent and deleted with it.
 *  - An edit of a studio image keeps the source's `attachTo*Id`, so it lists
 *    with that entity and the main-image approvals' entity check still applies.
 *  - Completed through `markJobCompletedDetailed` (the result gate and the size
 *    stamp run), with no credit reservation: the edit is free and its storage
 *    was charged when it was uploaded. No second asset row is written — the
 *    upload already is the library's record of the file.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { insertSyncJobIdempotent } from "../lib/insert-job.js"
import { judgeUrlForRecording, storageUrlPath } from "../lib/key-ownership.js"
import { jobBlockedBody } from "../lib/job-policy.js"
import { markJobCompletedDetailed } from "../workers/shared.js"
import { sanitizeJobForPublic, type JobRecord } from "./jobs.js"

/** The job type this route writes (`input_data.type` and `job_type`). */
export const IMAGE_EDIT_JOB_TYPE = "image-edit"

/** The lanes this route completes, by job type — the image-size census reads it. */
export const JOBS_FROM_UPLOAD_LANES = { [IMAGE_EDIT_JOB_TYPE]: "POST /v1/jobs/from-upload" } as const

/** Studio links an edit inherits from its source job. */
const ATTACH_KEYS = ["attachToCharacterId", "attachToObjectId", "attachToCreatureId", "attachToLocationId"] as const

/** The editor's design state, as `POST /v1/upload-json` stores it. */
const EDIT_STATE_PATH_RE = /^projects\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i

const JOB_COLUMNS =
  "id, status, progress, input_data, output_data, error_message, error_hint, created_at, started_at, completed_at, user_id, credits, job_type, source, source_detail, session_id"

export const jobFromUploadBody = z
  .object({
    assetId: z.string().uuid().describe("The edited image's `assetId`, as `POST /v1/upload` returned it."),
    sourceJobId: z.string().uuid().optional().describe("The job whose image was edited."),
    sourceImageUrl: z
      .string()
      .url()
      .optional()
      .describe("Which of `sourceJobId`'s images was edited, when it made several. Default: its `imageUrl`."),
    sourceAssetId: z.string().uuid().optional().describe("The upload that was edited, when the source is not a job."),
    editStateUrl: z
      .string()
      .url()
      .optional()
      .describe("The editor's design state, stored with `POST /v1/upload-json`, so the edit can be reopened."),
    sessionId: z.string().uuid().optional().describe("The generation session to file the job in."),
  })
  .refine((b) => !(b.sourceJobId && b.sourceAssetId), { message: "Send sourceJobId or sourceAssetId, not both", path: ["sourceAssetId"] })
  .refine((b) => !b.sourceImageUrl || b.sourceJobId, { message: "sourceImageUrl needs sourceJobId", path: ["sourceImageUrl"] })

type JobFromUploadBody = z.infer<typeof jobFromUploadBody>

class RequestRefusal extends Error {
  constructor(readonly statusCode: 400 | 404, readonly code: string, message: string) {
    super(message)
  }
}

const notFound = (what: string) => new RequestRefusal(404, "not_found", `${what} not found`)

/** The edited image: the caller's own stored upload, as its canonical url. */
async function editedImageUrl(userId: string, assetId: string): Promise<{ url: string; thumbnailUrl: string | null }> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, type, mime_type, r2_url, metadata")
    .eq("id", assetId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  const asset = data as { type: string | null; mime_type: string | null; r2_url: string | null; metadata: Record<string, unknown> | null } | null
  if (!asset?.r2_url) throw notFound("Asset")
  if (asset.type !== "image" || !asset.mime_type?.startsWith("image/")) {
    throw new RequestRefusal(400, "validation_error", "The asset is not an image")
  }
  const judged = await judgeUrlForRecording(userId, asset.r2_url)
  // Off our storage, or an object the caller did not make: the same answer, so
  // the refusal says nothing about whose file it is.
  if (judged.kind !== "owned") throw new RequestRefusal(400, "validation_error", "The asset is not a stored upload of yours")
  const thumb = asset.metadata?.thumbnail_url
  return { url: judged.url, thumbnailUrl: typeof thumb === "string" && thumb ? thumb : null }
}

function outputImages(output: unknown): string[] {
  if (!output || typeof output !== "object") return []
  const o = output as { imageUrl?: unknown; imageUrls?: unknown }
  const all = [o.imageUrl, ...(Array.isArray(o.imageUrls) ? o.imageUrls : [])]
  return [...new Set(all.filter((u): u is string => typeof u === "string" && u !== ""))]
}

/** What the job records about its source, read from the source itself. */
async function sourceFields(userId: string, body: JobFromUploadBody): Promise<Record<string, unknown>> {
  if (body.sourceJobId) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, status, input_data, output_data")
      .eq("id", body.sourceJobId)
      .eq("user_id", userId)
      .maybeSingle()
    if (error) throw error
    const job = data as { status: string; input_data: Record<string, unknown> | null; output_data: unknown } | null
    if (!job) throw notFound("Source job")
    const images = outputImages(job.output_data)
    if (job.status !== "completed" || images.length === 0) {
      throw new RequestRefusal(400, "validation_error", "The source job has no finished image")
    }
    const sourceImageUrl = body.sourceImageUrl ?? images[0]!
    if (!images.includes(sourceImageUrl)) {
      throw new RequestRefusal(400, "validation_error", "sourceImageUrl is not an image of the source job")
    }
    const input = job.input_data ?? {}
    const attach = Object.fromEntries(ATTACH_KEYS.filter((k) => typeof input[k] === "string").map((k) => [k, input[k]]))
    return { sourceJobId: body.sourceJobId, sourceImageUrl, ...attach }
  }
  if (body.sourceAssetId) {
    const { data, error } = await supabase
      .from("assets")
      .select("id, r2_url")
      .eq("id", body.sourceAssetId)
      .eq("user_id", userId)
      .maybeSingle()
    if (error) throw error
    const asset = data as { r2_url: string | null } | null
    if (!asset?.r2_url) throw notFound("Source asset")
    return { sourceAssetId: body.sourceAssetId, sourceImageUrl: asset.r2_url }
  }
  return {}
}

/** The design state's canonical url — an object `POST /v1/upload-json` writes, on our storage. */
function editStateUrlOf(url: string | undefined): Record<string, unknown> {
  if (!url) return {}
  const where = storageUrlPath(url)
  if (where.kind !== "ours" || !EDIT_STATE_PATH_RE.test(where.path)) {
    throw new RequestRefusal(400, "validation_error", "editStateUrl must be a url POST /v1/upload-json returned")
  }
  return { editStateUrl: `${config.R2_PUBLIC_URL}/${where.path}` }
}

async function readJob(userId: string, id: string): Promise<JobRecord> {
  const { data, error } = await supabase.from("jobs").select(JOB_COLUMNS).eq("id", id).eq("user_id", userId).single()
  if (error) throw error
  return data as unknown as JobRecord
}

/** The job policy's verdict on a failed job, when one refused it. */
function policyBlockOf(job: JobRecord): { reason?: string } | null {
  const hint = job.error_hint as { kind?: string; reason?: string } | null | undefined
  return job.status === "failed" && hint?.kind === "policy-block" ? hint : null
}

function send(req: FastifyRequest, reply: FastifyReply, status: 200 | 201, job: JobRecord): FastifyReply {
  const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"
  return reply.status(status).send({ data: sanitizeJobForPublic(job, isAdmin) })
}

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/jobs/from-upload",
  description:
    "Record an image edited in the browser — already stored with `POST /v1/upload` — as a completed, private, free " +
    "`image-edit` job, linked to the job or upload it was made from. One upload is one job: sending the same " +
    "`assetId` again answers the same job (200). OAuth apps need the `assets:write` scope.",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { "application/json": { schema: jobFromUploadBody } } } },
  responses: {
    200: { description: "The job already recorded for this asset" },
    201: { description: "The job, completed" },
    400: { description: "Not an image, not a stored upload of yours, or a source without a finished image" },
    401: { description: "Unauthorized" },
    403: { description: "An OAuth app without `assets:write`" },
    404: { description: "The asset, the source or the session is not yours" },
    422: { description: "A job policy of this deployment blocked the image" },
  },
})

export async function jobsFromUploadRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/jobs/from-upload",
    { preHandler: requireAppScope("assets:write"), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      const parsed = jobFromUploadBody.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
      const body = parsed.data

      try {
        const [image, source] = await Promise.all([editedImageUrl(userId, body.assetId), sourceFields(userId, body)])
        const editState = editStateUrlOf(body.editStateUrl)

        // `sessionId` and `origin` are stamped by the funnel from the raw body /
        // headers; a session the caller may not use throws its 404 from here.
        // Throws on a block or a database error — answered by the catch below.
        const inserted = await insertSyncJobIdempotent<{ id: string; status: string }>(
          req,
          {
            user_id: userId,
            status: "pending",
            credits: 0,
            is_public: false,
            force_private: true,
            input_data: { type: IMAGE_EDIT_JOB_TYPE, assetId: body.assetId, ...source, ...editState },
          },
          `${IMAGE_EDIT_JOB_TYPE}:${body.assetId}`,
          "id, status",
        )
        const { row, created } = inserted

        // A retry whose first attempt died after the insert finishes the job;
        // any other earlier outcome is answered as it stands — a blocked image
        // with the same 422 every time, never a 200 carrying a failed job.
        if (row.status !== "pending") {
          const earlier = await readJob(userId, row.id)
          const blockedHint = policyBlockOf(earlier)
          if (blockedHint) return reply.status(422).send(jobBlockedBody({ userMessage: blockedHint.reason }))
          return send(req, reply, 200, earlier)
        }

        const outcome = await markJobCompletedDetailed(row.id, {
          output_data: { imageUrl: image.url, ...(image.thumbnailUrl ? { thumbnailUrl: image.thumbnailUrl } : {}) },
        })
        const job = await readJob(userId, row.id)
        if (outcome === "blocked") return reply.status(422).send(jobBlockedBody({ userMessage: policyBlockOf(job)?.reason }))
        return send(req, reply, created ? 201 : 200, job)
      } catch (err) {
        if (err instanceof RequestRefusal) {
          return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
        }
        return sendInternalError(reply, req, err, "Failed to record the edited image")
      }
    },
  )
}
