/**
 * Hand a route's job to its queue — or, when the queue refuses it, fail the
 * job and give its credits back on the spot.
 *
 * A route inserts the job, reserves its credits, then queues it. The queue's
 * connection (lib/queue-connection.ts) retries without limit and holds
 * commands while it is offline, so an outage makes `add` wait rather than
 * throw. It throws on a Redis error reply — OOM (memory full), READONLY (a
 * replica after a failover), MISCONF (snapshots failing), LOADING (the
 * dataset still loading) — and with "Connection is closed" when the
 * connection is shut down (the process stopping). Then nothing will ever run
 * the job. Left as it was, the row stayed `pending` with its credit hold and
 * its Idempotency-Key for the never-started sweep's 30 minutes
 * (lib/reconcile/cron.ts), and a client that retried with the same key was
 * answered with that dead job the whole time. Here it is failed at once:
 *
 *   - Only from `pending`. A closed connection may have delivered the job and
 *     lost only its answer, and a worker may already have claimed the row. A
 *     row that is no longer `pending` has moved on (it reached the queue, or
 *     its owner cancelled it): the request is answered as started,
 *     `{ jobId }`, as the schedule lane answers a run the queue refused
 *     (lib/schedule-fire.ts). A queue entry that lands after the row is
 *     failed is discarded by the worker's pickup claim, which takes only a
 *     live row.
 *   - Through the failure funnel (lib/job-failure.ts), tried twice: a write
 *     that errors is written again, and when that second one finds the row
 *     already failed with this failure's own message, the first one landed
 *     and only its answer was lost.
 *   - Its Idempotency-Key is released in the same write. Every lookup of a
 *     key answers whatever job holds it, failed or not (the credit guard's
 *     short lookup, a route's any-age lookup, the idempotent insert's
 *     conflict read, the dedup backfill of `reserveCreditsForJob`), and the
 *     unique (user_id, idempotency_key) constraint would refuse a second row
 *     under it. A request answered with an error started nothing, so a retry
 *     with the same key starts a new run. A same-key request that arrives
 *     before the failure write lands is answered with the job about to fail,
 *     which then reads failed; any retry after the 500 finds the key free.
 *   - Refunded only when that write flipped the row, and confirmed by a read
 *     (`refundJobHoldsConfirmed`). A row already `failed` is revisited by no
 *     sweep, so a hold the read still finds reserved is logged and filed as
 *     an app report (`unqueued-job-refund-unconfirmed`) for an operator.
 *   - The request is answered `500 internal_error` (`sendInternalError`), the
 *     answer a route gives when its job row cannot be written.
 *
 * When the first failure write errors and the outcome stays unknown, the
 * request is still answered with the error and the job is logged and filed
 * as an app report (`unqueued-job-failure-unconfirmed`), since the row may be
 * in any of three states and only one of them is ever revisited:
 *   - neither write landed: the row keeps its hold and its key, and is still
 *     `pending`. The never-started sweep fails and refunds it within about 30
 *     minutes, as before this helper — unless a closed connection delivered
 *     the job after all, when a worker runs it. A retry with that key is
 *     answered with that job (the docs tell a client to use a new key if it
 *     then fails);
 *   - the first write landed with its answer lost and the second errored, or
 *   - the second write missed and the read of the row failed: the row may be
 *     `failed` with its key cleared and its hold still `reserved`, which no
 *     sweep reads — the report is the only way an operator hears of it.
 *
 * `enqueueRouteJobs` does the same for several jobs reserved under keys of
 * their own and queued one by one (the ones already queued keep running; the
 * 500 names them) — no route uses it today: a route that makes several jobs
 * per request goes through `runJobBatch` (lib/job-batch.ts), which keys job i
 * `<key>:<i>` (reserving them under the request's bare key collides on the
 * unique key index). `enqueueUnitJob` does the same for a node unit's job on
 * its own queue. `failUnqueuedRouteJob` gives the same settle
 * and the same 500 to a job that never reached the queue because a step
 * between its insert and its queue threw. `lib/enqueue-execution.ts` is the twin for a
 * workflow run. `src/lib/__tests__/route-enqueue-guard.test.ts` holds every
 * route (`routes/`, `ee/routes/`, the node units') to these helpers.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { videoQueue } from "./queue.js"
import { supabase } from "./supabase.js"
import { markJobFailedDetailed, type JobFailureOutcome, type MarkJobFailedInput } from "./job-failure.js"
import { refundJobHoldsConfirmed } from "./credits-job-lifecycle.js"
import { insertAppReport } from "./app-reports.js"
import { sendInternalError } from "./http-errors.js"

/** What the failed row says (`jobs.error_message`). */
export const UNQUEUED_JOB_MESSAGE = "The job could not be queued to start. Run it again."

/** What the request is answered with (`500 internal_error`). */
export const UNQUEUED_JOB_CLIENT_MESSAGE = "The job could not be started. Please try again."

/** The app report filed when a failed job's refund cannot be confirmed (`app_reports.kind`). */
export const UNQUEUED_REFUND_UNCONFIRMED_KIND = "unqueued-job-refund-unconfirmed"

