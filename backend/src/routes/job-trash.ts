/**
 * A job's way into and out of the Trash (migration 561, lib/job-trash.ts):
 *
 *   DELETE /v1/jobs/:id                 to the Trash — hidden from every read,
 *                                       restorable for 30 days, then purged
 *   DELETE /v1/jobs/:id?forever=true    for good, now — only a job already in
 *                                       the Trash (409 `not_in_trash` otherwise)
 *   POST   /v1/jobs/:id/restore         back from the Trash, into its sessions
 *
 * The job's owner (or an admin) only; a miss is 404. An OAuth app needs
 * `assets:write`. Nothing is refunded: the credits were spent on work done.
 * Registered by `jobRoutes` (routes/jobs.ts).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { sendInternalError } from "../lib/http-errors.js"
import { formatZodError } from "../lib/zod-error.js"
import { deleteTrashedJobForGood, restoreJob, trashJob, type JobTrashOutcome } from "../lib/job-trash.js"

const params = z.object({ id: z.string().min(1) })
const deleteQuery = z.object({ forever: z.enum(["true", "false"]).optional() })
const WRITE_LIMIT = { rateLimit: { max: 120, timeWindow: "1 minute" } }

openApiRegistry.registerPath({
  method: "delete",
  path: "/v1/jobs/{id}",
  description:
    "Delete one of your jobs: it goes to the Trash (`GET /v1/trash`). It is left out of every read from then on, stays restorable for 30 days (`POST /v1/jobs/{id}/restore`, back into the sessions it was in), and is then deleted for good, as a delete always was (the job and its private media; a copy saved to the Library stays). With `forever=true` a job already in the Trash is deleted for good now; a live job answers 409 `not_in_trash`. A running job keeps running: cancel it first to stop it. Nothing is refunded. OAuth apps need `assets:write`.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }), query: deleteQuery },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: z.object({ success: z.literal(true) }) } } },
    401: { description: "Unauthorized" },
    404: { description: "Job not found" },
    409: { description: "`forever=true` on a job that is not in the Trash (`not_in_trash`)" },
  },
})

openApiRegistry.registerPath({
  method: "post",
  path: "/v1/jobs/{id}/restore",
  description:
    "Bring one of your jobs back from the Trash. It reappears in every read, and in every session it was in when it was deleted. A job that is not in the Trash answers success too. OAuth apps need `assets:write`.",
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Restored", content: { "application/json": { schema: z.object({ success: z.literal(true) }) } } },
    401: { description: "Unauthorized" },
    404: { description: "Job not found" },
  },
})

function answer(req: FastifyRequest, reply: FastifyReply, outcome: JobTrashOutcome, failure: string) {
  switch (outcome.kind) {
    case "done":
      return { success: true as const }
    case "not_found":
      return reply.status(404).send({ error: { code: "not_found", message: "Job not found" } })
    case "not_in_trash":
      return reply.status(409).send({ error: { code: "not_in_trash", message: "Delete the job (to the Trash) first." } })
    case "error":
      return sendInternalError(reply, req, outcome.error, failure)
  }
}

export function registerJobTrashRoutes(app: FastifyInstance): void {
  app.delete("/v1/jobs/:id", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const p = params.safeParse(req.params)
    const q = deleteQuery.safeParse(req.query ?? {})
    if (!p.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(p.error) } })
    if (!q.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(q.error) } })
    const actor = { jobId: p.data.id, userId: req.userId, isAdmin: req.userRole === "admin" || req.userRole === "super_admin" }
    if (q.data.forever === "true") {
      return answer(req, reply, await deleteTrashedJobForGood({ ...actor, logger: req.log }), "Failed to delete job")
    }
    return answer(req, reply, await trashJob(actor), "Failed to delete job")
  })

  app.post("/v1/jobs/:id/restore", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const p = params.safeParse(req.params)
    if (!p.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(p.error) } })
    const actor = { jobId: p.data.id, userId: req.userId, isAdmin: req.userRole === "admin" || req.userRole === "super_admin" }
    return answer(req, reply, await restoreJob(actor), "Failed to restore job")
  })
}
