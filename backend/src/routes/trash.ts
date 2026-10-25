/**
 * GET /v1/trash — the caller's Trash, one newest-first page at a time
 * (lib/trash-listing.ts): items removed from sessions and deleted jobs, scoped
 * to one project, to the sessions with no project (`projectId=none`), or to
 * everywhere, and filtered by creation tool and job type. A UI shows it as one
 * entry beside General in its sessions list. Reads need `jobs:read` for an
 * OAuth app, like every other job read.
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { requireScope } from "../lib/scopes.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { decodeTrashCursor, isTrashTool, listTrash } from "../lib/trash-listing.js"
import { MAX_JOB_LIST_FILTER_VALUES } from "../lib/job-list-filters.js"
import { NO_PROJECT } from "../lib/generation-sessions-schemas.js"
import { sanitizeJobForPublic, type JobRecord } from "./jobs.js"

const typeList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => [
    ...new Set((Array.isArray(value) ? value : [value]).flatMap((part) => part.split(",")).map((part) => part.trim()).filter(Boolean)),
  ])
  .pipe(z.array(z.string().max(100)).max(MAX_JOB_LIST_FILTER_VALUES))

const trashQuery = z.object({
  tool: z.string().refine(isTrashTool, "tool: lowercase letters, digits and dashes, at most 40").optional(),
  projectId: z.union([z.literal(NO_PROJECT), z.string().uuid()]).optional(),
  type: typeList.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(400).optional(),
})

const TrashSession = z.object({ id: z.string().uuid(), title: z.string().nullable(), projectId: z.string().uuid().nullable() })
const TrashEntry = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("removed"),
    removedAt: z.string(),
    session: TrashSession.describe("The session it was removed from. Restore: `POST /v1/sessions/{id}/items/{jobId}/restore`."),
    job: z.unknown().describe("The job, in the shape `GET /v1/jobs/{id}` returns."),
  }),
  z.object({
    kind: z.literal("deleted"),
    deletedAt: z.string(),
    purgeAt: z.string().describe("When it is deleted for good (30 days after `deletedAt`). Restore: `POST /v1/jobs/{id}/restore`."),
    job: z.unknown().describe("The job, in the shape `GET /v1/jobs/{id}` returns, with its `deleted_at`."),
  }),
])

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/trash",
  description:
    "Your Trash, newest first: the items you removed from sessions (`removed`, each with its session — kept until you restore it or delete it for good) and the jobs you deleted (`deleted`, kept 30 days, then deleted for good — a copy saved to the Library stays). A removed item whose job you also deleted is listed once, as the deleted job. " +
    "`projectId` scopes it to one project (its sessions' removed items, and deleted jobs a session of it held), or with `none` to the sessions with no project and General. `tool` keeps what a session of that tool holds or held, so a job no session ever held is left out; `type` filters on the job's `input_data.type`, like `GET /v1/jobs` — use it alone to include deleted jobs that were never in a session.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      tool: z.string().optional().describe("A creation tool, e.g. `create-image`."),
      projectId: z.string().optional().describe("A project's id, or `none`."),
      type: z.string().optional().describe(`One or more \`input_data.type\` values, comma-separated or repeated, up to ${MAX_JOB_LIST_FILTER_VALUES}.`),
      limit: z.string().optional().describe("Page size, 1–100 (default 50)."),
      cursor: z.string().optional().describe("The previous page's `next`."),
    }),
  },
  responses: {
    200: {
      description: "A page of the Trash",
      content: { "application/json": { schema: z.object({ data: z.array(TrashEntry), next: z.string().nullable() }) } },
    },
    400: { description: "An invalid tool, projectId, type, limit or cursor" },
    401: { description: "Unauthorized" },
  },
})

export async function trashRoutes(app: FastifyInstance) {
  app.get("/v1/trash", async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "jobs:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }
    const parsed = trashQuery.safeParse(req.query ?? {})
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    const { tool, projectId, type, limit = 50, cursor } = parsed.data
    const after = cursor ? decodeTrashCursor(cursor) : null
    if (cursor && !after) return reply.status(400).send({ error: { code: "validation_error", message: "Invalid cursor" } })

    const page = await listTrash<JobRecord>({
      userId: req.userId,
      workspaceId: req.workspaceId ?? null,
      tool,
      projectId: projectId?.toLowerCase(),
      types: type,
      limit,
      after,
    })
    if (page.error) return sendInternalError(reply, req, page.error, "Failed to list the Trash")
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"
    return {
      // The job as GET /v1/jobs/:id answers it, plus — only here — when it was deleted.
      data: page.data.map((entry) => ({
        ...entry,
        job: { ...sanitizeJobForPublic(entry.job, isAdmin), deleted_at: entry.job.deleted_at ?? null },
      })),
      next: page.next,
    }
  })
}