/** The app report filed when it is unknown whether a job the queue refused was failed (`app_reports.kind`). */
export const UNQUEUED_FAILURE_UNCONFIRMED_KIND = "unqueued-job-failure-unconfirmed"

/** The failure write: from `pending` only, its key released in the same statement. */
const UNQUEUED_FAILURE: MarkJobFailedInput = {
  error_message: UNQUEUED_JOB_MESSAGE,
  from: ["pending"],
  extra: { idempotency_key: null },
}

/**
 * Whether the row already reads as this failure (failed, with this message):
 * true, false, or null when the read itself fails. Never throws.
 */
async function readsAsUnqueuedFailure(jobId: string): Promise<boolean | null> {
  try {
    // trash-read: the request that wrote this job's failure reads it back to learn whether it landed; nothing is shown to anyone.
    const { data, error } = await supabase.from("jobs").select("status, error_message").eq("id", jobId).maybeSingle()
    if (error) return null
    const row = data as { status?: unknown; error_message?: unknown } | null
    return row?.status === "failed" && row.error_message === UNQUEUED_JOB_MESSAGE
  } catch {
    return null
  }
}

/**
 * Fail a job the queue refused: the write, written again once when it errors.
 * "error" comes only after the first write errored, and leaves the row in an
 * unknown state (see the file's header). Never throws.
 */
async function failUnqueuedJob(jobId: string): Promise<JobFailureOutcome> {
  const first = await markJobFailedDetailed(jobId, UNQUEUED_FAILURE)
  if (first !== "error") return first
  const second = await markJobFailedDetailed(jobId, UNQUEUED_FAILURE)
  if (second !== "missed") return second
  // No longer `pending` after a write that errored: either that write landed
  // and only its answer was lost (the row reads as this failure), or the job
  // moved on in between.
  const landed = await readsAsUnqueuedFailure(jobId)
  return landed === null ? "error" : landed ? "flipped" : "missed"
}

/** Say loudly that a job the queue refused may be failed with its hold still reserved. Never throws. */
async function reportUnconfirmedFailure(req: FastifyRequest, jobId: string): Promise<void> {
  req.log.error({ jobId }, "a job the queue refused could not be confirmed failed: it may be pending, or failed with its credits still held")
  await insertAppReport({
    node: "enqueue-route-job",
    kind: UNQUEUED_FAILURE_UNCONFIRMED_KIND,
    severity: "error",
    title: `Job ${jobId} the queue refused could not be confirmed failed`,
    payload: {
      message:
        "The failure write errored and its outcome is unknown. If the job is pending, the never-started sweep fails and refunds it; " +
        "if it is failed, no sweep revisits it: check its usage logs for a hold still reserved.",
    },
    userId: req.userId ?? null,
    jobId,
  })
}

/** Refund a job this helper failed, and say so loudly when the refund cannot be confirmed. Never throws. */
async function refundUnqueuedJob(req: FastifyRequest, jobId: string): Promise<void> {
  if (await refundJobHoldsConfirmed(jobId)) return
  req.log.error({ jobId }, "a job the queue refused is failed, but the refund of its credits could not be confirmed")
  await insertAppReport({
    node: "enqueue-route-job",
    kind: UNQUEUED_REFUND_UNCONFIRMED_KIND,
    severity: "error",
    title: `Refund not confirmed for job ${jobId}, failed because the queue refused it`,
    payload: { message: "The job is failed and no sweep revisits it: check its usage logs for a hold still reserved." },
    userId: req.userId ?? null,
    jobId,
  })
}

/**
 * Settle a job the queue refused: fail it from `pending` (its key released),
 * refund it confirmed when this call flipped it, report it when the outcome
 * stays unknown. Answers the failure's outcome: "missed" means the job moved
 * on (it is running, or its owner cancelled it). Never throws.
 */
async function settleUnqueuedJob(req: FastifyRequest, jobId: string): Promise<JobFailureOutcome> {
  let outcome: JobFailureOutcome = "error"
  try {
    outcome = await failUnqueuedJob(jobId)
    if (outcome === "flipped") await refundUnqueuedJob(req, jobId)
    else if (outcome === "error") await reportUnconfirmedFailure(req, jobId)
  } catch (failErr) {
    req.log.error({ err: failErr, jobId }, "could not fail or refund a job the queue refused")
  }
  return outcome
}

/**
 * Fail a job the route inserted (and reserved, or tried to) that it will now
 * never queue, because a step between the insert and the queue threw — a
 * reservation that threw instead of answering, a sub-request it makes, a
 * cleanup that failed — and answer the request `500 internal_error`. The job
 * takes the same settle as one the queue refused: failed from `pending` with
 * its key released, its holds refunded confirmed, reported when the outcome
 * stays unknown. Unlike a refused queue nothing was handed to a queue, so a
 * job that is no longer `pending` never started: its owner cancelled it, or it
 * was removed. The answer is the 500 either way (unless one was already
 * sent). The route returns right after. Never throws.
 */
