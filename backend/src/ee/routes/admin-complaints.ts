import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { requireAdminInApp } from "../middleware/require-admin-in-app.js"
import { audit } from "./admin-trends-lifecycle.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { COMPLAINT_STATUSES } from "../../lib/rights-complaints.js"
import { ContentRestrictionError } from "../../lib/content-restrictions.js"
import {
  ComplaintCaseError,
  addComplaintNote,
  countOpenComplaints,
  listComplaintCases,
  moveComplaintStatus,
  nameComplaintUser,
  readComplaintCase,
  rematchComplaint,
  restrictFromComplaint,
  type ComplaintSummary,
  type ListComplaintsInput,
  type StatusMove,
} from "../lib/complaint-cases.js"

/**
 * Admin → content complaints (migration 580; ee/lib/complaint-cases.ts):
 * the queue the public form fills, one case with everything the handler
 * needs, and the moves. An administrator signed in to the app only (an API or
 * app token of theirs is refused: the answers carry a complainant's details
 * decrypted), never cached. Every read that shows a complainant's details is
 * audited by the cases' references, and every move by the case's id and
 * reference — never the complainant's details, never what was searched for.
 *
 *   GET  /v1/admin/complaints?status=&kind=&page=&limit=  — the queue
 *   POST /v1/admin/complaints/search           — { q, status?, kind?, page?, limit? }: q is a
 *        reference or an email, and goes in the body: what is typed never goes in an address
 *   GET  /v1/admin/complaints/count            — the open, verified cases
 *   GET  /v1/admin/complaints/:id
 *   POST /v1/admin/complaints/:id/status       — { seen, status, decision?, note? }
 *   POST /v1/admin/complaints/:id/notes        — { text }
 *   POST /v1/admin/complaints/:id/user         — { userId | null, seen }
 *   POST /v1/admin/complaints/:id/rematch      — add what the case's links match now
 *   POST /v1/admin/complaints/:id/restrict     — { assetId | jobId, reason }: a file the case matched
 *
 * `seen` is the case's `updatedAt` as the screen showed it: a change is made
 * from it or refused (409), so one handler never overwrites another.
 */

const READS = { rateLimit: { max: 120, timeWindow: "1 minute" } }
const SEARCHES = { rateLimit: { max: 30, timeWindow: "1 minute" } }
const MOVES = { rateLimit: { max: 60, timeWindow: "1 minute" } }

/** A reference's longest form, with room: `CR-2026-000001`. */
const REFERENCE_MAX = 64

