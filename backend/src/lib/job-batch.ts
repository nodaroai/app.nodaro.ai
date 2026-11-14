/**
 * Several jobs from ONE request — insert, reserve, queue — all or nothing.
 *
 * A request that plans N jobs (generate-image `count` / `models`;
 * generate-character / -creature / -location / -object `count` and video-sfx
 * `versions` from 2 up, whose repeat `keyed-batch-replay.ts` answers) needs the
 * three steps a single job takes, with one rule a single job never needed: no
 * part of the batch may be left running unpaid, or paid for but never queued.
 * So the steps run in phases, and a failure in any phase undoes what THIS
 * request took on before anything is queued:
 *
 *  1. Insert every job, each under its own idempotency key (`<key>:<i>`), so a
 *     retried request returns the same jobs and creates only what is missing.
 *     Every row carries the request's fingerprint. Without a key, plain
 *     inserts — exactly what one unkeyed call gets.
 *  2. Sort the jobs an earlier request created. Each must be of this route's
 *     job type (`input_data.type`): a key shared with another route's batch is
 *     a 422 `idempotency_key_reused`. One still `pending` is queued
 *     by THIS request, so it must have been made for the same request: a
 *     different fingerprint is a 422 (the key was reused for something else),
 *     never the new request run at the earlier charge. Then: `pending` with no
 *     credits held (that request stopped before paying) is TAKEN OVER —
 *     reserved and queued like a new one; `pending` and paid for is queued
 *     again (one queue entry per job, so a job still queued is not added
 *     twice); anything else is already running or done.
 *  3. Reserve each job this request owns (new or taken over) at its own price
 *     (`retainJobOnFailure`: a failed reservation leaves the job to the undo
 *     below). After each, a job found holding another request's hold too keeps
 *     that one and this request's is refunded (`job-batch-holds.ts`).
 *  4. Queue them in ONE call (`enqueue` must be atomic — BullMQ's `addBulk`
 *     is — and must not queue a job twice). A throw there does NOT prove
 *     nothing was queued: a closed connection can deliver the add and lose
 *     only its answer, and a worker may claim a job at once. So a refused add
 *     takes its own undo (`settleRefusedBatch`): each job this request owns is
 *     failed from `pending` first (its key released), and only the jobs that
 *     write failed are refunded and removed; a job no longer `pending` is
 *     left running and named in the 500's `error.startedJobIds`. When every
 *     one of them had moved on, the add landed: the batch is answered as
 *     started.
 *
 * A keyed batch runs under a claim (`job-batch-claim.ts`), renewed before
 * every reservation, before the queue and before an undo. A renewal that
 * fails means another request may be working on the batch now: this one
 * answers 409 and touches nothing more — no reservation, no queue, no undo.
 * What it already did stays for that request to find (it pays for and queues
 * what is unpaid, and queues what is paid), or for the never-started sweep.
 *
 * Undo, before anything is queued (an insert, a charge, a holds read or a
 * reused key that fails) = refund what this request reserved and remove the
 * rows it owns whose refund is CONFIRMED (`undoOwnedJobs`); a row whose refund
 * is not stays `pending` and unqueued for `sweepNeverStartedJobs`
 * (lib/reconcile/cron.ts), which fails it and refunds its hold after 30
 * minutes. Removing (not failing) the others is the established answer for a
 * job that never ran, and frees their keys, so the request can be retried
 * once the cause is fixed. After a refused queue the removal waits for the
 * failure write (step 4), so a job a worker took is never refunded or removed.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { insertJobIdempotent } from "./insert-job.js"
import { reserveCreditsForJob } from "../middleware/credit-guard.js"
import { jobCreditHolds } from "./credits-job-lifecycle.js"
import { computeFingerprint } from "./dedup-fingerprint.js"
import { sendInternalError } from "./http-errors.js"
import { batchClaimKey, claimBatch, type BatchClaim } from "./job-batch-claim.js"
import { settleRefusedBatch, undoOwnedJobs, yieldToOtherHold } from "./job-batch-holds.js"

/** One job of a batch, planned by the route before anything is created. */
export interface PlannedBatchJob {
  /** The jobs row, as the route would insert it alone (`user_id`, `status`, `input_data`, …). */
  readonly row: Record<string, unknown> & { readonly user_id: string }
  /** The credit identifier the job reserves — the one the pre-flight priced it at. */
  readonly creditIdentifier: string
}

/** A job handed to `enqueue`. */
export interface BatchJobToQueue {
  /** Its position in the planned list. */
  readonly index: number
  readonly jobId: string
  readonly usageLogId?: string
}

