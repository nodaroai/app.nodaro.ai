/**
 * Declared job budgets, and the clocks they size (podcast Track 0.11).
 *
 * THE RULE (product decision, 2026-09-24). A node that declares a budget
 * (apply-edl today) gets node/poll timeouts = its budget, and the workflow cap
 * grows by the same excess. Short workflows keep today's 90/120-minute limits;
 * only runs containing a long render may run longer. Concretely:
 *
 *   excess              = max(0, budget − NODE_TIMEOUT_MS)
 *   processing ceiling  = NODE_TIMEOUT_MS          + excess   (= the budget)
 *   poll ceiling        = POLL_ABSOLUTE_TIMEOUT_MS + excess   (queue wait kept)
 *   workflow cap        = WORKFLOW_TIMEOUT_MS      + Σ excess over the run's
 *                                                   budgeted dispatches
 *
 * A node with no declared budget has excess 0, so every ceiling is exactly
 * today's constant — byte-identical, including the timeout messages.
 *
 * WHY A SUM for the workflow cap: sequential long renders add up exactly, and
 * PARALLEL ones are not guaranteed to overlap — every render shares the
 * worker's `FFMPEG_CONCURRENCY` slots, so two "parallel" renders can run back
 * to back. A max would under-cover that case; the sum is the safe upper bound,
 * and it only ever extends a run that dispatched a long render.
 *
 * SINGLE SOURCE OF TRUTH. `DECLARED_JOB_BUDGETS` maps a BullMQ job name to the
 * one function that reads that job's payload into a budget. The video worker's
 * handler declares its liveness budget THROUGH `declaredJobBudgetMs` (so the
 * pre-task heartbeat beats for exactly this long), and the orchestrator sizes
 * the node from the SAME call on the SAME payload — there is no second copy of
 * any formula to drift. Adding a budgeted job type is one entry here plus the
 * handler's one-line delegation; `workers/handlers/__tests__/ffmpeg.test.ts`
 * fails if a handler declares a budget this registry does not return.
 *
 * KEYED BY JOB NAME, READ BY ROW TOO. A `jobs` row carries the name the
 * registry is keyed on in `job_type` once the video worker picks it up (the
 * pickup CAS overwrites it with `job.name` — backend/CLAUDE.md), and the node
 * type before that; every registered name is also its node's type (guarded in
 * `services/workflow-engine/__tests__/node-executor-budget-ceilings.test.ts`),
 * so `declaredJobBudgetMs(row.job_type, row.input_data)` reads a row the way
 * the orchestrator read the payload (`input_data` is that payload, spread).
 *
 * audio-sync joins (podcast B3): it cannot see its sources' lengths until it
 * has fetched them, so its leaf charges every step at its own fixed ceiling —
 * the budget grows with the source COUNT only (2 sources ≈ 3 h, 6 ≈ 9 h of
 * hung-detector bound; a real run on cached proxies takes seconds per source).
 *
 * silence-detect joins with Track 0.19: its media proxy's source fetch now runs
 * under the big-media limits (up to an hour for a multi-gigabyte original),
 * which the 90-minute default no longer covers — a fixed ~2 h bound.
 * Pure: imports only the budget leaves and the engine's constants.
 */
import { applyEdlJobBudgetMs } from "../providers/video/apply-edl-budget.js"
import { audioSyncJobBudgetMs } from "../providers/audio/audio-sync-budget.js"
import { silenceDetectJobBudgetMs } from "../providers/audio/silence-detect-budget.js"
import {
  NODE_TIMEOUT_MS,
  POLL_ABSOLUTE_TIMEOUT_MS,
  WORKFLOW_TIMEOUT_MS,
  type OrchestratorContext,
} from "../services/workflow-engine/types.js"

type JobBudgetFn = (data: unknown) => number | undefined

const DECLARED_JOB_BUDGETS: Readonly<Record<string, JobBudgetFn>> = Object.freeze({
  "apply-edl": applyEdlJobBudgetMs,
  "audio-sync": audioSyncJobBudgetMs,
  "silence-detect": silenceDetectJobBudgetMs,
})

