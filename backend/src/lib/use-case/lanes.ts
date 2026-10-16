/**
 * What every use-case route reads off the request before its own checks
 * (decided 2026-10-13): which lane it came in on, its idempotency key, the
 * parent run's payer on the internal lane, and a keyed retry answered with
 * its earlier run. One copy for the run route and the continue route.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { usecaseDescriptor, type UseCaseNodeType } from "@nodaro/render-rules"
import { isBillingContext } from "../billing-context.js"
import { MIN_IDEMPOTENCY_KEY_LENGTH, findJobByIdempotencyKey, type KeyedJob } from "../dedup-fingerprint.js"
import { USE_CASE_WRAPPER_PROVIDER } from "../wrapper-providers.js"

/** How deep use-case and component runs may nest inside one another. */
export const USE_CASE_MAX_DEPTH = 5

/** The answer while this database lacks the snapshot columns: nothing was written. */
export function usecaseUnavailable(type: UseCaseNodeType): { readonly code: "use_case_unavailable"; readonly message: string } {
  return { code: "use_case_unavailable", message: `${usecaseDescriptor(type).label} is not available on this server yet. Try again after the next update.` }
}

/**
 * The answer to a key that already belongs to anything but a run of this
 * route's type — another use-case node's run, or another kind of job
 * altogether (decided 2026-10-14): refused, nothing created.
 */
export const IDEMPOTENCY_KEY_REUSED = {
  code: "idempotency_key_reused",
  message: "This Idempotency-Key was already used for another kind of run. Send a new key.",
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
 * Is the job under a key this route's own run — a use-case wrapper of this
 * type? One naming no type is its route's (every wrapper names its own). Only
 * such a job answers a keyed request; anything else under the key refuses it.
 */
export function usecaseKeyedRunIsOwn(found: Pick<KeyedJob, "provider" | "jobType">, type: UseCaseNodeType): boolean {
  return found.provider === USE_CASE_WRAPPER_PROVIDER && (found.jobType === null || found.jobType === type)
}

/**
 * A keyed retry gets its run back at any age, ahead of the credit guard: the
 * guard's own lookup covers only its short window, after which its storage and
 * fee checks (and then the probe and the balance check) could refuse a run
 * already under way. The one place a keyed request is matched to its run;
 * the insert's unique key closes the race between two first requests (whose
 * loser judges the winner's row the same way, {@link usecaseKeyedRunIsOwn}).
 *
 * A key belongs to one job (unique per user): when it already names anything
 * but a run of this type — another use-case node's run, or another kind of job
 * (an image generation, say) — the request is refused 409
 * `idempotency_key_reused` before anything is checked or created (decided
 * 2026-10-14). Never answered with a job that is not this type's run.
 */
export function usecaseKeyedRetry(type: UseCaseNodeType) {
  return async function answerKeyedRetry(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    const key = idempotencyKeyOf(req)
    if (!key || !req.userId) return undefined
    const existing = await findJobByIdempotencyKey(req.userId, key)
    if (!existing) return undefined
    if (!usecaseKeyedRunIsOwn(existing, type)) return reply.status(409).send({ error: IDEMPOTENCY_KEY_REUSED })
    return reply.header("X-Dedup-Hit", "1").status(202).send({ jobId: existing.id, deduped: true })
  }
}
