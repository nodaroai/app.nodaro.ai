import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { JOB_TITLE_MAX_CHARS, normalizeJobTitle, setJobTitle } from "../lib/job-title.js"
import { updateJobOwnerFields, type UpdateJobOutcome } from "../lib/job-update.js"
import { isOwnMediaUrl } from "../lib/fetch-own-media.js"
import { JOB_COVER_MAX_BYTES, JOB_COVER_MAX_SIDE, JOB_COVER_MIN_SIDE, JOB_COVER_PROBLEM_MESSAGE } from "../lib/job-cover/cover-source.js"
import { jobCoverRequestSchema, type JobCoverRequest } from "../lib/job-cover/cover-request.js"
import { JOB_COVER_WRITE_LIMIT } from "../lib/job-cover/cover-rate-limit.js"

/**
 * `PATCH /v1/jobs/:id` — name one of your jobs, or clear its name
 * (lib/job-title.ts); set its cover picture, or clear it (lib/job-update.ts,
 * lib/job-cover/, decided 2026-11-23). Each field optional, at least one. The owner only, as a rating: anyone else's job, an
 * admin's request included, is `404 not_found`. Free; any job type and
 * status, the Trash included; nothing else about the job changes (no
 * reordering of results). An OAuth app needs `assets:write`, like a rating or
 * a delete. Registered by `jobRoutes` (routes/jobs.ts).
 */

const jobIdParams = z.object({ id: z.string().uuid() })

// Each field is optional, so "clear it" is an explicit null (or "" for the
// name), never a missing field. The title cap here only bounds the request
// body; the real rule (trimmed, 1–120 characters, plain text) is
// normalizeJobTitle's. A cover's shape is lib/job-cover/cover-request.ts's
// (shared with the MCP tool) and the file is judged by
// lib/job-cover/cover-source.ts (ours, the caller's, a real picture).
const renameJobBody = z.object({
  title: z.string().max(10_000).nullable().optional().describe("The name, or null (or \"\") to clear it. Trimmed; 1–120 characters of plain text."),
  cover: jobCoverRequestSchema.nullable().optional().describe(
    `The cover picture: one of your images on this platform, { assetId } (a library asset) or { url } (its address on this platform's storage), or null to clear it. PNG, JPEG, WebP or GIF, at most ${JOB_COVER_MAX_BYTES / (1024 * 1024)} MB, ${JOB_COVER_MIN_SIDE}–${JOB_COVER_MAX_SIDE} pixels on each side.`,
  ),
}).refine((b) => b.title !== undefined || b.cover !== undefined, { message: "Send title, cover, or both" })

type RenameJobBody = z.infer<typeof renameJobBody>

const RenameResult = z.object({
  data: z.object({
    jobId: z.string().uuid(),
    title: z.string().min(1).max(JOB_TITLE_MAX_CHARS).nullable().optional().describe("The name now, when title was sent"),
    coverUrl: z.string().nullable().optional().describe("The picture now, when cover was sent: your cover, else the provider's art, else null"),
  }),
})

/** Every request to this route, per caller. */
const WRITE_LIMIT = { rateLimit: { max: 120, timeWindow: "1 minute" } }
// A request carrying `cover` is also held to the cover's own, lower limit, per
// user (lib/job-cover/cover-rate-limit.ts, asked inside updateJobOwnerFields so
// the MCP tool cannot skip it): 429 rate_limit_exceeded.

openApiRegistry.registerPath({
  method: "patch",
  path: "/v1/jobs/{id}",
  description:
    "Name one of your jobs — \"Wedding toast, final\" on a picture, a clip, a track or a speech take — or clear its name with `null` (or `\"\"`); " +
    "and/or set its cover picture, or clear it with `null`. Send `title`, `cover`, or both. " +
    "The name: trimmed; 1–120 characters of plain text, any language; it reads back as `title`. " +
    "The cover: one of your images on this platform — one you uploaded or generated — `{ \"assetId\": … }` (a library asset) or `{ \"url\": … }` (its address on this platform's storage); any other address, or a file you did not make, is refused; " +
    `PNG, JPEG, WebP or GIF, at most ${JOB_COVER_MAX_BYTES / (1024 * 1024)} MB, ${JOB_COVER_MIN_SIDE}–${JOB_COVER_MAX_SIDE} pixels on each side. The job keeps its own copy. ` +
    "It reads back as `coverUrl` wherever the job is returned (the job reads and the list, a session's items, the Trash, the library's rows, a share): your cover, else the provider's art (a Suno song's), else null. " +
    `Two changes to one job's cover at once: one lands, the other is \`409 conflict\` (read the job and send again). Requests that send \`cover\` are limited to ${JOB_COVER_WRITE_LIMIT.max} a minute. ` +
    "The owner only: anyone else's job is `404 not_found`. Free; any job type and status, the Trash included; nothing else about the job changes. OAuth apps need `assets:write`.",
  security: [{ bearerAuth: [] }],
  request: {
    params: jobIdParams,
    body: { content: { "application/json": { schema: renameJobBody } } },
  },
  responses: {
    200: { description: "The fields sent, as the job now has them", content: { "application/json": { schema: RenameResult } } },
    400: { description: "Neither field sent; a name longer than 120 characters after trimming, or one that is not plain text; a cover that is not one of your images on this platform, or not a PNG, JPEG, WebP or GIF of the accepted size" },
    401: { description: "Unauthorized" },
    403: { description: "An OAuth token without assets:write" },
    404: { description: "Job not found (or not yours)" },
    409: { description: "Another change to this job's cover landed first; nothing was written" },
    429: { description: `Too many requests (requests that send cover are limited to ${JOB_COVER_WRITE_LIMIT.max} a minute)` },
    503: { description: "Naming a job, or setting its cover, is not available on this server yet" },
  },
})