const statusEnum = z.enum(COMPLAINT_STATUSES as unknown as [string, ...string[]])
const filters = {
  status: z.enum([...COMPLAINT_STATUSES, "open"] as [string, ...string[]]).optional(),
  kind: z.enum(["copyright", "other"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}
const listQuery = z.strictObject(filters)
const searchBody = z
  .strictObject({ ...filters, q: z.string().trim().min(1).max(320) })
  .refine((b) => b.q.includes("@") || b.q.length <= REFERENCE_MAX, { message: `A reference is at most ${REFERENCE_MAX} characters`, path: ["q"] })
const idParams = z.object({ id: z.string().uuid() })
const seen = z.string().min(1).max(64)
const statusBody = z.strictObject({
  seen,
  status: statusEnum,
  decision: z.string().max(8000).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
})
const noteBody = z.strictObject({ text: z.string().trim().min(1).max(4000) })
const userBody = z.strictObject({ userId: z.string().uuid().nullable(), seen })
const restrictBody = z
  .strictObject({
    assetId: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
    reason: z.string().trim().min(1).max(4000),
  })
  .refine((b) => (b.assetId ? 1 : 0) + (b.jobId ? 1 : 0) === 1, { message: "Name one of assetId or jobId" })

function caseErrorStatus(e: ComplaintCaseError): number {
  if (e.code === "not_found") return 404
  if (e.code === "conflict") return 409
  return 400
}

function invalid(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

function noSuchCase(reply: FastifyReply) {
  return reply.status(400).send({ error: { code: "validation_error", message: "Invalid complaint" } })
}

/** The module's refusals as answers; anything else is the server's. */
function caseFailure(req: FastifyRequest, reply: FastifyReply, e: unknown, fallback: string) {
  if (e instanceof ComplaintCaseError) return reply.status(caseErrorStatus(e)).send({ error: { code: e.code, message: e.message } })
  if (e instanceof ContentRestrictionError) {
    const status = e.code === "not_found" ? 404 : e.code === "unknown_complaint" ? 400 : 409
    return reply.status(status).send({ error: { code: e.code, message: e.message } })
  }
  return sendInternalError(reply, req, e, fallback)
}

/**
 * `admin_actions.target_id` is a NOT NULL uuid, and a page of the queue has
 * no row of its own: every read of the queue is filed under this fixed id.
 */
export const COMPLAINT_QUEUE_AUDIT_TARGET = "00000000-0000-4000-8000-00000000c0a1"

/** Which cases' complainants a page of the queue showed, by reference. */
function auditShown(req: FastifyRequest, action: string, cases: readonly ComplaintSummary[], detail: Record<string, unknown>) {
  return audit(req, action, "complaint_queue", COMPLAINT_QUEUE_AUDIT_TARGET, { ...detail, references: cases.map((c) => c.reference) })
}

export async function adminComplaintsRoutes(app: FastifyInstance) {
  // A complainant's details decrypted, a case's log: no cache keeps any of it.
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Cache-Control", "no-store")
  })

  app.get("/v1/admin/complaints", { preHandler: requireAdminInApp, config: READS }, async (req, reply) => {
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return invalid(reply, parsed.error)
    try {
      const { cases, total, page, limit } = await listComplaintCases(parsed.data as ListComplaintsInput)
      await auditShown(req, "complaint_queue", cases, { status: parsed.data.status ?? null, kind: parsed.data.kind ?? null, page })
      return { data: cases, total, page, limit }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to read the complaints")
    }
  })

  app.post("/v1/admin/complaints/search", { preHandler: requireAdminInApp, config: SEARCHES }, async (req, reply) => {
    const parsed = searchBody.safeParse(req.body)
    if (!parsed.success) return invalid(reply, parsed.error)
    const { q, ...rest } = parsed.data
    const byEmail = q.includes("@")
    try {
      const input = { ...(rest as ListComplaintsInput), ...(byEmail ? { email: q } : { reference: q }) }
      const { cases, total, page, limit } = await listComplaintCases(input)
      await auditShown(req, "complaint_search", cases, { by: byEmail ? "email" : "reference", status: rest.status ?? null, kind: rest.kind ?? null, page })
      return { data: cases, total, page, limit }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to search the complaints")
    }
  })

  app.get("/v1/admin/complaints/count", { preHandler: requireAdminInApp, config: READS }, async (req, reply) => {
    try {
      return { count: await countOpenComplaints() }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to count the complaints")
    }
  })

  app.get("/v1/admin/complaints/:id", { preHandler: requireAdminInApp, config: READS }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return noSuchCase(reply)
    try {
      const shown = await readComplaintCase(params.data.id)
      await audit(req, "complaint_view", "complaint", shown.id, { reference: shown.reference })
      return { data: shown }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to read the complaint")
    }
  })

  app.post("/v1/admin/complaints/:id/status", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return noSuchCase(reply)
    const parsed = statusBody.safeParse(req.body)
    if (!parsed.success) return invalid(reply, parsed.error)
    try {
      const moved = await moveComplaintStatus(params.data.id, parsed.data as StatusMove, req.userId!)
      await audit(req, "complaint_status", "complaint", moved.id, {
        reference: moved.reference,
        status: moved.status,
        decided: parsed.data.decision !== undefined,
      })
      return { data: moved }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to move the complaint")
    }
  })

  app.post("/v1/admin/complaints/:id/notes", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return noSuchCase(reply)
    const parsed = noteBody.safeParse(req.body)
    if (!parsed.success) return invalid(reply, parsed.error)
    try {
      await addComplaintNote(params.data.id, parsed.data.text, req.userId!)
      await audit(req, "complaint_note", "complaint", params.data.id, { length: parsed.data.text.length })
      return reply.status(201).send({ ok: true })
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to note the complaint")
    }
  })

  app.post("/v1/admin/complaints/:id/user", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return noSuchCase(reply)
    const parsed = userBody.safeParse(req.body)
    if (!parsed.success) return invalid(reply, parsed.error)
    try {
      const moved = await nameComplaintUser(params.data.id, parsed.data.userId, parsed.data.seen, req.userId!)
      await audit(req, "complaint_user", "complaint", moved.id, { reference: moved.reference, userId: parsed.data.userId })
      return { data: moved }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to name the account")
    }
  })

  app.post("/v1/admin/complaints/:id/rematch", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return noSuchCase(reply)
    try {
      const moved = await rematchComplaint(params.data.id, req.userId!)
      await audit(req, "complaint_rematch", "complaint", moved.id, {
        reference: moved.reference,
        assets: moved.matchedAssetIds.length,
        confirmations: moved.matchedConfirmationIds.length,
      })
      return { data: moved }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to match the complaint again")
    }
  })

  app.post("/v1/admin/complaints/:id/restrict", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return noSuchCase(reply)
    const parsed = restrictBody.safeParse(req.body)
    if (!parsed.success) return invalid(reply, parsed.error)
    try {
      const { restriction, case: moved } = await restrictFromComplaint(params.data.id, parsed.data, req.userId!)
      await audit(req, "content_restrict", parsed.data.assetId ? "asset" : "job", (parsed.data.assetId ?? parsed.data.jobId)!, {
        restrictionId: restriction.id,
        complaintId: moved.id,
        reason: parsed.data.reason,
      })
      return reply.status(201).send({ data: { restriction, case: moved } })
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to restrict the content")
    }
  })
}
