import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { JOB_TITLE_MAX_CHARS, normalizeJobTitle, setJobTitle } from "../lib/job-title.js"

/**
 * `PATCH /v1/jobs/:id` — name one of your jobs, or clear its name
 * (lib/job-title.ts). The owner only, as a rating: anyone else's job, an
 * admin's request included, is `404 not_found`. Free; any job type and
 * status, the Trash included; nothing else about the job changes (no
 * reordering of results). An OAuth app needs `assets:write`, like a rating or
 * a delete. Registered by `jobRoutes` (routes/jobs.ts).
 */

const jobIdParams = z.object({ id: z.string().uuid() })

// `title` is required, so "clear it" is an explicit null (or ""), never a
// missing field. The cap here only bounds the request body; the real rule
// (trimmed, 1–120 characters, plain text) is normalizeJobTitle's.
const renameJobBody = z.object({
  title: z.string().max(10_000).nullable().describe("The name, or null (or \"\") to clear it. Trimmed; 1–120 characters of plain text."),
})

const RenameResult = z.object({
  data: z.object({ jobId: z.string().uuid(), title: z.string().min(1).max(JOB_TITLE_MAX_CHARS).nullable() }),
})

const WRITE_LIMIT = { rateLimit: { max: 120, timeWindow: "1 minute" } }

openApiRegistry.registerPath({
  method: "patch",
  path: "/v1/jobs/{id}",
  description:
    "Name one of your jobs — \"Wedding toast, final\" on a picture, a clip, a track or a speech take — or clear its name with `null` (or `\"\"`). " +
    "Trimmed; 1–120 characters of plain text, any language. The owner only: anyone else's job is `404 not_found`. Free; any job type and status, the Trash included; " +
    "nothing else about the job changes. The name reads back as `title` wherever the job is returned. OAuth apps need `assets:write`.",
  security: [{ bearerAuth: [] }],
  request: {
    params: jobIdParams,
    body: { content: { "application/json": { schema: renameJobBody } } },
  },
  responses: {
    200: { description: "The job's name now", content: { "application/json": { schema: RenameResult } } },
    400: { description: "A name longer than 120 characters after trimming, or one that is not plain text (a line break or another control character)" },
    401: { description: "Unauthorized" },
    403: { description: "An OAuth token without assets:write" },
    404: { description: "Job not found (or not yours)" },
    503: { description: "Naming a job is not available on this server yet" },
  },
})

export function registerJobTitleRoute(app: FastifyInstance): void {
  app.patch<{ Params: { id: string } }>(
    "/v1/jobs/:id",
    { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT },
    async (req, reply) => {
      if (!req.userId) {
        return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      }
      // An id that cannot be a job is no job of theirs.
      const params = jobIdParams.safeParse(req.params)
      if (!params.success) {
        return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
      }
      const body = renameJobBody.safeParse(req.body ?? {})
      if (!body.success) {
        return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(body.error) } })
      }
      const normalized = normalizeJobTitle(body.data.title)
      if ("problem" in normalized) {
        const message =
          normalized.problem === "too_long"
            ? `title must be at most ${JOB_TITLE_MAX_CHARS} characters`
            : "title must be one line of plain text (no line breaks or other control characters)"
        return reply.status(400).send({ error: { code: "validation_error", message } })
      }

      let outcome
      try {
        outcome = await setJobTitle(req.userId, params.data.id, normalized.title)
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to rename job")
      }
      if (outcome.kind === "not_found") {
        return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
      }
      if (outcome.kind === "not_available") {
        return reply.status(503).send({
          error: { code: "not_available", message: "Naming a job is not available on this server yet." },
        })
      }
      return { data: { jobId: params.data.id, title: outcome.title } }
    },
  )
}
