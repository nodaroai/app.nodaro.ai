/**
 * Hand a route's workflow execution to the orchestration queue — or, when the
 * queue refuses it, fail the execution on the spot. The `workflow_executions`
 * twin of `enqueueRouteJob` (lib/enqueue-route-job.ts), for the routes that
 * start a run (a workflow run, an app run and its resume, a webhook, an API
 * token's run, a shared presentation, a chat trigger).
 *
 * The queue throws on an error reply from its store or on a connection closed
 * at shutdown (an outage makes it wait instead: lib/queue-connection.ts).
 * Left as it was, the execution stayed `pending` with its Idempotency-Key until
 * the never-started execution sweep took it, and a same-key retry was
 * answered with that dead run. Here it is failed at once, through the run's
 * own failure path (`failWaitingExecution`: its event for the editor and MCP
 * listeners, a use-case wrapper settled):
 *
 *   - Only from `pending`: a closed connection may have delivered the run and
 *     a worker claimed it. A run that is no longer `pending` has moved on and
 *     the request is answered as started — the rule `schedule-fire.ts` and
 *     `use-case-execution.ts` keep.
 *   - Its Idempotency-Key is released in the same write, so a retry with the
 *     same key starts a new run (the unique (user_id, idempotency_key)
 *     constraint would refuse it otherwise).
 *   - Nothing is refunded here: a waiting execution has reserved nothing
 *     itself (its nodes reserve when they run). A route that holds something
 *     before queueing (a fee) releases it itself, confirmed.
 *   - The request is answered `500 internal_error`.
 *
 * The failure write is retried inside `failWaitingExecutionDetailed`
 * (`updateExecutionWithRetry`), and a write that errored can still land with
 * only its answer lost: the retry then finds the row no longer `pending` and
 * the call answers false, as if the run had moved on. So a false answer that
 * came after a retried write is read back: a row that reads failed with this
 * failure's own message was failed by this call, and the event and the
 * use-case wrapper the failure path skipped are done here. A read that fails
 * decides nothing. A false answer to the FIRST write is believed without a
 * read: no write of this call's can have landed, so the run moved on (and a
 * read that failed there would turn a run a worker is running into an error).
 *
 * When the outcome stays unknown (the failure write fails after its retries,
 * or that read fails), the request is still answered 500 and the run is
 * logged and filed as an app report: it may still be `pending` (the
 * never-started execution sweep fails it, its key held until then), failed
 * by a write whose answer was lost (its key released, but no event sent), or
 * running.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { failWaitingExecutionDetailed } from "./concurrency-lanes/run-failure.js"
import { executionEvents } from "./execution-events.js"
import { supabase } from "./supabase.js"
import { insertAppReport } from "./app-reports.js"
import { sendInternalError } from "./http-errors.js"

/** What the failed run says (`workflow_executions.error_message`). */
export const UNQUEUED_EXECUTION_MESSAGE = "The run could not be queued to start. Run it again."

/** What the request is answered with (`500 internal_error`). */
export const UNQUEUED_EXECUTION_CLIENT_MESSAGE = "The run could not be started. Please try again."

/** The app report filed when a run the queue refused could not be confirmed failed (`app_reports.kind`). */
export const UNQUEUED_EXECUTION_UNSETTLED_KIND = "unqueued-execution-unsettled"

/** What became of a run the queue refused. */
export type UnqueuedExecutionOutcome = "failed" | "moved-on" | "unsettled"

/**
 * What a service that queues a run for its route (services/app-execution.ts)
 * throws when the queue refused the run and it did not move on. `outcome`
 * says what the caller may assume: "failed" — this call failed the run from
 * `pending` and released its key, so nothing runs; "unsettled" — the run's
 * state is unknown (still `pending`, failed with its answer lost, or running),
 * so a caller must not act as if nothing started. The queue's own error is
 * its `cause`.
 */
export class UnqueuedRunError extends Error {
  readonly executionId: string
  readonly outcome: Exclude<UnqueuedExecutionOutcome, "moved-on">

  constructor(executionId: string, outcome: Exclude<UnqueuedExecutionOutcome, "moved-on">, cause: unknown) {
    super(`The queue refused run ${executionId} (${outcome})`, { cause })
    this.name = "UnqueuedRunError"
    this.executionId = executionId
    this.outcome = outcome
  }
}

/** Where a settle logs: a request's logger, or the process's for a service with no request. */
interface SettleLog {
  error(obj: Record<string, unknown>, msg: string): void
  warn(obj: Record<string, unknown>, msg: string): void
}

const processLog: SettleLog = {
  error: (obj, msg) => console.error(`[enqueue-execution] ${msg}`, obj),
  warn: (obj, msg) => console.warn(`[enqueue-execution] ${msg}`, obj),
}

/**
 * Whether the run reads as this failure (failed, with `message`): true, false
 * (a row in any other state, or none), or null when the read itself fails.
 * Never throws.
 */
async function readsAsUnqueuedFailure(executionId: string, message: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from("workflow_executions")
      .select("status, error_message")
      .eq("id", executionId)
      .maybeSingle()
    if (error) return null
    const row = data as { status?: unknown; error_message?: unknown } | null
    return row?.status === "failed" && row.error_message === message
  } catch {
    return null
  }
}

/**
 * What the run's failure path does after a write it saw land, for one whose
 * answer was lost: the run's `execution:failed` event for the editor and MCP
 * listeners, and the use-case wrapper it reports to settled. Never throws.
 */