export async function failUnqueuedRouteJob(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  err: unknown,
): Promise<void> {
  if ((await settleUnqueuedJob(req, jobId)) === "missed") {
    req.log.warn({ err, jobId }, "a job that failed before it was queued is no longer pending (cancelled or removed)")
  }
  if (!reply.sent) sendInternalError(reply, req, err, UNQUEUED_JOB_CLIENT_MESSAGE)
}

/**
 * Run `enqueue` for the job `jobId` the route inserted and reserved. On
 * success it sends nothing: the route answers as it always did. When the
 * queue refuses the job it fails it, refunds it and sends the 500, so the
 * route's next statement is `if (reply.sent) return` — the same contract as
 * `reserveCreditsForJob`. Never throws.
 */
export async function enqueueRouteJob(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  enqueue: () => Promise<unknown>,
): Promise<void> {
  try {
    await enqueue()
    return
  } catch (err) {
    if ((await settleUnqueuedJob(req, jobId)) === "missed") {
      req.log.warn({ err, jobId }, "the queue refused a job that has since moved on — answered as started")
      return
    }
    sendInternalError(reply, req, err, UNQUEUED_JOB_CLIENT_MESSAGE)
  }
}

/** What a batch route's 500 says when some of its jobs did start (`error.startedJobIds` lists them). */
export const UNQUEUED_BATCH_CLIENT_MESSAGE =
  "Some of the jobs could not be started. The jobs in startedJobIds are running; please try the rest again."

/** One job of a batch route: the row it inserted and reserved, and how to queue it. */
export interface RouteJobEnqueue {
  readonly jobId: string
  readonly enqueue: () => Promise<unknown>
}

/**
 * Queue several jobs in order, each already inserted and reserved under a key
 * of its own (never the request's bare key on more than one: see the file's
 * header — a route that makes several jobs per request uses `runJobBatch`).
 * When the queue refuses one, that job and every job after it — none of them
 * queued — are settled like {@link enqueueRouteJob}'s (failed from `pending`,
 * key released, refund confirmed); the jobs already queued keep running. The
 * request is then answered `500 internal_error` with `error.startedJobIds`:
 * the jobs that are running (the refused one too, when it moved on), so a
 * client can follow them and run the rest again. When nothing ends up failed
 * (the refused job had moved on and was the last), nothing is sent and the
 * route answers as it always did. The route's next statement is
 * `if (reply.sent) return`. Never throws.
 */
export async function enqueueRouteJobs(
  req: FastifyRequest,
  reply: FastifyReply,
  jobs: ReadonlyArray<RouteJobEnqueue>,
): Promise<void> {
  const started: string[] = []
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!
    try {
      await job.enqueue()
      started.push(job.jobId)
      continue
    } catch (err) {
      const failed: string[] = []
      if ((await settleUnqueuedJob(req, job.jobId)) === "missed") started.push(job.jobId)
      else failed.push(job.jobId)
      // The jobs after it were never handed to the queue: a "missed" one was
      // cancelled meanwhile, not started.
      for (const rest of jobs.slice(i + 1)) {
        await settleUnqueuedJob(req, rest.jobId)
        failed.push(rest.jobId)
      }
      if (failed.length === 0) {
        req.log.warn({ err, jobId: job.jobId }, "the queue refused the last job of a batch that has since moved on — answered as started")
        return
      }
      req.log.error({ startedJobIds: started, failedJobIds: failed }, "the queue refused part of a batch: the rest is failed and refunded")
      sendInternalError(reply, req, err, started.length > 0 ? UNQUEUED_BATCH_CLIENT_MESSAGE : UNQUEUED_JOB_CLIENT_MESSAGE, { startedJobIds: started })
      return
    }
  }
}

/** The queues a node unit's worker runs on (unit.json `execution.queue`, tools/units/vocabulary.mjs QUEUES). */
const UNIT_QUEUES = { video: videoQueue } as const

/** The name of a queue a unit may run on. */
export type UnitQueueName = keyof typeof UNIT_QUEUES

/** What a node unit's descriptor (backend/src/nodes/<type>/descriptor.generated.ts) says about where its job runs. */
export interface QueuedUnit {
  readonly type: string
  readonly execution: { readonly queue?: UnitQueueName }
}

/**
 * Queue a node unit's job: on the unit's own queue, under its type (the name
 * the worker dispatches to the unit's worker.ts), through
 * {@link enqueueRouteJob}. `data` is the job's queue payload; its `jobId` is
 * the row the route inserted.
 */
export async function enqueueUnitJob(
  req: FastifyRequest,
  reply: FastifyReply,
  unit: QueuedUnit,
  data: { readonly jobId: string } & Record<string, unknown>,
): Promise<void> {
  await enqueueRouteJob(req, reply, data.jobId, async () => {
    const queue = unit.execution.queue === undefined ? undefined : UNIT_QUEUES[unit.execution.queue]
    if (!queue) throw new Error(`${unit.type}: the unit names no queue this server runs (execution.queue ${String(unit.execution.queue)})`)
    return queue.add(unit.type, data)
  })
}
