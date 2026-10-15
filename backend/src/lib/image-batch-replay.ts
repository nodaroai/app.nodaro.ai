/**
 * A keyed `count` / `models` request repeated: answered from the jobs it made,
 * BEFORE the credit guard.
 *
 * The guard's own replay lookup asks for the bare Idempotency-Key, but a
 * batch keys its jobs `K:0..n-1` — so without this a repeat of a batch that
 * was already charged ran the whole balance check again and could answer 402
 * for jobs that exist and are paid for. This preHandler (first on the route)
 * looks the batch's keys up:
 *
 *  - every job exists and is running or done → the batch's answer, with
 *    `deduped: true` and `X-Dedup-Hit: 1`, and nothing is checked or charged;
 *  - otherwise → the positions the request will still pay for (missing jobs,
 *    and jobs left `pending` with no credits held) are kept against the
 *    request, and the guard prices only those (`batchPositionsToPrice`) —
 *    none at all when the only jobs left are paid for and `pending`, which the
 *    handler queues again in case they never reached the queue.
 *
 * A failed read changes nothing: the guard prices the whole batch, as before.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { defaultImageModel } from "@nodaro/shared/model-catalog"
import { findJobsByIdempotencyKeys, MIN_IDEMPOTENCY_KEY_LENGTH, type KeyedJobRow } from "./dedup-fingerprint.js"
import { jobCreditHolds } from "./credits-job-lifecycle.js"
import { batchJobKey } from "./job-batch.js"
import { imageBatchId, imageBatchResponse, rawImageBatchOf } from "./image-batch.js"

const positionsToPrice = new WeakMap<FastifyRequest, ReadonlySet<number>>()

/**
 * The batch positions this request still pays for, when some of its jobs
 * already exist — undefined when none does (or it could not be read): then
 * every position is priced.
 */
export function batchPositionsToPrice(req: FastifyRequest): ReadonlySet<number> | undefined {
  return positionsToPrice.get(req)
}

/** The request's Idempotency-Key, read the way the credit guard reads it. */
function requestIdempotencyKey(req: FastifyRequest): string | undefined {
  const raw = req.headers["idempotency-key"]
  const key = typeof raw === "string" ? raw.trim() : ""
  return key.length >= MIN_IDEMPOTENCY_KEY_LENGTH ? key : undefined
}

/** The model a one-model batch ran on: as its jobs recorded it, else as the handler resolves it. */
function oneModelOf(body: Record<string, unknown>, first: KeyedJobRow | undefined): string {
  const recorded = first?.input_data?.provider
  if (typeof recorded === "string" && recorded) return recorded
  if (typeof body.provider === "string" && body.provider) return body.provider
  return defaultImageModel("general", typeof body.aspectRatio === "string" ? body.aspectRatio : undefined)
}

export async function replayImageBatch(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const userId = req.userId
  const key = requestIdempotencyKey(req)
  const batch = rawImageBatchOf(req.body)
  if (!userId || !key || !batch) return

  const size = (batch.models?.length ?? 1) * batch.count
  const keys = Array.from({ length: size }, (_, i) => batchJobKey(key, i)!)
  const found = await findJobsByIdempotencyKeys(userId, keys)
  if (!found || found.size === 0) return

  const waiting = [...found.values()].filter((row) => row.status === "pending").map((row) => row.id)
  const holds = await jobCreditHolds(waiting)
  if (!holds) return

  const toPrice = new Set<number>()
  keys.forEach((k, i) => {
    const row = found.get(k)
    if (!row || (row.status === "pending" && !holds.has(row.id))) toPrice.add(i)
  })
  // A job paid for but still `pending` may never have reached the queue (the
  // request that made it stopped after reserving): the handler queues it again
  // (one queue entry per job, so one still waiting is not queued twice). The
  // guard is then told the batch has nothing left to pay for (an empty list).
  const waitingPaid = rows(found, keys).some((row) => row.status === "pending")
  if (toPrice.size > 0 || waitingPaid) {
    positionsToPrice.set(req, toPrice)
    return
  }

  // Every job exists and is running or done: the replay.
  const body = req.body as Record<string, unknown>
  const jobs = rows(found, keys)
  const models = batch.models ?? [oneModelOf(body, jobs[0])]
  reply.header("X-Dedup-Hit", "1")
  return reply.code(200).send(imageBatchResponse({
    batchId: imageBatchId(userId, key),
    groups: models.map((model) => ({ model, size: batch.count, adjustments: [] })),
    jobs: jobs.map((row) => ({ jobId: row.id, created: false, credits: row.credits })),
  }))
}

/** The found rows in job order (every key is found when this is called). */
function rows(found: ReadonlyMap<string, KeyedJobRow>, keys: readonly string[]): KeyedJobRow[] {
  return keys.map((k) => found.get(k)).filter((row): row is KeyedJobRow => row !== undefined)
}
