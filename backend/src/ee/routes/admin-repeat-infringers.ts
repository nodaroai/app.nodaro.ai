import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { requireAdminInApp } from "../middleware/require-admin-in-app.js"
import { audit } from "./admin-trends-lifecycle.js"
import { caseFailure } from "./complaint-route-errors.js"
import { recordAdminAction } from "../lib/admin-actions.js"
import { BLOCK_REFUSAL_MESSAGE, SUSPEND_REFUSAL_MESSAGE } from "../lib/account-blocking.js"
import { formatZodError } from "../../lib/zod-error.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { plainText } from "../../lib/plain-text.js"
import {
  MAX_BLOCK_DAYS,
  MEASURE_KINDS,
  REPEAT_INFRINGER_POLICY_KEY,
  measureNeedsDays,
  measureTakesDays,
  repeatInfringerPolicySchema,
} from "../../lib/repeat-infringer-policy.js"
import { readRepeatInfringerPolicy, saveRepeatInfringerPolicy } from "../../lib/repeat-infringer-policy-store.js"
import { applyMeasure, liftMeasure, recordInfringement, withdrawInfringement, type AccessOutcome, type AppliedMeasure } from "../lib/repeat-infringers.js"

/**
 * Admin → an account's record under the repeat-infringer policy (migration
 * 588; ee/lib/repeat-infringers.ts): the moves on the case page, and the
 * policy itself. An administrator signed in to the app only, never cached,
 * every move audited (and a closure's block audited as an account block, as
 * the block button does). The record is read with its case
 * (`GET /v1/admin/complaints/:id`).
 *
 *   POST /v1/admin/complaints/:id/infringement — { userId, note? }: an infringement against the account the case names
 *   POST /v1/admin/infringements/:id/withdraw  — { reason }
 *   POST /v1/admin/complaints/:id/measure      — { userId, kind, days?, reason, note?, infringementId?, departureReason? }
 *                                                (days: an import block's, absent until lifted; a suspension's, required)
 *   POST /v1/admin/measures/:id/lift           — { reason }
 *   GET  /v1/admin/repeat-infringer-policy     — the policy (the default until one is saved)
 *   PUT  /v1/admin/repeat-infringer-policy     — { windowMonths, steps }
 */

const MOVES = { rateLimit: { max: 60, timeWindow: "1 minute" } }

/** The audit row's target for a change of the policy (a setting has no id of its own). */
export const REPEAT_INFRINGER_POLICY_AUDIT_TARGET = "00000000-0000-4000-8000-00000000c0a2"

const idParams = z.object({ id: z.string().uuid() })

// Plain text only (lib/plain-text.ts): a reason is shown to the account's owner, and every note is kept on a legal record.
const required = (max: number, say: string) => plainText(max).refine((value) => value.length > 0, { message: say })
const optional = (max: number) => plainText(max).nullable().optional()

// `userId`: the account the screen showed the case naming; a case that names another account since is refused (409 case_moved).
const infringementBody = z.strictObject({ userId: z.string().uuid(), note: optional(4000) })
const reasonBody = z.strictObject({ reason: required(2000, "Say why") })
const measureBody = z
  .strictObject({
    userId: z.string().uuid(),
    kind: z.enum(MEASURE_KINDS),
    days: z.number().int().min(1).max(MAX_BLOCK_DAYS).nullable().optional(),
    reason: required(2000, "Say what the account's owner is told"),
    note: optional(4000),
    infringementId: z.string().uuid().nullable().optional(),
    departureReason: optional(2000),
  })
  .refine((body) => measureTakesDays(body.kind) || body.days == null, { message: "Only an import block or a suspension has a number of days", path: ["days"] })
  .refine((body) => !measureNeedsDays(body.kind) || body.days != null, { message: "A suspension lasts a number of days", path: ["days"] })

const notFound = (reply: FastifyReply, what: string) => reply.status(404).send({ error: { code: "not_found", message: `No such ${what}` } })
const invalid = (reply: FastifyReply, error: z.ZodError) => reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })

const SIGN_IN_WARNING = "The account is blocked, but blocking its sign-in failed. Block it again from its page to retry."
const NOT_BLOCKED_WARNING = "The closure is recorded, but blocking the account failed: block it from the account's page."
const SUSPENDED_SIGN_IN_WARNING = "The account is suspended and its requests are refused, but its sign-in could not be refused: retry from the Access card on its page."
const SUSPENSION_UNCHECKED_WARNING =
  "The suspension is recorded and refuses the account's requests, but the account could not be checked again or its sign-in refused: retry from the Access card on its page."
const LIFT_SIGN_IN_WARNING = "The suspension is lifted and the account's requests are let through, but its sign-in could not be let back in: retry from the Access card on its page."

/** What became of the refusal of access, for the audit row. */
function accessState(access: AccessOutcome): string {
  if (access.placed) return "placed"
  return "refused" in access ? "refused" : "failed"
}

/**
 * The answer for a measure taken, a closure's or a suspension's refusal of
 * access included (ee/lib/repeat-infringers.ts `AccessOutcome`), audited as
 * each step happened: a closure's placed block as an account block too; a
 * refusal refused late, with the measure taken back, as a 403; a closure's
 * block that failed, with the closure standing, and a suspension whose
 * sign-in was not refused, as a warning.
 */
