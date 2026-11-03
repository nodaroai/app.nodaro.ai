import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireAdminInApp } from "../middleware/require-admin-in-app.js"
import { audit } from "./admin-trends-lifecycle.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { ContentRestrictionError, finishRestrictionBytes, liftRestriction, listRestrictions, restrictAsset, restrictJob } from "../../lib/content-restrictions.js"
import { ComplaintCaseError, ensureCaseTarget } from "../lib/complaint-cases.js"

/**
 * Admin → content restrictions (migration 581; lib/content-restrictions.ts):
 * a stored file or a job's output taken out of reach after a complaint, and
 * lifted or not. An administrator signed in to the app only (an API or app
 * token of theirs is refused: these act on other accounts' content), never
 * cached; every restriction and lift is audited, and one made from a case is
 * written on that case's log as well. The Complaints screen calls these for
 * the lift and the bytes; a restriction from a case goes through the case's
 * own route (admin-complaints.ts), which moves the case on too.
 *
 *   GET  /v1/admin/content-restrictions?active=1  — the records, newest first.
 *   POST /v1/admin/content-restrictions           — { assetId | jobId, reason, complaintId? }: with a
 *        case, only a file it matched (or the job that made one)
 *   POST /v1/admin/content-restrictions/:id/lift  — { reason? }
 *   POST /v1/admin/content-restrictions/:id/bytes — finish the bytes' move (or move back) the record says is left
 */

const READS = { rateLimit: { max: 120, timeWindow: "1 minute" } }
const MOVES = { rateLimit: { max: 60, timeWindow: "1 minute" } }

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
  // Records of other accounts' content, and the bytes' state: no cache keeps any of it.
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Cache-Control", "no-store")
  })

  app.get("/v1/admin/content-restrictions", { preHandler: requireAdminInApp, config: READS }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      return { data: await listRestrictions({ active: parsed.data.active === "1" }) }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the restrictions")
    }
  })

  app.post("/v1/admin/content-restrictions", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const parsed = restrictBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    const { assetId, jobId, reason, complaintId } = parsed.data
    try {
      // In a case's name only what the case matched: a wrong id never restricts unrelated content under it.
      if (complaintId) await ensureCaseTarget(complaintId, { assetId, jobId })
      const input = { reason, complaintId: complaintId ?? null, adminUserId: req.userId ?? null }
      const restriction = assetId ? await restrictAsset(assetId, input) : await restrictJob(jobId!, input)
      await audit(req, "content_restrict", assetId ? "asset" : "job", (assetId ?? jobId)!, {
        restrictionId: restriction.id,
        complaintId: complaintId ?? null,
        reason,
      })
      return reply.status(201).send({ data: restriction })
    } catch (e) {
      if (e instanceof ComplaintCaseError) {
        const unknown = e.code === "not_found"
        return reply.status(400).send({ error: { code: unknown ? "unknown_complaint" : e.code, message: unknown ? "No such complaint" : e.message } })
      }
      if (e instanceof ContentRestrictionError) {
        const status = e.code === "not_found" ? 404 : e.code === "unknown_complaint" ? 400 : 409
        return reply.status(status).send({ error: { code: e.code, message: e.message } })
      }
      return sendInternalError(reply, req, e, "Failed to restrict the content")
    }
  })

  app.post("/v1/admin/content-restrictions/:id/lift", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
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

  app.post("/v1/admin/content-restrictions/:id/bytes", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = liftParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send({ error: { code: "validation_error", message: "Invalid restriction" } })
    try {
      const restriction = await finishRestrictionBytes(params.data.id)
      await audit(req, "content_restriction_bytes", restriction.assetId ? "asset" : "job", restriction.assetId ?? restriction.jobId ?? restriction.id, {
        restrictionId: restriction.id,
        phase: restriction.liftedAt ? "lift" : "restrict",
      })
      return { data: restriction }
    } catch (e) {
      if (e instanceof ContentRestrictionError) {
        return reply.status(e.code === "not_found" ? 404 : 409).send({ error: { code: e.code, message: e.message } })
      }
      return sendInternalError(reply, req, e, "Failed to finish the restriction's bytes")
    }
  })
}
