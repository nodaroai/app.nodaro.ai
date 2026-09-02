/**
 * Orchestration-queue CONSTANTS, with no imports and no side effects.
 *
 * WHY A SEPARATE MODULE (M-10a). `orchestration-queue.ts` builds an IORedis
 * connection with `maxRetriesPerRequest: null` AND a live `Queue` at module
 * load, so merely importing it retries forever against a Redis that is not
 * there under vitest — the documented "Backend Tests hang" failure. Every
 * consumer that needs only a NUMBER or a SET was therefore paying for a
 * dynamic `await import(...)` (orchestrator-worker) or a `vi.mock` (its
 * tests). Keeping the values here — a leaf with zero imports — means a reader
 * pays nothing, so the workers can import them statically and the tests need
 * no mock at all.
 *
 * `orchestration-queue.ts` and `reconcile/workflow-executions-cron.ts`
 * re-export their respective values, so existing import paths keep working and
 * there is still exactly one definition of each.
 */

/**
 * Retry budget for an orchestration job whose processor THROWS.
 * `processWorkflowExecution` handles its own errors (it calls `failExecution`
 * and returns), so this covers only escapes from the worker wrapper — a Redis
 * failure in the drain path's `moveToDelayed` fallback, or a throw from the
 * wrapper itself. A deploy drain does NOT spend an attempt: the wrapper moves
 * the job to delayed and signals `DelayedError` (orchestrator-worker.ts),
 * because two rollouts inside two minutes once exhausted attempts:3 on a
 * single cycle in the video worker (video-worker.ts:270-278).
 *
 * Safe to retry: the resume path re-reads node_states, early-returns on a
 * terminal execution, and carries forward completed/skipped nodes without
 * re-charging.
 */
export const ORCHESTRATION_JOB_ATTEMPTS = 3

/** Default job options for the `workflow-orchestration` queue. Asserted
 *  directly by tests; production reads it through the Queue built in
 *  `orchestration-queue.ts`. */
export const ORCHESTRATION_JOB_OPTIONS = {
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 100 },
  attempts: ORCHESTRATION_JOB_ATTEMPTS,
  backoff: { type: "exponential", delay: 10_000 },
} as const

/**
 * Every queued-or-running BullMQ state for the orchestration queue.
 * `prioritized` and `waiting-children` are legitimate queued states that were
 * once missing, so an execution whose job was merely prioritized (or waiting
 * on a fanned-out sub-job) got marked orphaned while its orchestrator was
 * fine. Both the `workflow_executions` cron's orphan gate and the boot-time
 * `cleanupStaleExecutions` sweep in `orchestrator-worker.ts` read this one
 * set, so neither can drift out of sync with the other.
 */
export const ORCHESTRATOR_ALIVE_STATES: ReadonlySet<string> = new Set([
  "active",
  "waiting",
  "delayed",
  "prioritized",
  "waiting-children",
])