/** Every job name that can declare a budget — the `job_type` filter a row
 *  reader uses (`lib/execution-budget.ts`). */
export const BUDGETED_JOB_NAMES: readonly string[] = Object.freeze(Object.keys(DECLARED_JOB_BUDGETS))

/**
 * The budget (ms) a job of this name declares for this payload, or `undefined`
 * (unregistered name, or a payload the budget cannot read) — which leaves
 * every reader on its default.
 *
 * Never throws: a registered budget function that trips over a malformed
 * payload (e.g. a `null` segment in a row that skipped `normalizeEdl`) reads
 * as "no budget declared", so no reader — the orchestrator's resume
 * (`cancelInFlightChildJobs`), the row sweeps — can be aborted by one odd row.
 */
export function declaredJobBudgetMs(jobName: string, data: unknown): number | undefined {
  const fn = Object.prototype.hasOwnProperty.call(DECLARED_JOB_BUDGETS, jobName)
    ? DECLARED_JOB_BUDGETS[jobName]
    : undefined
  let ms: number | undefined
  try {
    ms = fn?.(data)
  } catch {
    return undefined
  }
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : undefined
}

/** How far a budget reaches past the default per-node ceiling. Never negative:
 *  a budget can only EXTEND a clock (same rule as the heartbeat's
 *  `effectiveHeartbeatMaxMs`), so a short render keeps the default. */
export function budgetExcessMs(budgetMs: number | undefined): number {
  return typeof budgetMs === "number" && Number.isFinite(budgetMs) && budgetMs > NODE_TIMEOUT_MS
    ? budgetMs - NODE_TIMEOUT_MS
    : 0
}

/** The two clocks `pollJobToCompletion` runs on, plus the excess they carry. */
export interface NodeCeilings {
  /** Processing time after the worker picks the job up. */
  readonly processingMs: number
  /** Everything since dispatch, queue wait included. */
  readonly pollAbsoluteMs: number
  readonly excessMs: number
}

/** A node's ceilings for its declared budget; `undefined` → today's constants. */
export function nodeCeilings(budgetMs?: number): NodeCeilings {
  const excessMs = budgetExcessMs(budgetMs)
  return {
    processingMs: NODE_TIMEOUT_MS + excessMs,
    pollAbsoluteMs: POLL_ABSOLUTE_TIMEOUT_MS + excessMs,
    excessMs,
  }
}

/** Grow the execution's cap by one budgeted dispatch's excess. A zero excess
 *  leaves the context untouched, so an unbudgeted run's context is unchanged. */
export function addBudgetExcess(ctx: Pick<OrchestratorContext, "budgetExcessMs">, excessMs: number): void {
  if (!Number.isFinite(excessMs) || excessMs <= 0) return
  ctx.budgetExcessMs = (ctx.budgetExcessMs ?? 0) + excessMs
}

/** The execution-level cap: `WORKFLOW_TIMEOUT_MS` plus the run's summed excess. */
export function workflowCapMs(budgetExcess: number | undefined): number {
  return WORKFLOW_TIMEOUT_MS + (typeof budgetExcess === "number" && budgetExcess > 0 ? budgetExcess : 0)
}

/**
 * The stale-execution backstop both sweeps use (`orchestrator-worker.ts ::
 * cleanupStaleExecutions` at boot, `lib/reconcile/workflow-executions-cron.ts`
 * every 90 s): a `running` row older than this is written off as abandoned.
 * 4 hours sits well past the 120-minute cap of an unbudgeted run; a run that
 * dispatched a long render gets the same excess on top
 * (`staleExecutionThresholdMs`), or the cron — whose abandon branch runs
 * BEFORE its queue-liveness check — would write "abandoned" onto a live run.
 */
export const STALE_EXECUTION_THRESHOLD_MS = 4 * 60 * 60 * 1000

export function staleExecutionThresholdMs(budgetExcess: number | undefined): number {
  return STALE_EXECUTION_THRESHOLD_MS + (typeof budgetExcess === "number" && budgetExcess > 0 ? budgetExcess : 0)
}