/** One job of the batch as the request ends. */
export interface BatchJob {
  readonly jobId: string
  /** False when an earlier request with the same idempotency key created it. */
  readonly created: boolean
  /** An earlier request created it but left it unpaid: THIS request reserved it. */
  readonly takenOver?: boolean
  /** Credits held for it — this request's reservation, or the earlier request's hold; null where nothing is charged. */
  readonly credits: number | null
  readonly usageLogId?: string
}

export interface RunJobBatchOptions {
  /** The request's Idempotency-Key; job i is keyed `<key>:<i>`. */
  readonly idempotencyKey?: string | null
  /**
   * Queue the jobs, all at once: all of them or none. A throw may still have
   * queued them all with only its answer lost, so the jobs are settled from
   * `pending` (`settleRefusedBatch`) rather than assumed unqueued. A job
   * already in the queue must not be queued again (give each entry the job's
   * own queue id) — a retry re-queues the paid jobs an earlier request left.
   */
  readonly enqueue: (jobs: readonly BatchJobToQueue[]) => Promise<void>
  /** The message of a 500 (`sendInternalError`). */
  readonly failureMessage: string
}

/** Job i's idempotency key: the request's own, suffixed with its position. */
export function batchJobKey(key: string | null | undefined, index: number): string | undefined {
  return key ? `${key}:${index}` : undefined
}

/**
 * A batch job's queue id: its own, under the worker's job name, so the queue
 * holds one entry per job and a retry that queues a paid job again is ignored
 * while that job still waits (BullMQ ids may not contain ":").
 */
export function batchQueueId(name: string, jobId: string): string {
  return `${name}-${jobId}`
}

/** A job this request reserves: one it created, or one it took over. */
interface OwnedJob {
  readonly index: number
  readonly jobId: string
  readonly created: boolean
  usageLogId?: string
  credits: number | null
  /** Another request's hold pays for it (a race): ours was refunded. */
  paidByOther?: boolean
}

/** A job an earlier request created and this one leaves to it. */
interface KeptJob {
  readonly jobId: string
  /** The job type its earlier request recorded (`input_data.type`). */
  readonly jobType: string | null
  readonly credits: number | null
  readonly status: string | null
  readonly fingerprint: string | null
}

/**
 * What the batch's rows record as their job type (`input_data.type`): the
 * route's own, the same on every planned row; null when the route states none.
 */
function plannedJobType(planned: readonly PlannedBatchJob[]): string | null {
  const type = (planned[0]?.row.input_data as { type?: unknown } | undefined)?.type
  return typeof type === "string" && type ? type : null
}

/** The type a job row records (`input_data.type`), or null. */
export function recordedJobType(inputData: unknown): string | null {
  const type = (inputData as { type?: unknown } | null | undefined)?.type
  return typeof type === "string" && type ? type : null
}

/**
 * Answers 422: the Idempotency-Key was already used for a different request —
 * another route, or the same route with other parameters. Never answered with
 * the earlier request's jobs, and never run at the earlier charge.
 */
export function replyKeyReused(reply: FastifyReply): FastifyReply {
  return reply.status(422).send({
    error: {
      code: "idempotency_key_reused",
      message: "This Idempotency-Key was already used for a different request. Send the same request again, or use a new key.",
    },
  })
}

/** The claim a keyed batch runs under, or none for an unkeyed one. */
interface Run {
  readonly claim: BatchClaim | null
  readonly fingerprint: string
}

/** Answered when this request no longer holds its batch's claim. */
function claimLost(reply: FastifyReply): null {
  if (!reply.sent) {
    reply.status(409).send({
      error: {
        code: "batch_in_progress",
        message: "Another request with this Idempotency-Key took over creating these jobs. Retry it — it returns the same jobs.",
      },
    })
  }
  return null
}

/** True while this request may still change its batch (always, for an unkeyed one). */
async function stillHeld(run: Run): Promise<boolean> {
  return run.claim ? run.claim.renew() : true
}

/** Undo what this request owns — only while it still holds the batch. */
async function undoIfHeld(req: FastifyRequest, run: Run, owned: readonly OwnedJob[]): Promise<void> {
  if (!(await stillHeld(run))) {
    req.log.warn("[job-batch] the batch's claim was lost before its undo: its jobs are left to the request that holds it")
    return
  }
  await undoOwnedJobs(req, owned)
}

/**
 * The 500's message when some of the batch's jobs did start (`error.startedJobIds`
 * lists them): the words `UNQUEUED_BATCH_CLIENT_MESSAGE` (lib/enqueue-route-job.ts)
 * gives every batch route; a test holds the two equal. Kept here, not
 * imported: that module builds the queue at import.
 */
export const PARTLY_STARTED_BATCH_MESSAGE =
  "Some of the jobs could not be started. The jobs in startedJobIds are running; please try the rest again."