type Reply = FastifyReply

const notFound = (reply: Reply) => reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
const invalid = (reply: Reply, message: string) => reply.status(400).send({ error: { code: "validation_error", message } })

/** The normalized name, or the 400 it answers. Undefined when no name was sent. */
function titleOf(body: RenameJobBody): { title: string | null | undefined } | { problem: string } {
  if (body.title === undefined) return { title: undefined }
  const normalized = normalizeJobTitle(body.title)
  if (!("problem" in normalized)) return { title: normalized.title }
  return {
    problem: normalized.problem === "too_long"
      ? `title must be at most ${JOB_TITLE_MAX_CHARS} characters`
      : "title must be one line of plain text (no line breaks or other control characters)",
  }
}

/** A name alone: the rename it always was. */
async function renameOnly(req: FastifyRequest, reply: Reply, userId: string, jobId: string, title: string | null) {
  let outcome
  try {
    outcome = await setJobTitle(userId, jobId, title)
  } catch (err) {
    return sendInternalError(reply, req, err, "Failed to rename job")
  }
  if (outcome.kind === "not_found") return notFound(reply)
  if (outcome.kind === "not_available") {
    return reply.status(503).send({ error: { code: "not_available", message: "Naming a job is not available on this server yet." } })
  }
  return { data: { jobId, title: outcome.title } }
}

/** The answer to a change that set or cleared the cover. */
function answerChange(reply: Reply, jobId: string, changed: UpdateJobOutcome) {
  switch (changed.kind) {
    case "not_found":
      return notFound(reply)
    case "invalid_cover":
      return invalid(reply, JOB_COVER_PROBLEM_MESSAGE[changed.problem])
    case "rate_limited":
      return reply
        .status(429)
        .header("retry-after", String(changed.retryAfterSec))
        .send({ error: { code: "rate_limit_exceeded", message: `Too many cover changes. Retry in ${changed.retryAfterSec}s.` } })
    case "conflict":
      return reply.status(409).send({ error: { code: "conflict", message: "Another change to this job's cover landed first. Read the job and try again." } })
    case "not_available": {
      const message = changed.field === "cover"
        ? "Setting a job's cover is not available on this server yet."
        : "Naming a job is not available on this server yet."
      return reply.status(503).send({ error: { code: "not_available", message } })
    }
    default: {
      const { kind: _kind, ...fields } = changed
      return { data: { jobId, ...fields } }
    }
  }
}

/** A change that names a cover. */
async function changeWithCover(
  req: FastifyRequest, reply: Reply,
  ids: { userId: string; jobId: string }, changes: { title: string | null | undefined; cover: JobCoverRequest | null },
) {
  // An address that is not on this deployment's storage is refused here, before anything is read.
  if (changes.cover && "url" in changes.cover && !isOwnMediaUrl(changes.cover.url)) return invalid(reply, JOB_COVER_PROBLEM_MESSAGE.not_platform_image)
  let changed
  try {
    changed = await updateJobOwnerFields(ids.userId, ids.jobId, { ...(changes.title !== undefined ? { title: changes.title } : {}), cover: changes.cover })
  } catch (err) {
    return sendInternalError(reply, req, err, "Failed to update job")
  }
  return answerChange(reply, ids.jobId, changed)
}

export function registerJobTitleRoute(app: FastifyInstance): void {
  app.patch<{ Params: { id: string } }>(
    "/v1/jobs/:id",
    { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT },
    async (req, reply) => {
      if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      // An id that cannot be a job is no job of theirs.
      const params = jobIdParams.safeParse(req.params)
      if (!params.success) return notFound(reply)
      const body = renameJobBody.safeParse(req.body ?? {})
      if (!body.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(body.error) } })
      const title = titleOf(body.data)
      if ("problem" in title) return invalid(reply, title.problem)
      const ids = { userId: req.userId, jobId: params.data.id }
      if (body.data.cover === undefined) return renameOnly(req, reply, ids.userId, ids.jobId, title.title ?? null)
      return changeWithCover(req, reply, ids, { title: title.title, cover: body.data.cover })
    },
  )
}
