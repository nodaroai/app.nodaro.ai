import type { FastifyReply, FastifyRequest } from "fastify"
import { sendInternalError } from "../../lib/http-errors.js"
import { ContentRestrictionError } from "../../lib/content-restrictions.js"
import { ComplaintCaseError } from "../lib/complaint-case-rows.js"
import { ComplaintNoticeError } from "../lib/complaint-notices.js"
import { RepeatInfringerError } from "../lib/repeat-infringer-error.js"

/**
 * The complaint handler's refusals as answers, shared by the complaint, the
 * counter-notice and the repeat-infringer routes (admin-complaints.ts,
 * admin-counter-notices.ts, admin-repeat-infringers.ts): unknown is 404,
 * changed meanwhile or already done is 409, a move the case does not allow is
 * 400; anything else is the server's.
 */
export function caseErrorStatus(e: ComplaintCaseError): number {
  if (e.code === "not_found") return 404
  if (e.code === "conflict") return 409
  return 400
}

/**
 * A record move's refusal as a status: unknown is 404; the record not in the
 * database yet is 503; a move the case does not allow (its complainant did
 * not prove their email, it names no account), a measure that departs from
 * the policy without saying why and a suspension without its days are 400,
 * as a case's own moves are; an account the block refuses (an administrator,
 * the platform's owner or operators, the payer, oneself) is 403; the rest is
 * the record's state (already done, in force, ended, the case moved on
 * meanwhile): 409.
 */
export function recordErrorStatus(e: RepeatInfringerError): number {
  switch (e.code) {
    case "not_found":
      return 404
    case "unavailable":
      return 503
    case "unverified":
    case "no_account":
    case "departure_required":
    case "days_required":
      return 400
    case "cannot_block_self":
    case "target_is_admin":
    case "target_protected":
    case "payer_account_protected":
      return 403
    default:
      return 409
  }
}

/**
 * Answers a refusal of the complaint modules with its status and code; anything
 * else is a server error, logged. A case's email that did not go out is the
 * mail service's refusal (502), a wait for it that ran out, when it may well
 * have gone (504), or this deployment's want of a mailer, a template or a
 * public address (503).
 */
export function caseFailure(req: FastifyRequest, reply: FastifyReply, e: unknown, fallback: string) {
  if (e instanceof ComplaintCaseError) return reply.status(caseErrorStatus(e)).send({ error: { code: e.code, message: e.message } })
  if (e instanceof ComplaintNoticeError) {
    const [status, code] = e.reason === "failed" ? [502, "notice_failed"] : e.reason === "unknown" ? [504, "notice_unconfirmed"] : [503, "notice_unavailable"]
    return reply.status(status).send({ error: { code, message: e.message } })
  }
  if (e instanceof RepeatInfringerError) return reply.status(recordErrorStatus(e)).send({ error: { code: e.code, message: e.message } })
  if (e instanceof ContentRestrictionError) {
    const status = e.code === "not_found" ? 404 : e.code === "unknown_complaint" ? 400 : 409
    return reply.status(status).send({ error: { code: e.code, message: e.message } })
  }
  return sendInternalError(reply, req, e, fallback)
}
