/**
 * Schedule "Retry on failure" — the pure decision (decided 2026-10-20).
 *
 * A scheduled run nobody watches should wait for the cheap lane instead of
 * paying the direct fallback. So a Schedule Trigger with a retry policy
 * (`config.retry`, @nodaro/shared `ScheduleRetry`) gets its FAILED run fired
 * again after a wait, a bounded number of times — by the retry sweep
 * (`schedule-retry-sweep.ts`), on the schedule cron's own tick.
 *
 * The chain: the scheduled fire E0 fails → retry E1 (`attempt` 1, `chainRoot`
 * E0, `retryOf` E0) → fails → E2 (`attempt` 2, `retryOf` E1) … up to
 * `maxAttempts`. Each retry's row says so in `trigger_data.retry`, read only
 * off a `schedule` row. It is trusted there because nothing but the platform
 * writes such a row: clients cannot write `workflow_executions` at all
 * (migration 474), and the one inserter on the `schedule` lane is
 * `schedule-fire.ts`, whose `trigger_data` is fixed keys of its own — never a
 * caller's body (the inserts and trigger_data guards hold that). This is NOT
 * one of the platform's cross-lane stamps (lib/server-started-runs.ts, which
 * reads a schedule row's stamps as absent): those are keys a caller lane could
 * post; this key lives only on a lane no caller reaches.
 *
 * Which row to retry: the trigger's LATEST execution, whatever its status.
 * Only the newest run of a schedule is ever retried — a failure the schedule
 * has since run past (a later fire, a later retry) is left alone, so a chain
 * never fans out and a stale failure is never replayed beside a newer run.
 * That is also clause (e): a failed run whose retry exists is no longer the
 * latest, and the deterministic key (`retryIdempotencyKey`) refuses a second
 * retry of the same attempt at the database (the unique
 * (user_id, idempotency_key) index). The sweep also takes the per-trigger
 * claim a fire takes (`claimTick`), so a fire and a retry never both land.
 *
 * `scheduleRetryDue` is pure — the trigger's config, the latest row, the
 * clock — so it is pinned directly (lib/__tests__/schedule-retry.test.ts).
 */

import { normalizeScheduleRetry, type ScheduleRetry } from "@nodaro/shared/workflow"

/** A retry row's place in its chain (`workflow_executions.trigger_data.retry`). */
export interface ScheduleRetryStamp {
  /** The schedule trigger whose run this retries. */
  readonly triggerId: string
  /** The first execution of the chain: the scheduled fire that failed. */
  readonly chainRoot: string
  /** The execution this one retries (the previous link). */
  readonly retryOf: string
  /** 1 for the first retry of a fire. */
  readonly attempt: number
  /** The policy's cap when this retry was made — what the run history shows ("Retry 2 of 3"). */
  readonly maxAttempts: number
}

/** A run that ended badly on its own: a failure, or the orchestrator's timeout. A cancelled, discarded or stopped run is never retried. */
export const RETRYABLE_EXECUTION_STATUSES: readonly string[] = ["failed", "timed_out"]

/**
 * A failure is retried only within this long after it ended. Past it the
 * schedule's own next fire is the better answer, and a sweep that came back
 * after an outage must not replay old failures.
 */
export const SCHEDULE_RETRY_WINDOW_MS = 48 * 60 * 60 * 1000

/** The deterministic key of retry `attempt` of chain `chainRoot`: the claim two replicas race on. */
export function retryIdempotencyKey(chainRoot: string, attempt: number): string {
  return `retry:${chainRoot}:${attempt}`
}

const FIRE_KEY = /^schedule:([^:]+):/

/** The trigger a scheduled FIRE's row was made for, from its key (`schedule:<triggerId>:<previous fire>`). */
export function fireTriggerIdOf(idempotencyKey: unknown): string | null {
  if (typeof idempotencyKey !== "string") return null
  const m = idempotencyKey.match(FIRE_KEY)
  return m ? m[1] : null
}

/** The retry stamp a schedule row's `trigger_data` carries, when well-formed. */
export function retryStampOf(triggerData: unknown): ScheduleRetryStamp | null {
  if (!triggerData || typeof triggerData !== "object") return null
  const raw = (triggerData as Record<string, unknown>).retry
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.triggerId !== "string" || typeof r.chainRoot !== "string" || typeof r.retryOf !== "string") return null
  if (typeof r.attempt !== "number" || !Number.isInteger(r.attempt) || r.attempt < 1) return null
  if (typeof r.maxAttempts !== "number" || !Number.isInteger(r.maxAttempts) || r.maxAttempts < 1) return null
  return { triggerId: r.triggerId, chainRoot: r.chainRoot, retryOf: r.retryOf, attempt: r.attempt, maxAttempts: r.maxAttempts }
}