async function announceUnqueuedFailure(executionId: string, message: string, log: SettleLog): Promise<void> {
  try {
    executionEvents.emit(executionId, { type: "execution:failed", executionId, nodeStates: {}, errorMessage: message })
  } catch {
    // Never let event emission break a failure path (the orchestrator's rule).
  }
  try {
    // A use-case node's hidden run reports to its wrapper job (and refunds its fee). Does nothing for any other run.
    const { finalizeUseCaseWrapper } = await import("./use-case/finalize-wrapper.js")
    await finalizeUseCaseWrapper(executionId)
  } catch (err) {
    // The use-case wrapper sweep catches a wrapper left open.
    log.warn({ err, executionId }, "could not settle the use-case wrapper of a run the queue refused")
  }
}

/** Say loudly that it is unknown what became of a run the queue refused. Never throws. */
async function reportUnsettledRun(executionId: string, userId: string | null, log: SettleLog, err?: unknown): Promise<void> {
  log.error({ err, executionId }, "a run the queue refused could not be confirmed failed: it may be pending, failed with its answer lost, or moved on")
  await insertAppReport({
    node: "enqueue-execution",
    kind: UNQUEUED_EXECUTION_UNSETTLED_KIND,
    severity: "error",
    title: `Run ${executionId} the queue refused could not be confirmed failed`,
    payload: {
      message:
        "The failure write errored, or its answer was lost and the read-back failed, so the run's state is unknown. " +
        "If it is still pending, the never-started execution sweep fails it, and its Idempotency-Key is held until then. " +
        "If a write landed with its answer lost, the run is failed with its key released, but no failure event was sent " +
        "and a use-case wrapper it reports to is left for the wrapper sweep. Or it moved on: a worker claimed it.",
    },
    userId,
    executionId,
  })
}

/**
 * Fail a run the queue refused, from `pending` only, through the run's own
 * failure path, with `message` and the `extra` columns in the same write. A
 * false answer is read back only after a retried write (see the file's
 * header). Answers what became of the run, and on "unsettled" the failure
 * write's error when it threw. Reports nothing; never throws. Shared with the
 * schedule fire (lib/schedule-fire.ts), which keeps the run's key.
 */
export async function failUnqueuedRun(
  executionId: string,
  message: string,
  extra: Readonly<Record<string, unknown>>,
  log: SettleLog = processLog,
): Promise<{ readonly outcome: UnqueuedExecutionOutcome; readonly err?: unknown }> {
  let failure: { readonly failed: boolean; readonly attempts: number }
  try {
    failure = await failWaitingExecutionDetailed(executionId, message, extra)
  } catch (err) {
    return { outcome: "unsettled", err }
  }
  if (failure.failed) return { outcome: "failed" }
  // No longer `pending` after one write: nothing of this call's landed, so
  // the run moved on (a worker claimed it, its owner cancelled it).
  if (failure.attempts <= 1) return { outcome: "moved-on" }
  // No longer `pending` after a write that errored: either that write landed
  // and only its answer was lost (the row reads as this failure), or the run
  // moved on in between.
  const landed = await readsAsUnqueuedFailure(executionId, message)
  if (landed === null) return { outcome: "unsettled" }
  if (!landed) return { outcome: "moved-on" }
  await announceUnqueuedFailure(executionId, message, log)
  return { outcome: "failed" }
}

/**
 * Fail a run the queue refused, from `pending` only, its key released — for a
 * service that queues a run with no request in hand (it rethrows after, and
 * its route answers the error). Never throws.
 */
export async function settleUnqueuedRun(
  executionId: string,
  userId: string | null,
  log: SettleLog = processLog,
): Promise<UnqueuedExecutionOutcome> {
  const { outcome, err } = await failUnqueuedRun(executionId, UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null }, log)
  if (outcome === "unsettled") await reportUnsettledRun(executionId, userId, log, err)
  return outcome
}

/** Fail a run the queue refused, from `pending` only, its key released. Never throws. */
export async function settleUnqueuedExecution(req: FastifyRequest, executionId: string): Promise<UnqueuedExecutionOutcome> {
  return settleUnqueuedRun(executionId, req.userId ?? null, req.log)
}

/**
 * Run `enqueue` for the execution `executionId`, and settle the run when the
 * queue refuses it ({@link settleUnqueuedExecution}), WITHOUT answering the
 * request: for a route that decides its own answer from every run it fires (a
 * chat platform delivers a message again on an error answer, which would fire
 * again every trigger that did start). Answers null when the run was queued,
 * else what became of it. Never throws.
 */
export async function tryEnqueueExecution(
  req: FastifyRequest,
  executionId: string,
  enqueue: () => Promise<unknown>,
): Promise<{ readonly outcome: UnqueuedExecutionOutcome; readonly err: unknown } | null> {
  try {
    await enqueue()
    return null
  } catch (err) {
    return { outcome: await settleUnqueuedExecution(req, executionId), err }
  }
}

/**
 * Run `enqueue` for the execution `executionId` the route inserted. On
 * success it sends nothing. When the queue refuses it, the run is settled
 * ({@link settleUnqueuedExecution}) and, unless it moved on, the request is
 * answered 500, so the route's next statement is `if (reply.sent) return`.
 * Answers the outcome (null when the run was queued), for a route that holds
 * something of its own to release. Never throws.
 */
export async function enqueueExecution(
  req: FastifyRequest,
  reply: FastifyReply,
  executionId: string,
  enqueue: () => Promise<unknown>,
): Promise<UnqueuedExecutionOutcome | null> {
  const refused = await tryEnqueueExecution(req, executionId, enqueue)
  if (!refused) return null
  if (refused.outcome === "moved-on") {
    req.log.warn({ err: refused.err, executionId }, "the queue refused a run that has since moved on — answered as started")
    return refused.outcome
  }
  sendInternalError(reply, req, refused.err, UNQUEUED_EXECUTION_CLIENT_MESSAGE)
  return refused.outcome
}
