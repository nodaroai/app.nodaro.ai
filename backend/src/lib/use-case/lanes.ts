/**
 * What every use-case route reads off the request before its own checks
 * (decided 2026-10-13): which lane it came in on, its idempotency key, the
 * parent run's payer on the internal lane, and a keyed retry answered with
 * its earlier run. One copy for the run route and the continue route.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { isBillingContext } from "../billing-context.js"
import { MIN_IDEMPOTENCY_KEY_LENGTH, findJobByIdempotencyKey } from "../dedup-fingerprint.js"
import { USE_CASE_WRAPPER_PROVIDER } from "../wrapper-providers.js"

/** How deep use-case and component runs may nest inside one another. */
export const USE_CASE_MAX_DEPTH = 5

/** The answer while this database lacks the snapshot columns: nothing was written. */
export const TIGHTEN_EPISODE_UNAVAILABLE = {
  code: "use_case_unavailable",
  message: "Tighten Episode is not available on this server yet. Try again after the next update.",
} as const

/** The backend engine calling on behalf of a run (a use-case node inside a workflow). */
export const isInternalLane = (req: FastifyRequest): boolean => req.authKind === "internal"

/** The request's idempotency key, when it is long enough to be one. */
export function idempotencyKeyOf(req: FastifyRequest): string | null {
  const raw = req.headers["idempotency-key"]
  const key = typeof raw === "string" ? raw.trim() : ""
  return key.length >= MIN_IDEMPOTENCY_KEY_LENGTH ? key : null
}

/**
 * The parent run's payer, on the internal lane: the backend engine forwards
 * the payer it resolved for the whole run, and the fee check, the fee hold and
 * the wrapper's payer columns all read `req.billingContext` — so it is adopted
 * there, before the credit guard (the pipelines precedent). Shape-guarded and
 * only for the request's own user; any other caller's field is ignored.
 */
export async function adoptForwardedPayer(req: FastifyRequest): Promise<void> {
  if (!isInternalLane(req) || !req.userId) return
  const forwarded = (req.body as { billingContext?: unknown } | undefined)?.billingContext
  if (isBillingContext(forwarded) && forwarded.userId === req.userId) req.billingContext = forwarded
}

/**
 * A keyed retry gets its run back at any age, ahead of the credit guard: the
 * guard's own lookup covers only its short window, after which its storage and
 * fee checks (and then the probe and the balance check) could refuse a run
 * already under way. The one place a keyed request is matched to its run;
 * the insert's unique key closes the race between two first requests.
 *
 * Only a use-case wrapper answers: a key the caller reused on another kind of
 * job never comes back as a Tighten Episode run — the request goes on to the
 * route's own checks.
 */
export async function answerKeyedRetry(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  const key = idempotencyKeyOf(req)
  if (!key || !req.userId) return undefined
  const existing = await findJobByIdempotencyKey(req.userId, key, { provider: USE_CASE_WRAPPER_PROVIDER })
  if (!existing) return undefined
  return reply.header("X-Dedup-Hit", "1").status(202).send({ jobId: existing.id, deduped: true })
}