/**
 * The queue refused the batch's bulk add: settle what this request owns
 * (`settleRefusedBatch`, while it still holds the batch) and answer. True
 * when nothing was failed and the jobs it owns had all moved on — the add
 * landed with its answer lost, so the batch is answered as started; false
 * once the 500 is sent (with `error.startedJobIds` when some did start).
 */
async function answerRefusedQueue(
  req: FastifyRequest,
  reply: FastifyReply,
  run: Run,
  owned: readonly OwnedJob[],
  err: unknown,
  opts: RunJobBatchOptions,
): Promise<boolean> {
  if (!(await stillHeld(run))) {
    req.log.warn("[job-batch] the batch's claim was lost before its undo: its jobs are left to the request that holds it")
    sendInternalError(reply, req, err, opts.failureMessage)
    return false
  }
  // Only what this request owns is settled: a paid job an earlier request
  // left is that request's (queued already, or failed and refunded by the
  // never-started sweep).
  const { started, failed } = await settleRefusedBatch(req, owned)
  if (failed.length === 0 && started.length > 0) {
    req.log.warn({ err, jobIds: started }, "[job-batch] the queue refused a batch whose jobs have all since moved on — answered as started")
    return true
  }
  if (started.length === 0) {
    sendInternalError(reply, req, err, opts.failureMessage)
    return false
  }
  req.log.error({ startedJobIds: started, failedJobIds: failed }, "[job-batch] the queue refused a batch that partly started: the rest is failed and refunded")
  sendInternalError(reply, req, err, PARTLY_STARTED_BATCH_MESSAGE, { startedJobIds: started })
  return false
}

/**
 * Insert, reserve and queue `planned`, all or nothing. Resolves the batch's
 * jobs in planned order, or `null` once the request has been answered with
 * the failure (the reply is sent; nothing this request owned is left running
 * or paid for, unless it lost the batch to another request, which then owns
 * it, or a refused queue add was delivered after all and a worker took some
 * of its jobs: those keep running and the 500 names them).
 */
export async function runJobBatch(
  req: FastifyRequest,
  reply: FastifyReply,
  planned: readonly PlannedBatchJob[],
  opts: RunJobBatchOptions,
): Promise<BatchJob[] | null> {
  // The guard's own fingerprint when it took one (it backfills the same value
  // onto each job it reserves), so the stamp and every comparison agree.
  const fingerprint = req.inputFingerprint ?? computeFingerprint(req.url, req.body)
  if (!opts.idempotencyKey) return runBatch(req, reply, planned, opts, { claim: null, fingerprint })
  let claim: BatchClaim | null
  try {
    claim = await claimBatch(batchClaimKey(req.userId ?? "", opts.idempotencyKey))
  } catch (err) {
    sendInternalError(reply, req, err, opts.failureMessage)
    return null
  }
  if (!claim) {
    reply.status(409).send({
      error: {
        code: "batch_in_progress",
        message: "A request with this Idempotency-Key is still creating its jobs. Retry it shortly — it returns the same jobs.",
      },
    })
    return null
  }
  try {
    return await runBatch(req, reply, planned, opts, { claim, fingerprint })
  } finally {
    await claim.release()
  }
}

