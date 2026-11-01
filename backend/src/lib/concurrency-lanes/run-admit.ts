// backend/src/lib/concurrency-lanes/run-admit.ts — the pickup gate of the run
// workers: the orchestrator (workflow executions), the pipeline worker (film
// pipelines) and the video director. Each asks worker-admit.ts for the run's
// slot before it starts the run, and runs it under the hold it got, so every
// node and funnel under it knows whose run it is.
//
//   - a top-level run takes a slot of its user's `run` lane, after its share of
//     this server's pool (server-share.ts) — 25 % of the orchestrator, pipeline
//     or director workers;
//   - a nested workflow execution (its payload names `parentExecutionId`: a
//     component or a use-case node of a running run started it) takes no slot,
//     is never refused by the share (only counted), and runs under a
//     coordinator hold — its parent holds the run's slot and waits for it, so a
//     slot it waited for could never come;
//   - a run that already started (an execution `running`, a pipeline driven
//     before — a drain hand-back, a stall re-pick, the next stage's drive) is
//     re-admitted at once and never parks;
//   - a run that ended is not admitted at all: the worker's own early return
//     handles a re-pick of a closed run, as it always has. Nor is a run whose
//     row is gone (deleted while it waited): only a read that FAILED admits a
//     run on its payload's line.
//
// A refused run is parked by the process's park handler (park.ts): an
// execution stays `pending`, a pipeline stays `queued`, a director's `jobs`
// row becomes `queued`; each is stamped and its BullMQ entry moved to the
// delayed set (DelayedError ends the attempt, none spent). With enforcement off
// nothing is refused: every run is granted at once and only counted.
//
// The rows are read with columns every database has (no lane column), and a
// read that fails admits the run as a fresh one on its payload's line: the park
// itself refuses a row that no longer waits, so a read error never parks a run
// that started.
import { DelayedError } from "bullmq"
import type { BillingContext } from "../billing-context.js"
import { supabase } from "../supabase.js"
import { DrainAbortError } from "../worker-drain.js"
import type { ReleaseOutcome } from "./gate.js"
import { runHolding } from "./hold.js"
import type { LaneQueueName } from "./types.js"
import { admitOrPark, workerRowOf, type AdmittedBullJob, type WorkerRow } from "./worker-admit.js"

/** The BullMQ job as a run worker holds it: admission's view plus its attempt count. */
export type RunBullJob = AdmittedBullJob & { attemptsMade?: number; opts?: AdmittedBullJob["opts"] & { attempts?: number } }

/** The execution columns a run's admission reads (all from migrations 036, 095 and 335). */
export const EXECUTION_PICKUP_COLUMNS = "id, user_id, status, workspace_id, org_id, trigger_type, mcp_client"
/** The pipeline columns a run's admission reads (migration 121). */
export const PIPELINE_PICKUP_COLUMNS = "id, user_id, status"

const ENDED_EXECUTION: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "timed_out", "discarded"])
const STARTED_EXECUTION: ReadonlySet<string> = new Set(["running", "stopping"])
const ENDED_PIPELINE: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "forked"])

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)

/**
 * The admission row of a workflow execution: `pending` waits (a fresh
 * acquire), `running` / `stopping` started (re-admitted); null when it ended.
 * The execution's trigger stands in for a job's source.
 */
export function executionWorkerRow(executionId: string, row: Record<string, unknown> | null, payloadUserId: unknown): WorkerRow | null {
  const status = str(row?.status)
  if (status && ENDED_EXECUTION.has(status)) return null
  return workerRowOf(executionId, {
    user_id: row?.user_id,
    status: status && STARTED_EXECUTION.has(status) ? "processing" : "pending",
    workspace_id: row?.workspace_id,
    org_id: row?.org_id,
    source: row?.trigger_type,
    mcp_client: row?.mcp_client,
  }, payloadUserId)
}

/**
 * The admission row of a pipeline: `queued` waits (it was never driven); any
 * other open status was driven before (re-admitted, never parked); null when
 * it ended. A pipeline's payer lives in its config, not in a column, so the
 * worker passes the payer it read for the pipeline (`payer`, the server's own
 * read): a workspace payer gives the row its workspace pair, as a job row
 * carries one, and admission then counts the pipeline on that line.
 */
