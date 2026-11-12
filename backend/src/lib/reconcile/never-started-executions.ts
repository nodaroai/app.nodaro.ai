/**
 * Settles workflow runs that were created but never started.
 *
 * A run is written `pending` and then handed to the orchestration queue. When
 * that hand-off never lands (the process stopped between the two, as a deploy
 * does, or the queue refused the job), nothing will ever claim the row, and it
 * stays `pending` for good. Two gates read `pending` as "this workflow is
 * already running": the schedule cron skips every later fire
 * (`lib/schedule-fire.ts :: hasActiveExecution`), and a webhook trigger answers
 * 409 `already_running`. So one such row silenced its workflow's schedule with
 * no error anywhere. The stale sweeps never reached it: the boot sweep and the
 * 90-second cron (`workflow-executions-cron.ts`) both scan only rows an
 * orchestrator claimed (`running` / `stopping`).
 *
 * This sweep fails a never-claimed `pending` run when ALL of these hold:
 *   - it is older than the backstop every stale sweep uses
 *     (`STALE_EXECUTION_THRESHOLD_MS`, 4 h), plus any time it spent waiting for
 *     its run slot (`executionQueuedMs`, `includeOwnWait`). Waiting never counts
 *     against a run (decided 2026-10-30), and a parked run's own queue timeout
 *     ends that wait (`concurrency-lanes/queued-sweep.ts`);
 *   - this install's queue holds no live job for it (`ORCHESTRATOR_ALIVE_STATES`).
 *     A run still waiting behind others will start.
 * The write is `failWaitingExecution`: a compare-and-set from `pending` (a claim
 * that lands meanwhile wins), the run's `execution:failed` event, and a
 * use-case wrapper settled with its fee refunded. After it, the gates see no
 * active run and the schedule fires again on its next due tick.
 *
 * A queue that cannot answer is never read as "no job". Each call to it is
 * bounded (`../bull-call-timeout.ts`): one that fails leaves its row as it is,
 * and one that does not answer within 5 s ends the pass, since no row can be
 * judged while Redis is unreachable. The next tick tries again.
 *
 * Scope. A queue job lives in ONE install's Redis, so only the install that
 * created the run can tell it is gone. Every insert stamps that install
 * (`runtime_env`, guarded by `__tests__/workflow-execution-install-stamp.test.ts`),
 * and the scan goes through `scopeToRuntimeEnv`, as the other sweeps do: each
 * install settles its own runs, and production also settles unstamped rows,
 * those written before the stamp existed (on a shared database that includes
 * another install's, which are four hours past being claimed by then).
 */
import { supabase } from "../supabase.js"
import { orchestrationQueue } from "../orchestration-queue.js"
import { ORCHESTRATOR_ALIVE_STATES } from "../orchestration-queue-config.js"
import { BullCallTimeoutError, bounded } from "../bull-call-timeout.js"
import { scopeToRuntimeEnv } from "../runtime-env.js"
import { STALE_EXECUTION_THRESHOLD_MS, staleExecutionThresholdMs } from "../job-budget.js"
import { executionQueuedMs } from "../concurrency-lanes/execution-wait.js"
import { failWaitingExecution } from "../concurrency-lanes/run-failure.js"
import { processIdentity } from "./process-identity.js"

/** What the run shows in its history: rendered verbatim, so a plain sentence with no internals. */
export const NEVER_STARTED_MESSAGE = "Execution failed — it was created but never started. Run it again."

/** Per-tick cap; the next tick (90 s later) takes any leftovers, oldest first. */
const BATCH_LIMIT = 200

interface NeverStartedRow {
  readonly id: string
  readonly user_id: string
  readonly created_at: string
}

/**
 * One pass: fail every never-started run this install owns that is past the
 * backstop. Answers how many it failed. One row's failed write or failed queue
 * call never stops the batch; that row stays `pending` and the next tick tries
 * it again. A queue call that does not answer ends the pass.
 */
export async function sweepNeverStartedExecutions(nowMs: number = Date.now()): Promise<number> {
  const cutoff = new Date(nowMs - STALE_EXECUTION_THRESHOLD_MS).toISOString()
  const scan = supabase
    .from("workflow_executions")
    .select("id, user_id, created_at")
    .eq("status", "pending")
    .is("started_at", null)
    .lt("created_at", cutoff)
  const { data, error } = await scopeToRuntimeEnv(scan)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT)
  if (error) {
    console.error(`[reconcile/never-started] query failed: ${error.message}`)
    return 0
  }

  let settled = 0
  for (const row of (data ?? []) as NeverStartedRow[]) {
    try {
      if (await settleIfNeverStarted(row, nowMs)) settled++
    } catch (err) {
      console.error(`[reconcile/never-started] could not settle execution ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
      // Redis did not answer: no row can be judged until it does.
      if (err instanceof BullCallTimeoutError) break
    }
  }
  if (settled > 0) console.warn(`[reconcile/never-started] ${processIdentity()} tick: failed ${settled} execution(s) that were created but never started`)
  return settled
}

async function settleIfNeverStarted(row: NeverStartedRow, nowMs: number): Promise<boolean> {
  const createdAt = Date.parse(row.created_at)
  if (!Number.isFinite(createdAt)) return false

  // Still held by this install's queue (waiting behind other runs, delayed, being picked up): it will start.
  const job = await bounded(orchestrationQueue.getJob(row.id), "find the run's orchestration job")
  if (job && ORCHESTRATOR_ALIVE_STATES.has(await bounded(job.getState(), "read the orchestration job's state"))) return false

  // Time spent waiting for its run slot never counts against it.
  const waitedMs = await executionQueuedMs(row.id, row.user_id, { includeOwnWait: true, nowMs })
  if (nowMs - createdAt <= staleExecutionThresholdMs(0, waitedMs)) return false

  const failed = await failWaitingExecution(row.id, NEVER_STARTED_MESSAGE)
  if (failed) {
    console.warn(
      `[reconcile/never-started] ${processIdentity()} failed execution ${row.id} (created_at=${row.created_at}): still pending with no job in this install's queue.`,
    )
  }
  return failed
}
