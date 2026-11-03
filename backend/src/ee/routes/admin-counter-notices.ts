import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireAdminInApp } from "../middleware/require-admin-in-app.js"
import { audit } from "./admin-trends-lifecycle.js"
import { caseFailure } from "./complaint-route-errors.js"
import { formatZodError } from "../../lib/zod-error.js"
import { plainText } from "../../lib/plain-text.js"
import {
  declineCounterNotice,
  markCounterNoticeForwarded,
  recordCourtAction,
  recordCourtActionEnded,
  restoreFromCounterNotice,
} from "../lib/counter-notice-cases.js"

/**
 * Admin → a case's counter-notices (migration 587; ee/lib/counter-notice-cases.ts):
 * the steps an administrator takes, each once. An administrator signed in to
 * the app only, never cached, every step audited by the counter-notice's
 * reference. The counter-notices themselves are read with their case
 * (`GET /v1/admin/complaints/:id`).
 *
 *   POST /v1/admin/counter-notices/:id/forwarded          — it was sent to the complainant
 *   POST /v1/admin/counter-notices/:id/court-action       — { note? }: a court action was received
 *   POST /v1/admin/counter-notices/:id/court-action-ended — { note? }: that court action ended
 *   POST /v1/admin/counter-notices/:id/decline            — { reason }: not a valid counter-notice (the sender sees why)
 *   POST /v1/admin/counter-notices/:id/restore            — restore the content
 */

const MOVES = { rateLimit: { max: 60, timeWindow: "1 minute" } }

const idParams = z.object({ id: z.string().uuid() })

// Plain text only (lib/plain-text.ts): a note is kept on a legal record, and a decline's reason is shown to the sender.
const noteBody = z.strictObject({ note: plainText(2000).nullable().optional() })
const declineBody = z.strictObject({ reason: plainText(2000).refine((value) => value.length > 0, { message: "Say why" }) })

const invalidCounterNotice = { error: { code: "validation_error", message: "Invalid counter-notice" } }

/** Registers the administrator's counter-notice steps (see the module comment). */
export async function adminCounterNoticesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Cache-Control", "no-store")
  })

  app.post("/v1/admin/counter-notices/:id/forwarded", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send(invalidCounterNotice)
    try {
      const step = await markCounterNoticeForwarded(params.data.id, req.userId!)
      await audit(req, "counter_notice_forwarded", "counter_notice", step.id, { reference: step.reference, complaintId: step.complaintId })
      return { data: step }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to record the forwarding")
    }
  })

  app.post("/v1/admin/counter-notices/:id/court-action", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send(invalidCounterNotice)
    const parsed = noteBody.safeParse(req.body ?? {})
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const step = await recordCourtAction(params.data.id, parsed.data.note || null, req.userId!)
      await audit(req, "counter_notice_court_action", "counter_notice", step.id, { reference: step.reference, complaintId: step.complaintId })
      return { data: step }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to record the court action")
    }
  })

  app.post("/v1/admin/counter-notices/:id/court-action-ended", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send(invalidCounterNotice)
    const parsed = noteBody.safeParse(req.body ?? {})
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const step = await recordCourtActionEnded(params.data.id, parsed.data.note || null, req.userId!)
      await audit(req, "counter_notice_court_action_ended", "counter_notice", step.id, { reference: step.reference, complaintId: step.complaintId })
      return { data: step }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to record the end of the court action")
    }
  })

  app.post("/v1/admin/counter-notices/:id/decline", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send(invalidCounterNotice)
    const parsed = declineBody.safeParse(req.body ?? {})
    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    try {
      const step = await declineCounterNotice(params.data.id, parsed.data.reason, req.userId!)
      await audit(req, "counter_notice_decline", "counter_notice", step.id, { reference: step.reference, complaintId: step.complaintId })
      return { data: step }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to decline the counter-notice")
    }
  })

  app.post("/v1/admin/counter-notices/:id/restore", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return reply.status(400).send(invalidCounterNotice)
    try {
      const step = await restoreFromCounterNotice(params.data.id, req.userId!)
      await audit(req, "counter_notice_restore", "counter_notice", step.id, {
        reference: step.reference,
        complaintId: step.complaintId,
        restrictionId: step.restriction.id,
      })
      return { data: { id: step.id, reference: step.reference, restriction: step.restriction } }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to restore the content")
    }
  })
}
