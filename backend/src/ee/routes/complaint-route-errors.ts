import type { FastifyReply, FastifyRequest } from "fastify"
import { sendInternalError } from "../../lib/http-errors.js"
import { ContentRestrictionError } from "../../lib/content-restrictions.js"
import { ComplaintCaseError } from "../lib/complaint-case-rows.js"

/**
 * The complaint handler's refusals as answers, shared by the complaint and the
 * counter-notice routes (admin-complaints.ts, admin-counter-notices.ts):
 * unknown is 404, changed meanwhile or already done is 409, a move the case
 * does not allow is 400; anything else is the server's.
 */
export function caseErrorStatus(e: ComplaintCaseError): number {
  if (e.code === "not_found") return 404
  if (e.code === "conflict") return 409
  return 400
}

/** Answers a refusal of the complaint modules with its status and code; anything else is a server error, logged. */
export function caseFailure(req: FastifyRequest, reply: FastifyReply, e: unknown, fallback: string) {
  if (e instanceof ComplaintCaseError) return reply.status(caseErrorStatus(e)).send({ error: { code: e.code, message: e.message } })
  if (e instanceof ContentRestrictionError) {
    const status = e.code === "not_found" ? 404 : e.code === "unknown_complaint" ? 400 : 409
    return reply.status(status).send({ error: { code: e.code, message: e.message } })
  }
  return sendInternalError(reply, req, e, fallback)
}