async function runBatch(
  req: FastifyRequest,
  reply: FastifyReply,
  planned: readonly PlannedBatchJob[],
  opts: RunJobBatchOptions,
  run: Run,
): Promise<BatchJob[] | null> {
  // ── 1. Insert ─────────────────────────────────────────────────────────────
  const owned: OwnedJob[] = []
  const kept = new Map<number, KeptJob>()
  for (let index = 0; index < planned.length; index++) {
    try {
      // The throwing lane: a refused insert (a request-gate block, a bad
      // origin) throws, and the catch below answers it.
      const inserted = await insertJobIdempotent<{ id: string; credits?: number | null; status?: string | null; input_fingerprint?: string | null; input_data?: unknown }>(
        req,
        { ...planned[index]!.row, input_fingerprint: run.fingerprint },
        batchJobKey(opts.idempotencyKey, index),
        "id, credits, status, input_fingerprint, input_data",
      )
      const row = inserted.row
      if (inserted.created) owned.push({ index, jobId: row.id, created: true, credits: null })
      else {
        kept.set(index, {
          jobId: row.id,
          credits: typeof row.credits === "number" ? row.credits : null,
          status: row.status ?? null,
          fingerprint: row.input_fingerprint ?? null,
          jobType: recordedJobType(row.input_data),
        })
      }
    } catch (err) {
      await undoIfHeld(req, run, owned)
      sendInternalError(reply, req, err, opts.failureMessage)
      return null
    }
  }

  // ── 2. Sort what an earlier request created ───────────────────────────────
  // Every job an earlier request made under these keys must have been made by
  // this route: a key shared with another route's batch is the key reused for
  // something else, never answered with (or topped up beside) that batch.
  const expectedType = plannedJobType(planned)
  if (expectedType && [...kept.values()].some((job) => job.jobType !== expectedType)) {
    await undoIfHeld(req, run, owned)
    replyKeyReused(reply)
    return null
  }
  const requeue: BatchJobToQueue[] = []
  const waiting = [...kept].filter(([, job]) => job.status === "pending")
  if (waiting.length > 0) {
    // This request would queue these: they must be the same request's jobs.
    if (waiting.some(([, job]) => job.fingerprint !== null && job.fingerprint !== run.fingerprint)) {
      await undoIfHeld(req, run, owned)
      replyKeyReused(reply)
      return null
    }
    const holds = await jobCreditHolds(waiting.map(([, job]) => job.jobId))
    if (!holds) {
      // Paid or not cannot be told apart: taking one over could charge it twice.
      await undoIfHeld(req, run, owned)
      sendInternalError(reply, req, new Error("could not read the credit holds of the batch's jobs"), opts.failureMessage)
      return null
    }
    for (const [index, job] of waiting) {
      const jobHolds = holds.get(job.jobId) ?? []
      if (jobHolds.length > 1) {
        req.log.error({ jobId: job.jobId, usageLogIds: jobHolds.map((h) => h.id) }, "[job-batch] a job holds more than one hold")
      }
      if (jobHolds[0]) {
        requeue.push({ index, jobId: job.jobId, usageLogId: jobHolds[0].id })
      } else {
        kept.delete(index)
        owned.push({ index, jobId: job.jobId, created: false, credits: null })
      }
    }
    owned.sort((a, b) => a.index - b.index)
  }

  // ── 3. Reserve ────────────────────────────────────────────────────────────
  // The reservation writes `req.idempotencyKey` onto the job it reserves (its
  // dedup backfill). Each job already carries its own key, so the request's is
  // set to that job's while it reserves: the request's bare key on a second
  // job would collide with the first and read as a lost dedup race.
  const requestKey = req.idempotencyKey
  try {
    for (const job of owned) {
      if (!(await stillHeld(run))) return claimLost(reply)
      req.idempotencyKey = batchJobKey(opts.idempotencyKey, job.index)
      let reservation: Awaited<ReturnType<typeof reserveCreditsForJob>>
      try {
        reservation = await reserveCreditsForJob(req, reply, job.jobId, planned[job.index]!.creditIdentifier, { retainJobOnFailure: true })
      } catch (err) {
        await undoIfHeld(req, run, owned)
        if (!reply.sent) sendInternalError(reply, req, err, opts.failureMessage)
        return null
      }
      if (reply.sent) {
        // The reservation answered (402, 403, 503, …) and left the job (and
        // any hold a lost answer hid) to the undo.
        await undoIfHeld(req, run, owned)
        return null
      }
      job.usageLogId = reservation?.usageLogId
      job.credits = typeof reservation?.creditsReserved === "number" ? reservation.creditsReserved : null
      if (job.usageLogId) {
        const other = await yieldToOtherHold(req, job.jobId, job.usageLogId)
        if (other) {
          job.paidByOther = true
          job.usageLogId = other.id
          job.credits = other.credits
        }
      }
    }
  } finally {
    req.idempotencyKey = requestKey
  }

  // ── 4. Queue ──────────────────────────────────────────────────────────────
  const toQueue = [
    ...owned.map((job) => ({ index: job.index, jobId: job.jobId, ...(job.usageLogId ? { usageLogId: job.usageLogId } : {}) })),
    ...requeue,
  ].sort((a, b) => a.index - b.index)
  if (toQueue.length > 0) {
    if (!(await stillHeld(run))) return claimLost(reply)
    try {
      await opts.enqueue(toQueue)
    } catch (err) {
      if (!(await answerRefusedQueue(req, reply, run, owned, err, opts))) return null
    }
  }

  const byIndex = new Map(owned.map((job) => [job.index, job]))
  const requeued = new Map(requeue.map((job) => [job.index, job]))
  return planned.map((_, index) => {
    const mine = byIndex.get(index)
    if (mine) {
      return {
        jobId: mine.jobId,
        created: mine.created,
        ...(mine.created || mine.paidByOther ? {} : { takenOver: true }),
        credits: mine.credits,
        ...(mine.usageLogId ? { usageLogId: mine.usageLogId } : {}),
      }
    }
    const earlier = kept.get(index)!
    const usageLogId = requeued.get(index)?.usageLogId
    return { jobId: earlier.jobId, created: false, credits: earlier.credits, ...(usageLogId ? { usageLogId } : {}) }
  })
}
