/**
 * A keyed batch route repeated — answered from the jobs it made, BEFORE the
 * credit guard. The image batch's replay (`image-batch-replay.ts`) for the
 * routes whose batch is N jobs of one request: generate-character /
 * -creature / -location / -object `count`, video-sfx `versions`.
 *
 * Such a batch keys its jobs `K:0..n-1` (`runJobBatch`), but the guard's own
 * replay lookup asks for the bare Idempotency-Key, so without this a repeat
 * of a batch that was already charged ran the whole balance check again: a
 * retry after a lost answer, with the balance the batch itself just spent,
 * would answer 402 for jobs that exist and are paid for. This preHandler
 * (first on the route) looks the batch's keys up:
 *
 *  - every job exists and is running or done → the route's own answer for
 *    them, with `deduped: true` and `X-Dedup-Hit: 1`; nothing is checked,
 *    charged or queued;
 *  - a job under those keys that another route made (a different job type) →
 *    422 `idempotency_key_reused`;
 *  - otherwise → how many jobs the request will still pay for (missing ones,
 *    and ones left `pending` with no credits held) is kept against the
 *    request, and the route's price reads it (`keyedBatchJobsToPrice`) — none
 *    at all when the only jobs left are paid for and `pending`, which the
 *    handler queues again in case they never reached the queue.
 *
 * A failed read changes nothing: the guard prices the whole batch, as before.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { findJobsByIdempotencyKeys, MIN_IDEMPOTENCY_KEY_LENGTH } from "./dedup-fingerprint.js"
import { jobCreditHolds } from "./credits-job-lifecycle.js"
import { batchJobKey, recordedJobType, replyKeyReused, type BatchJob } from "./job-batch.js"

const jobsToPrice = new WeakMap<FastifyRequest, number>()

/**
 * How many of this request's batch jobs it still pays for, when some of them
 * already exist — undefined when none does (or it could not be read): then
 * the whole batch is priced.
 */
export function keyedBatchJobsToPrice(req: FastifyRequest): number | undefined {
  return jobsToPrice.get(req)
}

/** The request's Idempotency-Key, read the way the credit guard reads it. */
function requestIdempotencyKey(req: FastifyRequest): string | undefined {
  const raw = req.headers["idempotency-key"]
  const key = typeof raw === "string" ? raw.trim() : ""
  return key.length >= MIN_IDEMPOTENCY_KEY_LENGTH ? key : undefined
}

/** What a keyed batch route tells its replay. */
export interface KeyedBatchSpec {
  /**
   * How many jobs the raw body asks for (the guard's pre-check reads it the
   * same way, before validation). Below 2 the request is a single job, which
   * keeps the bare key and the guard's own replay.
   */
  readonly size: (body: unknown) => number
  /**
   * The job type the route records on its jobs (`input_data.type`). A job found
   * under the batch's keys that records another type (or none) was made by
   * another route: the key was reused for something else, answered 422
   * `idempotency_key_reused`, never replayed.
   */
  readonly jobType: string
  /** The route's answer for the batch's jobs, in order (`deduped` is added). */
  readonly answer: (jobIds: readonly string[]) => Record<string, unknown>
}

/** The preHandler that answers a keyed batch's repeat (see the file's header). */
export function keyedBatchReplay(spec: KeyedBatchSpec) {
  return async function replayKeyedBatch(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
    const userId = req.userId
    const key = requestIdempotencyKey(req)
    if (!userId || !key) return
    const size = spec.size(req.body)
    if (size < 2) return

    const keys = Array.from({ length: size }, (_, i) => batchJobKey(key, i)!)
    const found = await findJobsByIdempotencyKeys(userId, keys)
    if (!found || found.size === 0) return
    if ([...found.values()].some((row) => recordedJobType(row.input_data) !== spec.jobType)) {
      return replyKeyReused(reply)
    }

    const waiting = [...found.values()].filter((row) => row.status === "pending").map((row) => row.id)
    const holds = await jobCreditHolds(waiting)
    if (!holds) return

    let toPrice = 0
    let waitingPaid = false
    for (const k of keys) {
      const row = found.get(k)
      if (!row) toPrice++
      else if (row.status === "pending") {
        if (holds.has(row.id)) waitingPaid = true
        else toPrice++
      }
    }
    // A job paid for but still `pending` may never have reached the queue (the
    // request that made it stopped after reserving): the handler queues it
    // again (one queue entry per job, so one still waiting is not queued
    // twice), and nothing is left to price for it.
    if (toPrice > 0 || waitingPaid) {
      jobsToPrice.set(req, toPrice)
      return
    }

    // Every job exists and is running or done: the replay.
    reply.header("X-Dedup-Hit", "1")
    return reply.code(200).send({ ...spec.answer(keys.map((k) => found.get(k)!.id)), deduped: true })
  }
}

/**
 * A keyed batch's answer once `runJobBatch` made it: the route's own answer,
 * with `deduped: true` and `X-Dedup-Hit: 1` when every job already existed and
 * this request charged nothing (none made, none taken over) — the contract of
 * a single job's replay.
 */
export function keyedBatchAnswer(
  reply: FastifyReply,
  jobs: readonly BatchJob[],
  answer: (jobIds: readonly string[]) => Record<string, unknown>,
): Record<string, unknown> {
  const ids = jobs.map((job) => job.jobId)
  const deduped = jobs.every((job) => !job.created && !job.takenOver)
  if (deduped) reply.header("X-Dedup-Hit", "1")
  return { ...answer(ids), ...(deduped ? { deduped: true } : {}) }
}