export function pipelineWorkerRow(
  pipelineId: string,
  row: Record<string, unknown> | null,
  payloadUserId: unknown,
  payer?: BillingContext,
): WorkerRow | null {
  const status = str(row?.status)
  if (status && ENDED_PIPELINE.has(status)) return null
  return workerRowOf(pipelineId, {
    user_id: row?.user_id,
    status: status === null || status === "queued" ? "pending" : "processing",
    ...(payer?.payer === "workspace" ? { workspace_id: payer.workspaceId, org_id: payer.orgId } : {}),
  }, payloadUserId)
}

type RowRead = PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null } | null | undefined>

/**
 * A run's row for its admission: the row; `gone` when the read answered and
 * there is none (deleted with its workflow or its account); `unread` when the
 * read failed. Never throws.
 */
async function readRunRow(what: string, read: () => RowRead): Promise<Record<string, unknown> | "gone" | "unread"> {
  try {
    const { data, error } = (await read()) ?? { data: null, error: null }
    if (error) {
      console.warn(`[concurrency-lanes] could not read ${what} for its admission: ${error.message ?? error.code}`)
      return "unread"
    }
    return data ? (data as Record<string, unknown>) : "gone"
  } catch (err) {
    console.warn(`[concurrency-lanes] could not read ${what} for its admission: ${(err as Error)?.message ?? String(err)}`)
    return "unread"
  }
}

/**
 * The execution's admission row, read now (see executionWorkerRow). An
 * execution that is gone is not admitted (null, as an ended one): a deleted
 * run is never admitted as a fresh one. A read that failed admits it on its
 * payload's line.
 */
export async function readExecutionWorkerRow(executionId: string, payloadUserId: unknown): Promise<WorkerRow | null> {
  const row = await readRunRow(`execution ${executionId}`, () =>
    supabase.from("workflow_executions").select(EXECUTION_PICKUP_COLUMNS).eq("id", executionId).maybeSingle())
  if (row === "gone") return null
  return executionWorkerRow(executionId, row === "unread" ? null : row, payloadUserId)
}

/** The pipeline's admission row, read now (see pipelineWorkerRow); gone and unread as for an execution. */
export async function readPipelineWorkerRow(pipelineId: string, payloadUserId: unknown, payer?: BillingContext): Promise<WorkerRow | null> {
  const row = await readRunRow(`pipeline ${pipelineId}`, () =>
    supabase.from("pipelines").select(PIPELINE_PICKUP_COLUMNS).eq("id", pipelineId).maybeSingle())
  if (row === "gone") return null
  return pipelineWorkerRow(pipelineId, row === "unread" ? null : row, payloadUserId, payer)
}

const isFinalAttempt = (job: RunBullJob): boolean => (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1)

/**
 * Admit a run and run it under its hold; its slot is released when `run`
 * settles, exactly once: `completed` when it returned, `requeued` when the
 * job goes back to BullMQ (a park, a drain, a non-final attempt), `failed`
 * otherwise. A row of null (the run ended) runs `run` with no admission. A
 * refused run is parked: this throws DelayedError and `run` never starts.
 */
export async function runUnderRunAdmission<T>(
  args: { job: RunBullJob; token: string | undefined; queue: LaneQueueName; row: WorkerRow | null },
  run: () => Promise<T>,
): Promise<T> {
  if (!args.row) return run()
  const admission = await admitOrPark({ job: args.job, token: args.token, queue: args.queue, row: args.row })
  if (!admission) throw new DelayedError()
  let outcome: ReleaseOutcome = "failed"
  try {
    const result = await runHolding(admission.hold, run)
    outcome = "completed"
    return result
  } catch (err) {
    outcome = err instanceof DelayedError || err instanceof DrainAbortError || !isFinalAttempt(args.job) ? "requeued" : "failed"
    throw err
  } finally {
    await admission.release(outcome)
  }
}
