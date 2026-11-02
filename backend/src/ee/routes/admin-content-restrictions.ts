import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireAdmin } from "../middleware/require-admin.js"
import { audit } from "./admin-trends-lifecycle.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { ContentRestrictionError, liftRestriction, listRestrictions, restrictAsset, restrictJob } from "../../lib/content-restrictions.js"

/**
 * Admin → content restrictions (migration 581; lib/content-restrictions.ts):
 * a stored file or a job's output taken out of reach after a complaint, and
 * lifted or not. Admin session only; every restriction and lift is audited.
 * The handler's screen (the complaints queue) is a later change; these routes
 * are what it calls.
 *
 *   GET  /v1/admin/content-restrictions?active=1  — the records, newest first.
 *   POST /v1/admin/content-restrictions           — { assetId | jobId, reason, complaintId? }
 *   POST /v1/admin/content-restrictions/:id/lift  — { reason? }
 */

const restrictBody = z
  .strictObject({
    assetId: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
    reason: z.string().trim().min(1).max(4000),
    complaintId: z.string().uuid().nullable().optional(),
  })
  .refine((b) => (b.assetId ? 1 : 0) + (b.jobId ? 1 : 0) === 1, { message: "Name one of assetId or jobId" })

const liftBody = z.strictObject({ reason: z.string().trim().max(4000).nullable().optional() })
const liftParams = z.object({ id: z.string().uuid() })
const listQuery = z.object({ active: z.enum(["1", "0"]).optional() })

export async function adminContentRestrictionsRoutes(app: FastifyInstance) {
  app.get("/v1/admin/content-restrictions", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      return { data: await listRestrictions({ active: parsed.data.active === "1" }) }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the restrictions")
    }
  })

  app.post("/v1/admin/content-restrictions", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = restrictBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    const { assetId, jobId, reason, complaintId } = parsed.data
    try {
      const input = { reason, complaintId: complaintId ?? null, adminUserId: req.userId ?? null }
      const restriction = assetId ? await restrictAsset(assetId, input) : await restrictJob(jobId!, input)
      await audit(req, "content_restrict", assetId ? "asset" : "job", (assetId ?? jobId)!, {
        restrictionId: restriction.id,
        complaintId: complaintId ?? null,
        reason,
      })
      return reply.status(201).send({ data: restriction })
    } catch (e) {
      if (e instanceof ContentRestrictionError) {
        const status = e.code === "not_found" ? 404 : e.code === "unknown_complaint" ? 400 : 409
        return reply.status(status).send({ error: { code: e.code, message: e.message } })
      }
      return sendInternalError(reply, req, e, "Failed to restrict the content")
    }
  })

  app.post("/v1/admin/content-restrictions/:id/lift", { preHandler: requireAdmin }, async (req, reply) => {
    const params = liftParams.safeParse(req.params)
    const parsed = liftBody.safeParse(req.body ?? {})
    if (!params.success || !parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid lift" } })
    }
    try {
      const restriction = await liftRestriction(params.data.id, { reason: parsed.data.reason ?? null, adminUserId: req.userId ?? null })
      await audit(req, "content_restriction_lift", restriction.assetId ? "asset" : "job", restriction.assetId ?? restriction.jobId ?? restriction.id, {
        restrictionId: restriction.id,
        reason: parsed.data.reason ?? null,
      })
      return { data: restriction }
    } catch (e) {
      if (e instanceof ContentRestrictionError) {
        return reply.status(e.code === "not_found" ? 404 : 409).send({ error: { code: e.code, message: e.message } })
      }
      return sendInternalError(reply, req, e, "Failed to lift the restriction")
    }
  })
}