async function answerApplied(req: FastifyRequest, reply: FastifyReply, applied: AppliedMeasure) {
  const { measure: m, access } = applied
  const followsPolicy = m.policy_step !== null
  await audit(req, "measure_apply", "account_sanction", m.id, { complaintId: m.complaint_id, userId: m.user_id, kind: m.kind, endsAt: m.ends_at, followsPolicy, ...(access ? { access: accessState(access) } : {}) })
  const data = { id: m.id, kind: m.kind, endsAt: m.ends_at, followsPolicy }
  if (!access) return { data: { ...data, signInBlocked: null, warning: null } }
  const suspension = m.kind === "suspended"
  if (access.placed) {
    if (access.signInError) req.log.error({ err: access.signInError, userId: m.user_id }, `${suspension ? "suspension" : "closure"}: sign-in ban failed`)
    if (!suspension) await recordAdminAction(req, "account_block", m.user_id!, { signInBlocked: access.signInBlocked, closure: m.id }, "Closed under the repeat-infringer policy")
    const warning = access.signInError ? (suspension ? SUSPENDED_SIGN_IN_WARNING : SIGN_IN_WARNING) : null
    return { data: { ...data, signInBlocked: access.signInBlocked, warning } }
  }
  if ("refused" in access) {
    if (access.lifted) await audit(req, "measure_lift", "account_sanction", m.id, { complaintId: m.complaint_id, userId: m.user_id, kind: m.kind, takenBack: access.refused })
    const what = suspension ? "suspension" : "closure"
    const after = access.lifted ? `The ${what} was taken back.` : `The ${what} stands: lift it from the case.`
    const refusal = (suspension ? SUSPEND_REFUSAL_MESSAGE : BLOCK_REFUSAL_MESSAGE)[access.refused]
    return reply.status(403).send({ error: { code: access.refused, message: `${refusal} ${after}` } })
  }
  req.log.error({ err: access.failure, userId: m.user_id }, suspension ? "suspension: the account was not checked again, or its sign-in not refused" : "closure: the account block was not placed")
  return { data: { ...data, signInBlocked: null, warning: suspension ? SUSPENSION_UNCHECKED_WARNING : NOT_BLOCKED_WARNING } }
}

/** Registers the record's moves and the policy's routes (see the module comment). */
export async function adminRepeatInfringersRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Cache-Control", "no-store")
  })

  app.post("/v1/admin/complaints/:id/infringement", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return notFound(reply, "complaint")
    const body = infringementBody.safeParse(req.body ?? {})
    if (!body.success) return invalid(reply, body.error)
    try {
      const row = await recordInfringement(params.data.id, body.data.userId, body.data.note || null, req.userId!)
      await audit(req, "infringement_record", "account_infringement", row.id, { complaintId: row.complaint_id, userId: row.user_id })
      return { data: { id: row.id, complaintId: row.complaint_id, recordedAt: row.recorded_at } }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to record the infringement")
    }
  })

  app.post("/v1/admin/infringements/:id/withdraw", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return notFound(reply, "infringement")
    const body = reasonBody.safeParse(req.body ?? {})
    if (!body.success) return invalid(reply, body.error)
    try {
      const row = await withdrawInfringement(params.data.id, body.data.reason, req.userId!)
      await audit(req, "infringement_withdraw", "account_infringement", row.id, { complaintId: row.complaint_id, userId: row.user_id })
      return { data: { id: row.id, complaintId: row.complaint_id, withdrawnAt: row.withdrawn_at } }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to withdraw the infringement")
    }
  })

  app.post("/v1/admin/complaints/:id/measure", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return notFound(reply, "complaint")
    const body = measureBody.safeParse(req.body ?? {})
    if (!body.success) return invalid(reply, body.error)
    const b = body.data
    try {
      const input = {
        complaintId: params.data.id,
        userId: b.userId,
        kind: b.kind,
        days: b.days ?? null,
        reason: b.reason,
        note: b.note || null,
        infringementId: b.infringementId ?? null,
        departureReason: b.departureReason || null,
      }
      return await answerApplied(req, reply, await applyMeasure(input, req.userId!))
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to take the measure")
    }
  })

  app.post("/v1/admin/measures/:id/lift", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return notFound(reply, "measure")
    const body = reasonBody.safeParse(req.body ?? {})
    if (!body.success) return invalid(reply, body.error)
    try {
      const { measure: m, stillBlocked, signIn } = await liftMeasure(params.data.id, body.data.reason, req.userId!)
      await audit(req, "measure_lift", "account_sanction", m.id, { complaintId: m.complaint_id, userId: m.user_id, kind: m.kind })
      if (signIn?.signInError) req.log.error({ err: signIn.signInError, userId: m.user_id }, "suspension lifted: allowing sign-in failed")
      const warning = signIn?.signInError ? LIFT_SIGN_IN_WARNING : null
      return { data: { id: m.id, kind: m.kind, liftedAt: m.lifted_at, stillBlocked, signInBlocked: signIn?.signInBlocked ?? null, warning } }
    } catch (e) {
      return caseFailure(req, reply, e, "Failed to lift the measure")
    }
  })

  app.get("/v1/admin/repeat-infringer-policy", { preHandler: requireAdminInApp }, async (req, reply) => {
    try {
      return { data: await readRepeatInfringerPolicy() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to read the repeat-infringer policy")
    }
  })

  app.put("/v1/admin/repeat-infringer-policy", { preHandler: requireAdminInApp, config: MOVES }, async (req, reply) => {
    const parsed = repeatInfringerPolicySchema.safeParse(req.body)
    if (!parsed.success) return invalid(reply, parsed.error)
    try {
      const before = await readRepeatInfringerPolicy()
      await saveRepeatInfringerPolicy(parsed.data, req.userId!)
      await audit(req, "repeat_infringer_policy_update", "app_setting", REPEAT_INFRINGER_POLICY_AUDIT_TARGET, {
        key: REPEAT_INFRINGER_POLICY_KEY,
        before: before.saved ? before.policy : null,
        after: parsed.data,
      })
      return { data: await readRepeatInfringerPolicy() }
    } catch (e) {
      return sendInternalError(reply, req, e, "Failed to save the repeat-infringer policy")
    }
  })
}