/**
 * The schedule trigger a schedule-lane row is a run of: a retry's stamp
 * names it, a fire's key does; a refusal tombstone (no key, no stamp) is
 * nobody's run.
 */
export function runTriggerIdOf(row: { readonly idempotency_key: string | null; readonly trigger_data: unknown }): string | null {
  return retryStampOf(row.trigger_data)?.triggerId ?? fireTriggerIdOf(row.idempotency_key)
}

/** The columns of a `workflow_executions` row the decision reads. */
export interface RetryCandidateRow {
  readonly id: string
  readonly status: string
  readonly trigger_type: string
  readonly idempotency_key: string | null
  readonly trigger_data: unknown
  readonly completed_at: string | null
  readonly updated_at?: string | null
}

export type ScheduleRetrySkip =
  | "retry_off"
  | "no_run"
  | "not_a_schedule_run"
  | "other_trigger"
  | "not_a_fire"
  | "not_failed"
  | "no_end_time"
  | "too_soon"
  | "too_old"
  | "attempts_exhausted"
  | "already_running"

export type ScheduleRetryDecision =
  | { readonly fire: { readonly stamp: ScheduleRetryStamp; readonly idempotencyKey: string; readonly policy: ScheduleRetry } }
  | { readonly skip: ScheduleRetrySkip }

/**
 * Is a retry due for this trigger now? Pure. The clauses, in order:
 *
 * (a) the trigger's CURRENT config has a retry policy, and the latest
 *     execution is a `schedule` run of THIS trigger — a scheduled fire (its
 *     key names the trigger) or a retry of one (its stamp does). A refusal
 *     tombstone (`trigger-fire-refusal.ts`: failed, no key) is not a run;
 * (b) it ended `failed` or `timed_out` — never cancelled or discarded;
 * (c) it ended at least `afterMinutes` ago, and within the retry window;
 * (d) the chain has had fewer than `maxAttempts` retries;
 * (e) no retry of it exists — it is the latest row (the caller reads the
 *     latest), and the key refuses a duplicate at insert;
 * (f) no run of the workflow is pending or running.
 */
export function scheduleRetryDue(args: {
  readonly trigger: { readonly id: string; readonly config: Record<string, unknown> }
  readonly latest: RetryCandidateRow | null
  readonly now: Date
  readonly activeExecution: boolean
}): ScheduleRetryDecision {
  const policy = normalizeScheduleRetry(args.trigger.config.retry)
  if (!policy) return { skip: "retry_off" }
  const row = args.latest
  if (!row) return { skip: "no_run" }
  if (row.trigger_type !== "schedule") return { skip: "not_a_schedule_run" }

  const runOf = runTriggerIdOf(row)
  if (runOf === null) return { skip: "not_a_fire" }
  if (runOf !== args.trigger.id) return { skip: "other_trigger" }
  const stamp = retryStampOf(row.trigger_data)

  if (!RETRYABLE_EXECUTION_STATUSES.includes(row.status)) return { skip: "not_failed" }

  const endedAt = parseTime(row.completed_at) ?? parseTime(row.updated_at ?? null)
  if (endedAt === null) return { skip: "no_end_time" }
  const since = args.now.getTime() - endedAt
  if (since < policy.afterMinutes * 60_000) return { skip: "too_soon" }
  if (since > SCHEDULE_RETRY_WINDOW_MS) return { skip: "too_old" }

  const attempt = (stamp?.attempt ?? 0) + 1
  if (attempt > policy.maxAttempts) return { skip: "attempts_exhausted" }

  if (args.activeExecution) return { skip: "already_running" }

  const chainRoot = stamp?.chainRoot ?? row.id
  return {
    fire: {
      stamp: { triggerId: args.trigger.id, chainRoot, retryOf: row.id, attempt, maxAttempts: policy.maxAttempts },
      idempotencyKey: retryIdempotencyKey(chainRoot, attempt),
      policy,
    },
  }
}

function parseTime(value: string | null): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}
