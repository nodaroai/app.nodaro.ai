/**
 * The schedule retry sweep: on the schedule cron's tick, every active
 * schedule trigger with a retry policy is asked — through the pure
 * `scheduleRetryDue` (schedule-retry.ts) — whether its latest run failed
 * long enough ago to run again, and a due one is created exactly the way
 * the cron fires one (schedule-fire.ts). Runs only where the cron runs
 * (`scheduleTriggersEnabled`), since the cron is what calls it, on the
 * active schedules the cron's check just listed.
 *
 * Two claims, one per line of defence, before a retry is written:
 * - the SAME per-trigger claim a fire takes (`claimTick`: `last_triggered_at`
 *   moved from the value read), so a fire and a retry of one trigger — on
 *   two replicas, in the same minute — serialize on one row and never both
 *   land; a sibling run is re-checked under the claim, which is given back
 *   when one is live;
 * - the retry's deterministic key (`retry:<chainRoot>:<attempt>`), which the
 *   unique (user_id, idempotency_key) index refuses a second time, so two
 *   sweeps of the same failure make one row and the loser never enqueues.
 */

import { normalizeScheduleRetry } from "@nodaro/shared/workflow"
import { supabase } from "./supabase.js"
import {
  admitScheduleTrigger,
  claimTick,
  createScheduleExecution,
  hasActiveExecution,
  releaseTick,
  resolveScheduleBilling,
  scheduleNodeGone,
  type ScheduleTriggerRow,
} from "./schedule-fire.js"
import { runTriggerIdOf, scheduleRetryDue, type RetryCandidateRow } from "./schedule-retry.js"

/**
 * How many of the workflow's newest schedule-lane rows are read to find THIS
 * trigger's latest run (a workflow may carry several schedules, and the rows
 * cannot be filtered by trigger in SQL: that would be a `trigger_data->…`
 * path filter, which the stamp-readers guard forbids outside the
 * stamp-writing lanes). The trade-off: a sibling schedule on the same
 * workflow that fires more than this many times inside this trigger's wait
 * hides its failure until the sibling quietens — accepted; a later change
 * could put the trigger id into the retry key and query by key prefix.
 */
const LATEST_ROWS = 10

/**
 * Every active schedule trigger with a retry policy, checked at `now`. The
 * cron hands over the active schedules its check listed and kept (an orphan
 * it dropped is not among them).
 */
export async function sweepScheduleRetries(now: Date, triggers: readonly ScheduleTriggerRow[]): Promise<void> {
  for (const trigger of triggers) {
    // Only a trigger whose CURRENT config retries: the sweep reads the policy
    // every tick, so switching it off stops the chain at once.
    if (!normalizeScheduleRetry(trigger.config.retry)) continue
    try {
      await sweepTrigger(trigger, now)
    } catch (err) {
      console.error(`[schedule-retry] Error sweeping trigger ${trigger.id}:`, err)
    }
  }
}

async function sweepTrigger(trigger: ScheduleTriggerRow, now: Date): Promise<void> {
  // The schedule lane's latest rows for this workflow and owner — the
  // decision picks the newest one that belongs to THIS trigger (its fire key
  // or its retry stamp says), and reads its stamp as it is: a schedule row's
  // `trigger_data` is written only by schedule-fire.ts (clients cannot write
  // the table — migration 474 — and no caller lane inserts on this trigger
  // type), so the stamp is the platform's own.
  const { data: rows, error } = await supabase
    .from("workflow_executions")
    .select("id, status, trigger_type, idempotency_key, trigger_data, completed_at, updated_at")
    .eq("workflow_id", trigger.workflow_id)
    .eq("user_id", trigger.user_id)
    .eq("trigger_type", "schedule")
    .order("created_at", { ascending: false })
    .limit(LATEST_ROWS)
  if (error || !rows) return

  const latest = latestRunOfTrigger(trigger.id, rows as RetryCandidateRow[])
  // Clause (f), an active run, is a second read: asked only once every other
  // clause says a retry is due, so a quiet schedule costs one read a tick.
  const dueButForActivity = scheduleRetryDue({ trigger, latest, now, activeExecution: false })
  if ("skip" in dueButForActivity) return
  const decision = scheduleRetryDue({ trigger, latest, now, activeExecution: await hasActiveExecution(trigger) })
  if ("skip" in decision) return

  // A node-managed schedule whose node left the graph is an orphan: the cron
  // drops the row; the sweep never runs it (its branch no longer exists).
  const nodeId = typeof trigger.config.nodeId === "string" ? trigger.config.nodeId : null
  if (nodeId && (await scheduleNodeGone(trigger.workflow_id, nodeId))) return

  if (!(await admitScheduleTrigger(trigger, nodeId))) return
  const billingContext = await resolveScheduleBilling(trigger, "[schedule-retry]")
  if (!billingContext) return

  // The per-trigger claim a fire takes (schedule-fire.ts): a fire of this
  // trigger in the same minute, on this replica or another, and this retry
  // cannot both win it.
  const claimedAt = now.toISOString()
  if (!(await claimTick(trigger.id, trigger.last_triggered_at, claimedAt))) return
  // A sibling run may have started between the check above and the claim:
  // asked again under the claim, and the claim given back when so.
  if (await hasActiveExecution(trigger)) {
    await releaseTick(trigger.id, claimedAt, trigger.last_triggered_at)
    return
  }

  const { stamp, idempotencyKey } = decision.fire
  const created = await createScheduleExecution({
    trigger,
    nodeId,
    now,
    // The SAME previous-fire time the failed run carried, so a "newer than the previous run" filter reads the same window.
    previousLastTriggeredAt: previousFireOf(latest),
    billingContext,
    idempotencyKey,
    retry: stamp,
  })
  if (!created.ok) {
    // A duplicate means another sweep made this attempt: its row stands, the
    // claim stays. Any other failure left no run, so the claim goes back.
    if (!created.duplicate) {
      console.error(`[schedule-retry] could not create retry ${stamp.attempt} of ${stamp.chainRoot} (trigger ${trigger.id})`)
      await releaseTick(trigger.id, claimedAt, trigger.last_triggered_at)
    }
    return
  }
  console.info(
    `[schedule-retry] Retry ${stamp.attempt} of ${stamp.maxAttempts} for execution ${stamp.retryOf} (chain ${stamp.chainRoot}, trigger ${trigger.id}): ${created.executionId}`,
  )
}

/**
 * The newest row (rows newest first) that is a run of THIS trigger — a
 * workflow's other schedules' runs, and refusal tombstones (nobody's run),
 * are stepped over so they never hide this trigger's latest run.
 */
export function latestRunOfTrigger(triggerId: string, rows: readonly RetryCandidateRow[]): RetryCandidateRow | null {
  return rows.find((row) => runTriggerIdOf(row) === triggerId) ?? null
}

function previousFireOf(row: RetryCandidateRow | null): string | null {
  const data = row?.trigger_data
  if (!data || typeof data !== "object") return null
  const previous = (data as Record<string, unknown>).last_triggered_at
  return typeof previous === "string" ? previous : null
}
